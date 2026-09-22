// @neuron entrypoint.cli.governCommand
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '@actions/core';
import { countFixAttempts } from '../fixer/attempt-counter.js';
import { formatComplaintSummary } from '../fixer/complaint.js';
import { runFix } from '../fixer/fixer.js';
import { agentsFixerCredentialsFromEnv, runAgentsFix } from '../fixer/agents-fixer.js';
import {
  executeMergeDecision,
  inlineComments,
  recordComplaint,
  recordVerdictLabel,
  unanchoredFindings,
  NEEDS_HUMAN_LABEL,
} from '../merger/merger.js';
import {
  createOpenAiCompatibleReviewer,
  readAgentApiKeyFromEnv,
} from '../reviewer/openai-compatible-runner.js';
import { runReview, standardsBudgetFor } from '../reviewer/reviewer.js';
import { dedupeFindings, planReviewPasses } from '../reviewer/review-passes.js';
import type { CursorAgentRunner } from '../reviewer/cursor-runner.js';
import { formatRulesForPrompt, resolveRuleFiles, ruleFileIds } from '../rules/rule-resolver.js';
import { reviewKindFor } from '../standards/review-kind.js';
import { areasFromPaths } from '../router/area-paths.js';
import { touchesProtectedPaths } from '../router/self-protection.js';
import {
  HOUSE_API_URL_VAR,
  LEGACY_HOUSE_API_URL_VAR,
  createHouseStandardsReader,
  readHouseCredentialsFromEnv,
} from '../standards/house-credentials.js';
import {
  describeDroppedSections,
  formatStandardsForPrompt,
  resolveStandards,
  standardsIds,
  type StandardsResolution,
} from '../standards/standards-resolver.js';
import {
  formatAuditSummary,
  type PromptCoverage,
  type StandardsCoverage,
} from '../shared/audit-summary.js';
import { mergeGateReports, parseGateReport, type GateReport } from '../shared/gate-report.js';
import type { GithubClient, PullRequestInfo, ReviewComment } from '../shared/github-client.js';
import type { Logger } from '../shared/logger.js';
import {
  AREAS,
  type AgentProvider,
  type Finding,
  type GateOutcome,
  type PipelineConfig,
  type RequiredCheck,
} from '../shared/types.js';
import { pickedUpReply, replyForFinding, type FixAttemptOutcome } from '../reviewer/finding-reply.js';
import { formatDirection } from '../shared/human-direction.js';
import { gateFindings, isReviewRequired } from '../verdict/required-checks.js';
import { decidePipelineOutcome } from '../verdict/verdict.js';
import { threadsToResolve } from '../reviewer/settled-threads.js';
import {
  createSprintNotifier,
  sprintNotifierCredentialsFromEnv,
  type SprintVerdict,
} from '../notifier/sprint-notifier.js';
import { readSprintTasks, type SprintTaskList } from '../notifier/sprint-tasks.js';
import { decideTaskProvenance, taskProvenanceFinding } from '../verdict/task-provenance.js';
import {
  taskArtifactFinding,
  taskFolderGlobFor,
  taskFolderRefOf,
  type TaskFolderLookup,
} from '../verdict/task-artifacts.js';
import {
  assessPreviewEnvironment,
  previewEnvironmentFinding,
  readPreviewEnvironmentSnapshot,
  PREVIEW_ENVIRONMENT_DIR,
} from '../verdict/preview-environment.js';
import type { AreaPathsConfig } from '../shared/types.js';
import { createPipelineContext, resolveRouting } from './bootstrap.js';

// dist/cli/govern-command.js -> ql-pipeline's own checkout root is two
// levels up. rules/ and prompts/ ship inside ql-pipeline itself; the repo
// under review is the working directory.
const PIPELINE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadPromptTemplate(fileName: string): string {
  return readFileSync(join(PIPELINE_ROOT, 'prompts', fileName), 'utf-8');
}

function openAiCompatibleReviewerFrom(config: PipelineConfig): CursorAgentRunner {
  const { baseUrl } = config.agent;
  const model = config.agent.review.model;
  if (baseUrl === null || model === null) {
    throw new Error(
      'agent.base_url and agent.model (or agent.review.model) are required when agent.provider is openai_compatible',
    );
  }
  return createOpenAiCompatibleReviewer({
    baseUrl,
    model,
    apiKey: readAgentApiKeyFromEnv(),
  });
}

/** Auto-fix still requires cursor-agent. An OpenAI-compatible review cannot write a fix commit. */
// @signal shouldSkipCursorFixer
export function shouldSkipCursorFixer(provider: AgentProvider): boolean {
  return provider === 'openai_compatible';
}

/**
 * Collects the reports the gate jobs left behind. A report that is present
 * but unreadable is fatal: the pipeline would otherwise merge a PR while
 * genuinely not knowing whether its tests passed.
 */
