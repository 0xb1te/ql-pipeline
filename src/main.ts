import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as core from '@actions/core';
import { context } from '@actions/github';
import { countFixAttempts } from './fixer/attempt-counter.js';
import { formatComplaintSummary } from './fixer/complaint.js';
import { runFix } from './fixer/fixer.js';
import { executeMergeDecision, findingToReviewComment } from './merger/merger.js';
import { couldGovernPullRequest, governsPullRequest, resolveTargetBranch } from './merger/target-branch.js';
import { runReview } from './reviewer/reviewer.js';
import { formatRulesForPrompt, resolveRuleFiles, ruleFileIds } from './rules/rule-resolver.js';
import { runGates } from './router/gate-runner.js';
import { determineRoute } from './router/router.js';
import { touchesProtectedPaths } from './router/self-protection.js';
import { formatAuditSummary } from './shared/audit-summary.js';
import { loadConfig } from './shared/config.js';
import {
  createGithubClient,
  readPullRequestContext,
  type ActionsEventContext,
  type GithubClient,
  type PullRequestInfo,
} from './shared/github-client.js';
import { createLogger, type Logger } from './shared/logger.js';
import type { Finding } from './shared/types.js';
import { decidePipelineOutcome } from './verdict/verdict.js';
import { gateFindings, isReviewRequired } from './verdict/required-checks.js';

const DEFAULT_CONFIG_PATH = '.github/pipeline.config.yml';

// dist/main.js -> ql-pipeline's own checkout root is one level up. rules/
// and prompts/ ship inside ql-pipeline itself; the consumer repo being
// governed is the process working directory. Keeping the two roots
// distinct is what lets a consumer override rules without vendoring code.
const PIPELINE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadPromptTemplate(fileName: string): string {
  return readFileSync(join(PIPELINE_ROOT, 'prompts', fileName), 'utf-8');
}

async function escalateToHuman(
  client: GithubClient,
  pr: PullRequestInfo,
  logger: Logger,
  reason: string,
  comment: string,
): Promise<void> {
  logger.error(reason);
  await client.addLabels(pr, ['needs-human']);
  await client.postComment(pr, comment);
  core.setFailed(reason);
}

