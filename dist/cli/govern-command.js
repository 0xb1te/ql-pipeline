// @neuron entrypoint.cli.governCommand
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '@actions/core';
import { countFixAttempts } from '../fixer/attempt-counter.js';
import { formatComplaintSummary } from '../fixer/complaint.js';
import { runFix } from '../fixer/fixer.js';
import { executeMergeDecision, findingToReviewComment } from '../merger/merger.js';
import { runReview } from '../reviewer/reviewer.js';
import { formatRulesForPrompt, resolveRuleFiles, ruleFileIds } from '../rules/rule-resolver.js';
import { areasFromPaths } from '../router/area-paths.js';
import { touchesProtectedPaths } from '../router/self-protection.js';
import { createHouseStandardsReader, readHouseCredentialsFromEnv } from '../standards/house-credentials.js';
import { formatStandardsForPrompt, resolveStandards, standardsIds, } from '../standards/standards-resolver.js';
import { formatAuditSummary } from '../shared/audit-summary.js';
import { mergeGateReports, parseGateReport } from '../shared/gate-report.js';
import { AREAS } from '../shared/types.js';
import { gateFindings, isReviewRequired } from '../verdict/required-checks.js';
import { decidePipelineOutcome } from '../verdict/verdict.js';
import { createPipelineContext, resolveRouting } from './bootstrap.js';
// dist/cli/govern-command.js -> ql-pipeline's own checkout root is two
// levels up. rules/ and prompts/ ship inside ql-pipeline itself; the repo
// under review is the working directory.
const PIPELINE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
function loadPromptTemplate(fileName) {
    return readFileSync(join(PIPELINE_ROOT, 'prompts', fileName), 'utf-8');
}
/**
 * Collects the reports the gate jobs left behind. A report that is present
 * but unreadable is fatal: the pipeline would otherwise merge a PR while
 * genuinely not knowing whether its tests passed.
 */
// @signal readGateReports
export function readGateReports(reportsDir, reader = {
    exists: existsSync,
    list: readdirSync,
    read: (p) => readFileSync(p, 'utf-8'),
}) {
    if (!reader.exists(reportsDir)) {
        return { ok: true, outcomes: [] };
    }
    const reports = [];
    for (const entry of reader.list(reportsDir).filter((name) => name.endsWith('.json')).sort()) {
        const parsed = parseGateReport(reader.read(join(reportsDir, entry)));
        if (!parsed.ok) {
            return { ok: false, reason: `could not read gate report "${entry}": ${parsed.reason}` };
        }
        reports.push(parsed.report);
    }
    return { ok: true, outcomes: mergeGateReports(reports) };
}
async function escalateToHuman(client, pr, logger, reason, comment) {
    logger.error(reason);
    await client.addLabels(pr, ['needs-human']);
    await client.postComment(pr, comment);
    core.setFailed(reason);
}
/**
 * The pipeline check: everything after the gates. Runs even when a gate
 * job failed, because a broken build is a finding the fix agent can repair
 * — halting the chain on a red gate would throw that away.
 */