// @signal readGateReports
export function readGateReports(
  reportsDir: string,
  reader: { exists: (p: string) => boolean; list: (p: string) => string[]; read: (p: string) => string } = {
    exists: existsSync,
    list: readdirSync,
    read: (p) => readFileSync(p, 'utf-8'),
  },
): { ok: true; outcomes: GateOutcome[] } | { ok: false; reason: string } {
  if (!reader.exists(reportsDir)) {
    return { ok: true, outcomes: [] };
  }

  const reports: GateReport[] = [];
  for (const entry of reader.list(reportsDir).filter((name) => name.endsWith('.json')).sort()) {
    const parsed = parseGateReport(reader.read(join(reportsDir, entry)));
    if (!parsed.ok) {
      return { ok: false, reason: `could not read gate report "${entry}": ${parsed.reason}` };
    }
    reports.push(parsed.report);
  }

  return { ok: true, outcomes: mergeGateReports(reports) };
}

/**
 * Asks ql-sprint whether this pull request is a task anybody planned, and turns "no" into one
 * advisory finding.
 *
 * Three silences, and only one of them is a finding:
 *
 * - No ql-sprint configured at all: nothing, not even a log line. A repository governed by a fleet
 *   that runs no orchestrator has no sprint board to be missing from, exactly as it has no
 *   Telegram to be notified in.
 * - ql-sprint configured but unreachable, or answering something unreadable: a warning, and no
 *   finding. Absence of evidence is not evidence - a network that was down must never be reported
 *   on a pull request as "nobody asked for this".
 * - ql-sprint answered, and knows nothing about this pull request: the finding.
 *
 * `should` severity throughout, so it rides along on a MERGE as an advisory comment and can never
 * refuse a pull request - see verdict.decision.taskProvenance#decideTaskProvenance for why that is
 * the only defensible severity for it.
 */
// @signal taskProvenanceFindings
export async function taskProvenanceFindings(
  pr: Pick<PullRequestInfo, 'number' | 'headRef'>,
  logger: Pick<Logger, 'info' | 'warn'>,
  env: NodeJS.ProcessEnv = process.env,
  readTasks: (
    credentials: Parameters<typeof readSprintTasks>[0],
    env?: NodeJS.ProcessEnv,
  ) => Promise<SprintTaskList> = readSprintTasks,
): Promise<Finding[]> {
  const credentials = sprintNotifierCredentialsFromEnv(env);
  if (credentials === undefined) return [];

  const list = await readTasks(credentials, env);
  if (!list.ok) {
    logger.warn(
      'could not check whether this PR belongs to a ql-sprint task, so this run does not claim it ' +
        `is taskless: ${list.reason}`,
    );
    return [];
  }

  const provenance = decideTaskProvenance({ headRef: pr.headRef, prNumber: pr.number, tasks: list.tasks });
  if (provenance.kind === 'task') {
    logger.info(`task: ${provenance.taskId} (matched by ${provenance.matchedBy})`);
    return [];
  }

  logger.info(`task: none - ${provenance.reason}`);
  const finding = taskProvenanceFinding(provenance);
  return finding === null ? [] : [finding];
}

/**
 * What the R4 escalation says, and anything structural a human should see while they are here.
 *
 * The escalation returns before the review, the gates and the verdict ever run, so whatever this
 * comment omits is not reported anywhere else on that pull request. A task folder missing its test
 * plan was, until this carried it, silently unchecked on exactly the pull requests that get the
 * most human attention.
 *
 * Kept pure and separate from `escalateToHuman` so the composition is testable without a GitHub
 * client, the same way complaintReview is.
 */
// @signal protectedPathsComment
export function protectedPathsComment(artifactFindings: readonly Finding[]): string {
  const head =
    'This PR touches pipeline-governance paths (rules, prompts, config, or workflows) and always requires ' +
    'human review — the pipeline never auto-merges or auto-fixes changes to its own laws (RULES.md R4).';

  if (artifactFindings.length === 0) return head;

  return [
    head,
    '---',
    '**Also worth seeing before you review.** These are structural checks, reported here because an ' +
      'R4 escalation stops before the review that would otherwise raise them:',
    ...artifactFindings.map((finding) => `- ${finding.problem}`),
  ].join('\n\n');
}

/**
 * Whether a product repository carries the preview environment ql-docs mandates, as one finding.
 *
 * Structural, before the AI is consulted, for exactly the reason R4 is: whether a folder exists
 * and its compose file names an `edge` service is not a judgement, and a reviewer is the wrong
 * enforcement mechanism for a rule that cannot be argued with. Unlike the task-artifact check it
 * is a hard gate rather than an advisory finding - see previewEnvironmentRefusal for why - so the
 * caller fails the run on it rather than folding it into the verdict.
 */
// @signal previewEnvironmentFindings
export function previewEnvironmentFindings(
  consumerRoot: string,
  areaPaths: AreaPathsConfig,
  logger: Pick<Logger, 'info'>,
): readonly Finding[] {
  const verdict = assessPreviewEnvironment(readPreviewEnvironmentSnapshot(consumerRoot), areaPaths);
  if (verdict.kind === 'not-required') {
    logger.info('preview environment: not required — no apps/*frontend* or apps/*backend* directory');
    return [];
  }
  const finding = previewEnvironmentFinding(verdict);
  if (finding === null) {
    logger.info(`preview environment: ${PREVIEW_ENVIRONMENT_DIR}/ satisfies the contract`);
    return [];
  }
  logger.info(`preview environment: ${String(verdict.kind === 'invalid' ? verdict.violations.length : 0)} violation(s)`);
  return [finding];
}