async function main(): Promise<void> {
  const logger = createLogger('info');

  const token = process.env['GITHUB_TOKEN'];
  if (token === undefined || token.length === 0) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }
  const configPath = process.env['PIPELINE_CONFIG_PATH'] ?? DEFAULT_CONFIG_PATH;
  const consumerRoot = process.cwd();

  const config = loadConfig(configPath);
  // @actions/github's real payload type leaves most of `pull_request` to a
  // `[key: string]: any` catch-all, so it doesn't structurally satisfy our
  // stricter ActionsEventContext even though the real webhook payload
  // always carries these fields. Narrowing here keeps
  // readPullRequestContext's own contract honest and unit-testable.
  const pr = readPullRequestContext(context as unknown as ActionsEventContext);
  const client = createGithubClient(token);

  // Cheapest possible exit for a PR this pipeline has no authority over:
  // no API calls, no gates, no AI spend. The precise per-area target is
  // resolved below, once the PR's areas are known.
  if (!couldGovernPullRequest(pr.baseRef, config.merge)) {
    logger.info('PR targets a branch this pipeline does not govern; leaving it untouched', {
      prBase: pr.baseRef,
      configuredTarget: config.merge.targetBranch,
    });
    return;
  }

  const commitMessages = await client.listCommitMessages(pr);
  const route = determineRoute({ commitMessages, prTitle: pr.title }, config);

  if (!route.ok) {
    logger.error('PR is unroutable', { reason: route.reason });
    await client.postComment(
      pr,
      'This PR could not be routed: no commit (and not the PR title either) matches the required ' +
        '`<type>(<area>): <description>` conventional-commit format, so the pipeline cannot tell which ' +
        'rules apply. Reword a commit or the PR title and push again.',
    );
    core.setFailed(route.reason);
    return;
  }
  logger.info('routed PR', { areas: route.decision.areas, types: route.decision.types });

  // Which branch is this PR configured to merge into? Per-area overrides
  // (plan.md §4.7) can disagree; that's a conflict, not something to guess.
  const target = resolveTargetBranch(route.decision.areas, config.merge);
  if (!target.ok) {
    await client.addLabels(pr, route.decision.areas.map((area) => `area:${area}`));
    await escalateToHuman(client, pr, logger, target.reason, `**Conflicting target branches.** ${target.reason}`);
    return;
  }

  // The pipeline governs PRs aimed at its configured target branch. A PR
  // pointed elsewhere is outside its authority — left alone rather than
  // failed, since a red check on an unrelated PR is noise, not safety.
  if (!governsPullRequest(pr.baseRef, target.targetBranch)) {
    logger.info('PR is not governed by this pipeline; leaving it untouched', {
      prBase: pr.baseRef,
      configuredTarget: target.targetBranch,
    });
    return;
  }

  await client.addLabels(pr, route.decision.areas.map((area) => `area:${area}`));

  // RULES.md R4 / AGENT.md invariant #5: the pipeline never auto-merges or
  // auto-fixes changes to its own governance paths, checked structurally
  // and *before* the AI is ever consulted — making the AI's judgment the
  // enforcement mechanism for its own constitution would defeat the point.
  const changedFiles = await client.listChangedFiles(pr);
  if (touchesProtectedPaths(changedFiles, config.fixer.protectedPaths)) {
    await escalateToHuman(
      client,
      pr,
      logger,
      'PR touches protected pipeline-governance paths and requires human review',
      'This PR touches pipeline-governance paths (rules, prompts, config, or workflows) and always requires ' +
        'human review — the pipeline never auto-merges or auto-fixes changes to its own laws (RULES.md R4).',
    );
    return;
  }

  const gateOutcomes = await runGates(route.decision.gates, { cwd: consumerRoot });
  for (const outcome of gateOutcomes) {
    logger.info(`gate ${outcome.area}/${outcome.gate}: ${outcome.passed ? 'passed' : 'FAILED'}`);
    if (!outcome.passed) {
      logger.error(outcome.output);
    }
  }

  // A failed gate becomes a finding like any other (plan.md §4.3), with its
  // severity determined by whether that stage is a required check.
  const findingsFromGates = gateFindings(gateOutcomes, config.merge.requiredChecks);
  const gatesBlock = findingsFromGates.some((finding) => finding.severity === 'must');

  let findings: readonly Finding[] = findingsFromGates;
  let reviewRan = false;

  if (gatesBlock) {
    logger.info('skipping AI review: a required gate failed, so there is no point reviewing code that fails to build');
  } else if (!isReviewRequired(config.merge.requiredChecks)) {
    logger.info('skipping AI review: "ai-review" is not in merge.required_checks for this repo');
  } else {
    const resolvedRules = resolveRuleFiles(route.decision.areas, { pipelineRoot: PIPELINE_ROOT, consumerRoot });
    for (const rule of resolvedRules) {
      logger.info(`rules: ${rule.id} (${rule.source})`);
    }

    const { description, diff } = await client.getPullRequestDetails(pr);
    const reviewResult = await runReview(
      {
        areas: route.decision.areas,
        ruleFiles: ruleFileIds(resolvedRules),
        rulesText: formatRulesForPrompt(resolvedRules),
        gateOutcomes,
        prDescription: description,
        diff,
      },
      loadPromptTemplate('reviewer.md'),
      { cwd: consumerRoot },
    );

    if (!reviewResult.ok) {
      await escalateToHuman(
        client,
        pr,
        logger,
        `review could not be completed: ${reviewResult.reason}`,
        `**The AI review could not be completed**, so this PR is blocked rather than merged:\n\n> ${reviewResult.reason}`,
      );
      return;
    }
    reviewRan = true;
    for (const { finding, reason } of reviewResult.outcome.discarded) {
      logger.warn('discarded ungrounded finding', { rule: finding.rule, file: finding.file, reason });
    }
    findings = [...findingsFromGates, ...reviewResult.outcome.findings];
  }

  const attemptsSoFar = countFixAttempts(commitMessages);
  const attemptNumber = attemptsSoFar + 1;
  const decision = decidePipelineOutcome({ findings, attemptsSoFar, maxFixAttempts: config.fixer.maxFixAttempts });

  await client.postComment(
    pr,
    formatAuditSummary({
      areas: route.decision.areas,
      gateOutcomes,
      findingCount: findings.length,
      decision,
      attemptNumber,
      maxFixAttempts: config.fixer.maxFixAttempts,
      targetBranch: target.targetBranch,
      reviewRan,
    }),
  );

  if (decision.kind === 'MERGE') {
    const execution = await executeMergeDecision(client, pr, decision.advisoryFindings, config.merge);
    if (execution.kind === 'stale') {
      logger.info('aborting merge: the PR moved while this run was working; the newer run governs it', execution);
      return;
    }
    logger.info('merged', { targetBranch: target.targetBranch, advisoryFindingCount: decision.advisoryFindings.length });
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
  // token cannot push to — review it, complain about it, but never pretend
  // a fix was attempted.
  if (pr.isFork) {
    await escalateToHuman(
      client,
      pr,
      logger,
      'cannot auto-fix a PR from a fork; this needs a human',
      'This PR comes from a fork, so the pipeline cannot push a fix commit to its branch. ' +
        'The findings above need to be addressed manually.',
    );
    return;
  }

  const primaryArea = route.decision.areas[0]!;
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
    });
    return;
  }

  if (fixOutcome.kind === 'no-changes') {
    await escalateToHuman(
      client,
      pr,
      logger,
      'the fix agent made no usable changes; this needs a human',
      'The automated fix agent ran but produced no usable changes (or only touched protected paths, which are ' +
        'always reverted). The findings above need to be addressed manually.',
    );
    return;
  }

  await escalateToHuman(
    client,
    pr,
    logger,
    `fix attempt failed: ${fixOutcome.reason}`,
    `**The automated fix attempt failed.**\n\n> ${fixOutcome.reason}`,
  );
}

main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error : String(error));
});