// @signal runGovern
export async function runGovern(reportsDir) {
    const { config, pr, client, logger, consumerRoot } = createPipelineContext();
    const routing = await resolveRouting(client, pr, config);
    if (routing.kind === 'not-governed') {
        logger.info(`leaving this PR untouched: ${routing.reason}`);
        return;
    }
    if (routing.kind === 'unroutable') {
        logger.error('PR is unroutable', { reason: routing.reason });
        await client.postComment(pr, 'This PR could not be routed: no commit (and not the PR title either) matches the required ' +
            '`<type>(<area>): <description>` conventional-commit format, so the pipeline cannot tell which ' +
            'rules apply. Reword a commit or the PR title and push again.');
        core.setFailed(routing.reason);
        return;
    }
    if (routing.kind === 'target-conflict') {
        await escalateToHuman(client, pr, logger, routing.reason, `**Conflicting target branches.** ${routing.reason}`);
        return;
    }
    const { route, targetBranch } = routing;
    logger.info('routed PR', { areas: route.areas, types: route.types, targetBranch });
    const changedFiles = await client.listChangedFiles(pr);
    // Areas implied by the code the PR actually touches, on top of the ones
    // its commit headers declare. A PR labelled `feat(frontend)` that also
    // edits `apps/api-backend/` gets the backend rules and standards applied
    // to it too — the commit header cannot narrow what gets reviewed.
    const pathAreas = areasFromPaths(changedFiles, config.areas.paths);
    const reviewAreas = AREAS.filter((area) => route.areas.includes(area) || pathAreas.includes(area));
    const addedByPath = pathAreas.filter((area) => !route.areas.includes(area));
    if (addedByPath.length > 0) {
        logger.info('additional areas detected from changed paths', { areas: addedByPath });
    }
    await client.addLabels(pr, reviewAreas.map((area) => `area:${area}`));
    // RULES.md R4: the pipeline never auto-merges or auto-fixes changes to
    // its own governance paths. Checked structurally and before the AI is
    // consulted — making the AI's judgment the enforcement mechanism for its
    // own constitution would defeat the point.
    if (touchesProtectedPaths(changedFiles, config.fixer.protectedPaths)) {
        await escalateToHuman(client, pr, logger, 'PR touches protected pipeline-governance paths and requires human review', 'This PR touches pipeline-governance paths (rules, prompts, config, or workflows) and always requires ' +
            'human review — the pipeline never auto-merges or auto-fixes changes to its own laws (RULES.md R4).');
        return;
    }
    const gateReports = readGateReports(reportsDir);
    if (!gateReports.ok) {
        await escalateToHuman(client, pr, logger, gateReports.reason, `**The pipeline could not read the gate results**, so it cannot tell whether this PR builds or passes ` +
            `its tests, and will not merge it:\n\n> ${gateReports.reason}`);
        return;
    }
    const gateOutcomes = gateReports.outcomes;
    const findingsFromGates = gateFindings(gateOutcomes, config.merge.requiredChecks);
    const gatesBlock = findingsFromGates.some((finding) => finding.severity === 'must');
    let findings = findingsFromGates;
    let reviewRan = false;
    if (gatesBlock) {
        logger.info('skipping AI review: a required gate failed, so there is no point reviewing code that fails to build');
    }
    else if (!isReviewRequired(config.merge.requiredChecks)) {
        logger.info('skipping AI review: "ai-review" is not in merge.required_checks for this repo');
    }
    else {
        const resolvedRules = resolveRuleFiles(reviewAreas, { pipelineRoot: PIPELINE_ROOT, consumerRoot });
        for (const rule of resolvedRules) {
            logger.info(`rules: ${rule.id} (${rule.source})`);
        }
        // Standards are read from house-api, not a local ql-docs checkout — see
        // docs/013-house-backed-standards/plan.md. Credentials are read (and
        // the reader only constructed) here, not in
        // createPipelineContext/bootstrap.ts, so `gate` and the scaffolding
        // commands never have to know house-api exists, and a repo with
        // `standards.enabled: false` never needs the four HOUSE_*/QL_AUTH_*
        // secrets set at all.
        let standardsResolution;
        if (config.standards.enabled) {
            try {
                const houseReader = await createHouseStandardsReader(readHouseCredentialsFromEnv(), consumerRoot, config.standards.root);
                standardsResolution = await resolveStandards(reviewAreas, config.standards, consumerRoot, houseReader);
            }
            catch (cause) {
                await escalateToHuman(client, pr, logger, `could not reach house-api for engineering standards: ${String(cause)}`, '**The engineering standards for this PR could not be loaded** — house-api or ql-auth could not be ' +
                    `reached, so this PR was not reviewed against them and will not be merged:\n\n> ${String(cause)}\n\n` +
                    'Check `HOUSE_API_URL`, `QL_AUTH_URL`, `QL_AUTH_CLIENT_ID`, and `QL_AUTH_CLIENT_SECRET`, or set ' +
                    '`standards.enabled: false` in the pipeline config to review without them.');
                return;
            }
        }
        else {
            standardsResolution = { standards: [], missing: [] };
        }
        const { standards, missing } = standardsResolution;
        for (const standard of standards) {
            logger.info(`standards: ${standard.id} (${standard.docPath})${standard.truncated ? ' [truncated]' : ''}`);
        }
        // A configured standards document that isn't there means this review
        // would silently be weaker than the repo believes it is — the same
        // "documentation promises what the code doesn't do" failure RULES.md
        // R6.0 exists to prevent. Fail loudly instead: it is trivially fixed
        // by correcting the configured path, granting the token the missing
        // route, or turning standards off.
        if (missing.length > 0) {
            await escalateToHuman(client, pr, logger, `engineering standards could not be loaded: ${missing.join(', ')}`, '**The engineering standards for this PR could not be loaded**, so it was not reviewed against them ' +
                'and will not be merged. Missing from house-api:\n\n' +
                missing.map((path) => `- \`${path}\``).join('\n') +
                '\n\nCheck that `standards.docs` names paths that actually exist under `workflow/rules/` in ' +
                'ql-docs, and that the `github_agent` token carries the route for each one, ' +
                'or set `standards.enabled: false` in the pipeline config to review without them.');
            return;
        }
        const { description, diff } = await client.getPullRequestDetails(pr);
        const reviewResult = await runReview({
            areas: reviewAreas,
            ruleFiles: [...ruleFileIds(resolvedRules), ...standardsIds(standards)],
            rulesText: formatRulesForPrompt(resolvedRules),
            standardsText: formatStandardsForPrompt(standards),
            gateOutcomes,
            prDescription: description,
            diff,
        }, loadPromptTemplate('reviewer.md'), { cwd: consumerRoot });
        if (!reviewResult.ok) {
            await escalateToHuman(client, pr, logger, `review could not be completed: ${reviewResult.reason}`, `**The AI review could not be completed**, so this PR is blocked rather than merged:\n\n> ${reviewResult.reason}`);
            return;
        }
        reviewRan = true;
        for (const { finding, reason } of reviewResult.outcome.discarded) {
            logger.warn('discarded ungrounded finding', { rule: finding.rule, file: finding.file, reason });
        }
        findings = [...findingsFromGates, ...reviewResult.outcome.findings];
    }
    const commitMessages = await client.listCommitMessages(pr);
    const attemptsSoFar = countFixAttempts(commitMessages);
    const attemptNumber = attemptsSoFar + 1;
    const decision = decidePipelineOutcome({ findings, attemptsSoFar, maxFixAttempts: config.fixer.maxFixAttempts });
    await client.postComment(pr, formatAuditSummary({
        areas: route.areas,
        gateOutcomes,
        findingCount: findings.length,
        decision,
        attemptNumber,
        maxFixAttempts: config.fixer.maxFixAttempts,
        targetBranch,
        reviewRan,
    }));
    if (decision.kind === 'MERGE') {
        const execution = await executeMergeDecision(client, pr, decision.advisoryFindings, config.merge);
        if (execution.kind === 'stale') {
            logger.info('aborting merge: the PR moved while this run was working; the newer run governs it', execution);
            return;
        }
        if (execution.kind === 'awaiting-human') {
            logger.info('approved and labelled ready-to-merge; a human makes the merge call', {
                targetBranch,
                advisoryFindingCount: decision.advisoryFindings.length,
            });
            return;
        }
        logger.info('merged', { targetBranch, advisoryFindingCount: decision.advisoryFindings.length });
        return;
    }
    // FIX and BLOCK both mean something is wrong; post the complaint either
    // way so a human can see exactly what, without digging through CI logs.
    const summary = formatComplaintSummary(decision.findings, attemptNumber, config.fixer.maxFixAttempts);
    await client.requestChangesWithComments(pr, summary, decision.findings.map(findingToReviewComment));
    if (decision.kind === 'BLOCK') {
        logger.error(`blocked: ${decision.reason}`);
        await client.addLabels(pr, ['needs-human']);
        core.setFailed(`blocked: ${decision.reason}`);
        return;
    }
    // A fork PR's branch lives in someone else's repository, which this
    // token cannot push to — review it, complain about it, but never
    // pretend a fix was attempted.
    if (pr.isFork) {
        await escalateToHuman(client, pr, logger, 'cannot auto-fix a PR from a fork; this needs a human', 'This PR comes from a fork, so the pipeline cannot push a fix commit to its branch. ' +
            'The findings above need to be addressed manually.');
        return;
    }
    const primaryArea = route.areas[0];
    const fixOutcome = await runFix(decision.findings, loadPromptTemplate('fixer.md'), primaryArea, {
        cwd: consumerRoot,
        branch: pr.headRef,
        protectedPaths: config.fixer.protectedPaths,
        attemptNumber,
        maxFixAttempts: config.fixer.maxFixAttempts,
    });
    if (fixOutcome.kind === 'committed') {
        logger.info('fix committed and pushed; the push re-triggers this pipeline', {
            commitMessage: fixOutcome.commitMessage,
            files: fixOutcome.files,
        });
        core.setFailed('the pipeline pushed a fix commit; this run is superseded by the one that commit triggers');
        return;
    }
    if (fixOutcome.kind === 'no-changes') {
        await escalateToHuman(client, pr, logger, 'the fix agent made no usable changes; this needs a human', 'The automated fix agent ran but produced no usable changes (or only touched protected paths, which are ' +
            'always reverted). The findings above need to be addressed manually.');
        return;
    }
    await escalateToHuman(client, pr, logger, `fix attempt failed: ${fixOutcome.reason}`, `**The automated fix attempt failed.**\n\n> ${fixOutcome.reason}`);
}
//# sourceMappingURL=govern-command.js.map