/**
 * What the pull request is told when its repository has no valid preview environment.
 *
 * A hard failure and not a `must` finding, deliberately. A finding rides into the verdict, which
 * is reached only after the gates are read and the AI review has run - so a repository that
 * cannot be previewed would still spend a review, and could be argued back from BLOCK to MERGE by
 * an attempt cap or a config. Nothing downstream of this can work without the folder: the deploy
 * job has nothing to bring up and the tester nothing to reach. Refusing here, before anything
 * is spent, is the honest shape.
 *
 * It is not an escalation either. The `needs-human` path exists for questions a person has to
 * adjudicate; a missing folder is fixed by its author, so the pull request simply fails and says
 * what is missing, exactly as an unroutable one does.
 */
// @signal previewEnvironmentRefusal
export function previewEnvironmentRefusal(findings: readonly Finding[]): string {
  return [
    '**This repository cannot be previewed, so this pull request fails before review.**',
    ...findings.map((finding) => finding.problem),
    'Nothing downstream of this check can run without that folder: the preview deploy has nothing to bring ' +
      'up, and the automated tester nothing to reach. This is checked structurally, before any model is asked ' +
      'anything, for the same reason RULES.md R4 is - a folder that must exist is not a matter of opinion.',
  ].join('\n\n');
}

/**
 * Whether the task folder this branch names carries the two artifacts an automated tester needs,
 * as one finding.
 *
 * Structural, and computed before the AI review is even considered, for the reason R4 is: whether
 * a file exists is not a judgement, and making a reviewer the enforcement mechanism for one turns
 * an unarguable check into a negotiable opinion.
 *
 * Unlike the protected-paths check above it does not escalate to a human. A missing test plan is
 * not something a person adjudicates - the author adds the file - so it rides the ordinary finding
 * path, where `must` blocks the merge and the message says what to copy from where.
 */
// @signal taskArtifactFindings
export function taskArtifactFindings(
  pr: Pick<PullRequestInfo, 'headRef'>,
  consumerRoot: string,
  requiredChecks: readonly RequiredCheck[],
  logger: Pick<Logger, 'info'>,
): readonly Finding[] {
  const ref = taskFolderRefOf(pr.headRef);
  if (ref === null) {
    logger.info(`task artifacts: not checked — branch ${pr.headRef} names no task folder`);
    return [];
  }

  const parent = join(consumerRoot, 'docs', ref.kind);
  const folder = existsSync(parent)
    ? readdirSync(parent, { withFileTypes: true }).find(
        (entry) => entry.isDirectory() && entry.name.startsWith(`${ref.number}-`),
      )
    : undefined;

  const lookup: TaskFolderLookup =
    folder === undefined
      ? { kind: 'no-folder', ref }
      : {
          kind: 'folder',
          ref,
          path: `docs/${ref.kind}/${folder.name}`,
          files: readdirSync(join(parent, folder.name)),
        };

  const finding = taskArtifactFinding(lookup, requiredChecks);
  if (finding === null) {
    logger.info(`task artifacts: complete in ${lookup.kind === 'folder' ? lookup.path : taskFolderGlobFor(ref)}`);
    return [];
  }
  logger.info(`task artifacts: ${finding.severity} — ${taskFolderGlobFor(ref)}`);
  return [finding];
}

/**
 * The whole request-changes review: the body, and the comments GitHub will actually accept.
 *
 * One function rather than two calls, because the two have to agree and once did not. A `must`
 * finding on a pseudo-path - which is what every failed *required* gate is - was sent to
 * `requestChangesWithComments` unfiltered and 422'd the run that existed to explain it. The filter
 * had been written, for the approval path, and the blocking path simply did not use it.
 *
 * Returning both together means the findings left out of `comments` are reported in `summary` by
 * construction, rather than by a caller remembering to pass them.
 */
// @signal complaintReview
export function complaintReview(
  findings: readonly Finding[],
  attemptNumber: number,
  maxFixAttempts: number,
  advisoryFindings: readonly Finding[] = [],
): { readonly summary: string; readonly comments: readonly ReviewComment[] } {
  // Reported together, weighed apart. The advisory findings appear in this review because nothing
  // else on a FIX or BLOCK verdict ever shows them - `executeMergeDecision`, which posts them on
  // the merge path, is not called here - but they are counted separately and they are never handed
  // to the fixer, which is given `decision.findings` alone.
  const all = [...findings, ...advisoryFindings];
  return {
    summary: formatComplaintSummary(
      findings,
      attemptNumber,
      maxFixAttempts,
      unanchoredFindings(all),
      advisoryFindings.length,
    ),
    comments: inlineComments(all),
  };
}

async function escalateToHuman(
  client: GithubClient,
  pr: PullRequestInfo,
  logger: Logger,
  reason: string,
  comment: string,
): Promise<void> {
  logger.error(reason);
  await recordVerdictLabel(client, pr, NEEDS_HUMAN_LABEL);
  await client.postComment(pr, comment);
  core.setFailed(reason);
}

/**
 * The pipeline check: everything after the gates. Runs even when a gate
 * job failed, because a broken build is a finding the fix agent can repair
 * — halting the chain on a red gate would throw that away.
 */
// @signal runGovern
export async function runGovern(reportsDir: string): Promise<void> {
  const { config, pr, client, logger, consumerRoot, runUrl } = createPipelineContext();
  const routing = await resolveRouting(client, pr, config);

  if (routing.kind === 'not-governed') {
    logger.info(`leaving this PR untouched: ${routing.reason}`);
    return;
  }

  if (routing.kind === 'unroutable') {
    logger.error('PR is unroutable', { reason: routing.reason });
    await client.postComment(
      pr,
      'This PR could not be routed: no commit (and not the PR title either) matches the required ' +
        '`<type>(<area>): <description>` conventional-commit format, so the pipeline cannot tell which ' +
        'rules apply. Reword a commit or the PR title and push again.',
    );
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

  // Whether the task folder this branch names carries the test plan and the seed data an
  // automated tester runs on. Structural, and ahead of the R4 escalation below rather than
  // after it: the two questions are orthogonal, and a person summoned to review a governance
  // change should not have to discover separately that the folder is also incomplete. An R4
  // pull request used to return before this ran, so its task folder was never checked at all.
  const artifactFindings = taskArtifactFindings(pr, consumerRoot, config.merge.requiredChecks, logger);

  // Whether a product repository carries the preview environment ql-docs mandates. Structural,
  // like the two checks around it, and decided here so an R4 escalation can carry it too - a
  // person summoned to review a governance change should see that the repository also cannot
  // be previewed, rather than discover it on the next pull request.
  const previewFindings = previewEnvironmentFindings(consumerRoot, config.areas.paths, logger);

  // RULES.md R4: the pipeline never auto-merges or auto-fixes changes to
  // its own governance paths. Checked structurally and before the AI is
  // consulted — making the AI's judgment the enforcement mechanism for its
  // own constitution would defeat the point.
  if (touchesProtectedPaths(changedFiles, config.fixer.protectedPaths)) {
    await escalateToHuman(
      client,
      pr,
      logger,
      'PR touches protected pipeline-governance paths and requires human review',
      protectedPathsComment([...artifactFindings, ...previewFindings]),
    );
    return;
  }

  // The preview environment contract, enforced rather than advised. A hard failure and not a
  // finding: nothing after this point can work for a repository that cannot be previewed, so
  // nothing after this point is spent on it - see previewEnvironmentRefusal.
  if (previewFindings.length > 0) {
    const reason = `this repository has no valid preview environment under ${PREVIEW_ENVIRONMENT_DIR}/`;
    logger.error(reason);
    await client.postComment(pr, previewEnvironmentRefusal(previewFindings));
    core.setFailed(reason);
    return;
  }

  const gateReports = readGateReports(reportsDir);
  if (!gateReports.ok) {
    await escalateToHuman(
      client,
      pr,
      logger,
      gateReports.reason,
      `**The pipeline could not read the gate results**, so it cannot tell whether this PR builds or passes ` +
        `its tests, and will not merge it:\n\n> ${gateReports.reason}`,
    );
    return;
  }
  const gateOutcomes = gateReports.outcomes;

  const findingsFromGates = gateFindings(gateOutcomes, config.merge.requiredChecks);
  const gatesBlock = findingsFromGates.some((finding) => finding.severity === 'must');

  let findings: readonly Finding[] = findingsFromGates;
  let reviewRan = false;
  // Out here for the same reason as `reviewRan`: it is gathered in the review's inner block and
  // read again by the fixer, which runs well after that block has closed.
  let direction = '';
  // Declared out here for the same reason as `reviewRan`: the review runs in
  // an inner block, and the audit summary is rendered after it.
  const standardsCoverage: StandardsCoverage[] = [];
  let promptCoverage: PromptCoverage | undefined;

  if (gatesBlock) {
    logger.info('skipping AI review: a required gate failed, so there is no point reviewing code that fails to build');
  } else if (!isReviewRequired(config.merge.requiredChecks)) {
    logger.info('skipping AI review: "ai-review" is not in merge.required_checks for this repo');
  } else {
    const resolvedRules = resolveRuleFiles(reviewAreas, { pipelineRoot: PIPELINE_ROOT, consumerRoot });
    for (const rule of resolvedRules) {
      logger.info(`rules: ${rule.id} (${rule.source})`);
    }

    const reviewKind = reviewKindFor(pr.headRef, route.types);
    logger.info(`review pack: ${reviewKind}`);

    // Standards are the workflow/review/pr-* pack, read from house-api.
    // Credentials are read here, not in createPipelineContext, so `gate`
    // and the scaffolding commands never have to know house-api exists.
    let standardsResolution: StandardsResolution;
    if (config.standards.enabled) {
      try {
        const credentials = readHouseCredentialsFromEnv();
        if (credentials.houseApiUrlSource === LEGACY_HOUSE_API_URL_VAR) {
          logger.warn(
            `${LEGACY_HOUSE_API_URL_VAR} is deprecated — rename this secret to ${HOUSE_API_URL_VAR}. ` +
              'The old name is still read, but will stop being read in a future release.',
          );
        }
        const houseReader = await createHouseStandardsReader(credentials, consumerRoot, config.standards.root);
        standardsResolution = await resolveStandards(
          reviewAreas,
          config.standards,
          consumerRoot,
          houseReader,
          reviewKind,
        );
      } catch (cause) {
        await escalateToHuman(
          client,
          pr,
          logger,
          `could not reach house-api for engineering standards: ${String(cause)}`,
          '**The engineering standards for this PR could not be loaded** — house-api or ql-auth could not be ' +
            `reached, so this PR was not reviewed against them and will not be merged:\n\n> ${String(cause)}\n\n` +
            'Check `QL_HOUSE_API_URL`, `QL_AUTH_URL`, `QL_AUTH_CLIENT_ID`, and `QL_AUTH_CLIENT_SECRET`, or set ' +
            '`standards.enabled: false` in the pipeline config to review without them.',
        );
        return;
      }
    } else {
      standardsResolution = { standards: [], missing: [] };
    }
    const { standards, missing } = standardsResolution;
    for (const standard of standards) {
      logger.info(`standards: ${standard.id} (${standard.docPath})`);
      if (standard.truncated) {
        // A bare [truncated] flag made a review's coverage unknowable: it did
        // not say how much went, or which rules. Name them.
        logger.info(`  [per-area cap] ${describeDroppedSections(standard.droppedSections, standard.droppedChars)}`);
        standardsCoverage.push({
          id: standard.id,
          keptSections: (standard.text.match(/^## /gm) ?? []).length,
          droppedSections: standard.droppedSections.length,
          droppedChars: standard.droppedChars,
        });
      }
    }

    // A configured standards document that isn't there means this review
    // would silently be weaker than the repo believes it is — the same
    // "documentation promises what the code doesn't do" failure RULES.md
    // R6.0 exists to prevent. Fail loudly instead: it is trivially fixed
    // by correcting the configured path, granting the token the missing
    // route, or turning standards off.
    if (missing.length > 0) {
      await escalateToHuman(
        client,
        pr,
        logger,
        `engineering standards could not be loaded: ${missing.join(', ')}`,
        '**The engineering standards for this PR could not be loaded**, so it was not reviewed against them ' +
          'and will not be merged. Missing from house-api:\n\n' +
          missing.map((path) => `- \`${path}\``).join('\n') +
          '\n\nCheck that house-api is serving `workflow/review/` in ql-docs, and that the ' +
          '`github_agent` token carries `review:*` (or `review:pr-feature`, `review:pr-fix`, ' +
          '`review:pr-bugfix`), or set `standards.enabled: false` in the pipeline config to ' +
          'review without them.',
      );
      return;
    }

    const { description, diff } = await client.getPullRequestDetails(pr);
    let reviewAgentRunner: CursorAgentRunner | undefined;
    if (config.agent.provider === 'openai_compatible') {
      try {
        reviewAgentRunner = openAiCompatibleReviewerFrom(config);
      } catch (cause) {
        await escalateToHuman(
          client,
          pr,
          logger,
          `openai-compatible reviewer could not start: ${String(cause)}`,
          '**The OpenAI-compatible reviewer could not start**, so this PR was not reviewed:\n\n' +
            `> ${String(cause)}\n\n` +
            'Set `QL_PIPELINE_AGENT_API_KEY` or `OPENAI_API_KEY` as a repository secret. ' +
            'Do not put the token in `pipeline.config.yml`.',
        );
        return;
      }
    }
    // Stated in the log next to the rules and standards, for the same
    // reason: a model pinned in config is only useful if you can confirm
    // from the run which one actually answered.
    logger.info(
      `agent: provider=${config.agent.provider} review model=${config.agent.review.model ?? '(provider default)'}`,
    );
    const promptTemplate = loadPromptTemplate('reviewer.md');
    // What people have said on this PR, with everything the pipeline itself wrote removed - see
    // shared.core.humanDirection for why that filter is the loop guard and not just tidiness.
    // Read once and reused by the fixer: the agent that writes the code is the one an instruction
    // like "use the existing helper" has to reach.
    direction = formatDirection(await client.listComments(pr).catch(() => []));
    if (direction !== '') {
      logger.info('review: carrying direction from the PR conversation');
    }
    const reviewBase = {
      areas: reviewAreas,
      humanDirection: direction,
      ruleFiles: [...ruleFileIds(resolvedRules), ...standardsIds(standards)],
      rulesText: formatRulesForPrompt(resolvedRules),
      gateOutcomes,
      prDescription: description,
      diff,
    };
    const reviewOptions = {
      cwd: consumerRoot,
      ...(config.agent.review.model !== null ? { model: config.agent.review.model } : {}),
      ...(reviewAgentRunner !== undefined ? { agentRunner: reviewAgentRunner } : {}),
    };

    // Packed by budget, not one pass per document: a PR whose standards
    // already fit runs exactly one pass, as it always has. Extra passes are
    // bought only where the alternative is dropping text.
    const passes = planReviewPasses(standards, standardsBudgetFor(promptTemplate, { ...reviewBase, standardsText: '' }));
    if (passes.length > 1) {
      logger.info(`review: ${passes.length} passes, so no standards section has to be dropped`);
    }

    // One entry per review pass, not one flat list. The pass boundary is what tells a defect
    // two passes both saw from two defects one pass found on the same line, and flattening here
    // is what left dedupeFindings unable to collapse the first - see docs/bugfixes/045.
    const reviewedByPass: Finding[][] = [];
    let reviewFailure: string | null = null;

    for (const [index, pass] of passes.entries()) {
      const label =
        passes.length > 1 ? ` [pass ${index + 1}/${passes.length}: ${pass.standards.map((standard) => standard.docPath).join(', ')}]` : '';
      const reviewResult = await runReview(
        { ...reviewBase, standardsText: formatStandardsForPrompt(pass.standards) },
        promptTemplate,
        reviewOptions,
      );

      // The prompt ceiling is the layer that used to cut in silence. It shares
      // its budget with the diff, so it cuts by a different amount on every PR.
      // With passes planned to fit, it should now cut nothing - and this is how
      // we find out rather than assume.
      const promptCut = reviewResult.standardsTruncation;
      if (promptCut.truncated) {
        promptCoverage = {
          droppedSections: (promptCoverage?.droppedSections ?? 0) + promptCut.droppedSections.length,
          droppedChars: (promptCoverage?.droppedChars ?? 0) + promptCut.droppedChars,
          omitted: (promptCoverage?.omitted ?? false) || promptCut.standardsOmitted,
        };
        logger.info(
          promptCut.standardsOmitted
            ? `prompt${label}: the diff filled the budget; no engineering standards were sent`
            : `prompt${label}: standards cut further to fit the prompt ceiling, ${describeDroppedSections(promptCut.droppedSections, promptCut.droppedChars)}`,
        );
      }

      if (!reviewResult.ok) {
        // Reviewing some of the standards and calling that a pass is the exact
        // failure this design exists to end, so one bad pass fails the run.
        reviewFailure = `${reviewResult.reason}${label}`;
        break;
      }
      for (const { finding, reason } of reviewResult.outcome.discarded) {
        logger.warn('discarded ungrounded finding', { rule: finding.rule, file: finding.file, reason });
      }
      reviewedByPass.push([...reviewResult.outcome.findings]);
    }

    if (reviewFailure !== null) {
      await escalateToHuman(
        client,
        pr,
        logger,
        `review could not be completed: ${reviewFailure}`,
        `**The AI review could not be completed**, so this PR is blocked rather than merged:\n\n> ${reviewFailure}`,
      );
      return;
    }
    reviewRan = true;
    findings = [...findingsFromGates, ...dedupeFindings(reviewedByPass)];
  }

  // Whether anybody planned this work, asked after the review rather than before it: it is
  // advisory, so it must not stand between a pull request and the review that judges its code.
  //
  // The artifact findings were decided structurally, long before the review; they join here
  // because this is where everything that weighs on the verdict is gathered. They do not skip the
  // review the way a red gate does - a folder missing its test plan says nothing about whether the
  // code in the pull request is worth reviewing.
  findings = [...findings, ...artifactFindings, ...(await taskProvenanceFindings(pr, logger))];

  const commitMessages = await client.listCommitMessages(pr);
  // Best-effort, like the direction block that reads the same endpoint: a pull request whose
  // comments cannot be read falls back to commit evidence rather than failing the run. That is
  // right for the cursor provider, which leaves a [bot] commit per attempt, and under ql_agents
  // it starts a fresh count rather than refusing a fix nobody has attempted yet.
  const priorComments = await client.listComments(pr).catch(() => []);
  const attemptsSoFar = countFixAttempts(
    commitMessages,
    priorComments.map((comment) => comment.body),
  );
  const attemptNumber = attemptsSoFar + 1;
  const decision = decidePipelineOutcome({
    findings,
    attemptsSoFar,
    maxFixAttempts: config.fixer.maxFixAttempts,
    fixAdvisory: config.fixer.fixAdvisory,
  });

  await client.postComment(
    pr,
    formatAuditSummary({
      areas: route.areas,
      gateOutcomes,
      findingCount: findings.length,
      decision,
      attemptNumber,
      maxFixAttempts: config.fixer.maxFixAttempts,
      targetBranch,
      reviewRan,
      standardsCoverage,
      runUrl,
      ...(promptCoverage !== undefined ? { promptCoverage } : {}),
    }),
  );

  /**
   * Tells ql-sprint what this run decided, so it reaches Telegram.
   *
   * Best-effort, exactly like `answerThreads` below and for the same reason: the review has
   * already landed on the pull request by the time this is called, and a messenger that cannot
   * deliver must not undo it. A fleet with no ql-sprint configured does nothing here at all, which
   * is the ordinary case rather than a misconfiguration.
   */
  const notifySprint = async (verdict: SprintVerdict, summaryText: string): Promise<void> => {
    const credentials = sprintNotifierCredentialsFromEnv();
    if (credentials === undefined) return;
    try {
      await createSprintNotifier(credentials)({
        repo: `${pr.owner}/${pr.repo}`,
        prNumber: pr.number,
        verdict,
        title: pr.title,
        summary: summaryText,
        url: `https://github.com/${pr.owner}/${pr.repo}/pull/${String(pr.number)}`,
        ...(verdict === 'fix' ? { attempt: { number: attemptNumber, of: config.fixer.maxFixAttempts } } : {}),
      });
    } catch (error) {
      logger.warn(`could not tell ql-sprint what this run decided: ${String(error)}`);
    }
  };

  /**
   * Closes the threads this pipeline opened, once a review comes back with nothing to say.
   *
   * Best-effort, like the replies and the notification: a thread that stays open is untidy, and a
   * governance run that failed over untidiness would be worse. It runs only on the no-findings
   * path, because that is the only evidence that a complaint is actually dealt with rather than
   * merely written about — see threadsToResolve.
   */
  const closeSettledThreads = async (findingsRaised: number): Promise<void> => {
    try {
      const threads = await client.listReviewThreads(pr);
      const ids = threadsToResolve({ threads, findingsRaised });
      for (const id of ids) {
        await client.resolveReviewThread(id);
      }
      if (ids.length > 0) {
        logger.info(`resolved ${String(ids.length)} finding thread(s) this review no longer raises`);
      }
    } catch (error) {
      logger.warn(`could not resolve settled finding threads: ${String(error)}`);
    }
  };

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
      // The verdict that most needs to reach a person: nothing else moves until somebody looks.
      await closeSettledThreads(decision.advisoryFindings.length);
      await notifySprint(
        'awaiting-human',
        'Reviewed and approved. Labelled ready-to-merge — the pipeline will not merge it itself.',
      );
      return;
    }
    logger.info('merged', { targetBranch, advisoryFindingCount: decision.advisoryFindings.length });
    await closeSettledThreads(decision.advisoryFindings.length);
    await notifySprint('merge', `Merged into ${targetBranch}.`);
    return;
  }

  // FIX and BLOCK both mean something is wrong; post the complaint either
  // way so a human can see exactly what, without digging through CI logs.
  const { summary, comments } = complaintReview(
    decision.findings,
    attemptNumber,
    config.fixer.maxFixAttempts,
    decision.advisoryFindings,
  );
  const complaint = await recordComplaint(client, pr, summary, comments);
  const findingThreads = complaint.threads;
  if (complaint.outcome === 'self-authored') {
    logger.info('recorded the findings as a comment review; GitHub refuses a self-requested change');
  }

  /**
   * Answers every thread this review just opened, once the run knows what it did about them.
   *
   * Best-effort on purpose: a reply that fails must not turn a completed review, or a fix that is
   * already pushed, into a failed run. The worst case is a thread left unanswered, which is where
   * this started.
   */
  const answerThreads = async (outcome: FixAttemptOutcome): Promise<void> => {
    const body = replyForFinding({ outcome, attemptNumber, maxFixAttempts: config.fixer.maxFixAttempts });
    for (const commentId of findingThreads) {
      try {
        await client.replyToReviewComment(pr, commentId, body);
      } catch (error) {
        logger.warn(`could not reply in a finding thread: ${String(error)}`);
      }
    }
  };

  if (decision.kind === 'BLOCK') {
    await answerThreads({ kind: 'not-attempted', why: `the review blocked this PR (${decision.reason}).` });
    logger.error(`blocked: ${decision.reason}`);
    await recordVerdictLabel(client, pr, NEEDS_HUMAN_LABEL);
    await notifySprint('block', decision.reason);
    core.setFailed(`blocked: ${decision.reason}`);
    return;
  }

  // A fork PR's branch lives in someone else's repository, which this
  // token cannot push to — review it, complain about it, but never
  // pretend a fix was attempted.
  if (pr.isFork) {
    await answerThreads({
      kind: 'not-attempted',
      why: 'this PR comes from a fork, whose branch this token cannot push to.',
    });
    await escalateToHuman(
      client,
      pr,
      logger,
      'cannot auto-fix a PR from a fork; this needs a human',
      'This PR comes from a fork, so the pipeline cannot push a fix commit to its branch. ' +
        'The findings above need to be addressed manually.',
    );
    await notifySprint('block', 'Changes requested, and this PR comes from a fork — no fix can be pushed to it.');
    return;
  }

  if (shouldSkipCursorFixer(config.agent.provider)) {
    await answerThreads({
      kind: 'not-attempted',
      why: 'the review ran against an OpenAI-compatible endpoint and the fixer is Cursor-only.',
    });
    await escalateToHuman(
      client,
      pr,
      logger,
      'review used an OpenAI-compatible endpoint; auto-fix is Cursor-only this round',
      'This review ran against an OpenAI-compatible API. The automated fixer still requires ' +
        '`cursor-agent`, so the findings above need a human rather than a pretended HTTP fix.',
    );
    await notifySprint('block', 'Changes requested, and auto-fix is Cursor-only — this review did not use it.');
    return;
  }

  const primaryArea = route.areas[0]!;
  logger.info(`agent: fix provider=${config.agent.provider} model=${config.agent.fix.model ?? '(provider default)'}`);

  /**
   * Says, in every thread this review opened, that a named agent now has the findings.
   *
   * Posted from inside the dispatch rather than after it, because "an agent has this" is only
   * worth saying while it is still true that nobody knows. Best-effort like every other reply
   * here: a thread that stays quiet is untidy, a governance run that failed over untidiness
   * would be worse.
   */
  const announcePickup = async (runId: string): Promise<void> => {
    const body = pickedUpReply({ runId, attemptNumber, maxFixAttempts: config.fixer.maxFixAttempts });
    for (const commentId of findingThreads) {
      try {
        await client.replyToReviewComment(pr, commentId, body);
      } catch (error) {
        logger.warn(`could not announce the pickup in a finding thread: ${String(error)}`);
      }
    }
  };

  let fixOutcome;
  if (config.agent.provider === 'ql_agents') {
    const agentsCredentials = agentsFixerCredentialsFromEnv();
    if (agentsCredentials === undefined) {
      await answerThreads({
        kind: 'not-attempted',
        why: 'the ql_agents provider is configured but QL_AGENTS_URL (or the ql-auth credentials) is unset.',
      });
      await escalateToHuman(
        client,
        pr,
        logger,
        'agent.provider is ql_agents but this fleet has no ql-agents configured',
        'This repository asks for the `ql_agents` fix provider, but `QL_AGENTS_URL` and the ' +
          '`QL_AUTH_*` credentials are not all set on this workflow, so no agent could be reached. ' +
          'The findings above need a human until that is configured.',
      );
      await notifySprint('block', 'Changes requested, but ql-agents is not configured on this fleet.');
      return;
    }
    fixOutcome = await runAgentsFix(decision.findings, primaryArea, {
      credentials: agentsCredentials,
      repoUrl: `https://github.com/${pr.owner}/${pr.repo}.git`,
      branch: pr.headRef,
      taskId: `pr-${String(pr.number)}`,
      worktreeBaseDir: agentsCredentials.worktreeBaseDir,
      protectedPaths: config.fixer.protectedPaths,
      attemptNumber,
      humanDirection: direction,
      onDispatched: announcePickup,
      ...(config.agent.fix.model !== null ? { model: config.agent.fix.model } : {}),
    });
  } else {
    fixOutcome = await runFix(decision.findings, loadPromptTemplate('fixer.md'), primaryArea, {
      cwd: consumerRoot,
      branch: pr.headRef,
      protectedPaths: config.fixer.protectedPaths,
      attemptNumber,
      maxFixAttempts: config.fixer.maxFixAttempts,
      humanDirection: direction,
      ...(config.agent.fix.model !== null ? { model: config.agent.fix.model } : {}),
    });
  }

  if (fixOutcome.kind === 'committed') {
    // Answered before the run ends, because this run is about to mark itself superseded - the
    // push starts a fresh one, and nothing later would know which threads these were.
    await answerThreads({
      kind: 'committed',
      commitMessage: fixOutcome.commitMessage,
      files: fixOutcome.files,
    });
    logger.info('fix committed and pushed; the push re-triggers this pipeline', {
      commitMessage: fixOutcome.commitMessage,
      files: fixOutcome.files,
    });
    await notifySprint('fix', `Pushed ${fixOutcome.commitMessage}. The next review decides whether it settled the findings.`);
    core.setFailed(
      'the pipeline pushed a fix commit; this run is superseded by the one that commit triggers',
    );
    return;
  }

  if (fixOutcome.kind === 'no-changes') {
    await answerThreads({ kind: 'no-changes' });
    await escalateToHuman(
      client,
      pr,
      logger,
      'the fix agent made no usable changes; this needs a human',
      'The automated fix agent ran but produced no usable changes (or only touched protected paths, which are ' +
        'always reverted). The findings above need to be addressed manually.',
    );
    await notifySprint('fix', 'The fix agent ran and produced no usable change, so the findings stand.');
    return;
  }

  await escalateToHuman(
    client,
    pr,
    logger,
    `fix attempt failed: ${fixOutcome.reason}`,
    `**The automated fix attempt failed.**\n\n> ${fixOutcome.reason}`,
  );
  await notifySprint('fix', `The fix attempt failed: ${fixOutcome.reason}`);
}
