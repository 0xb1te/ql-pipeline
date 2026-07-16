import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '@actions/core';
import { context } from '@actions/github';
import { countFixAttempts } from './fixer/attempt-counter.js';
import { formatComplaintSummary } from './fixer/complaint.js';
import { runFix } from './fixer/fixer.js';
import { executeMergeDecision, findingToReviewComment } from './merger/merger.js';
import { runReview } from './reviewer/reviewer.js';
import { allGatesPassed, runGates } from './router/gate-runner.js';
import { determineRoute } from './router/router.js';
import { touchesProtectedPaths } from './router/self-protection.js';
import { formatAuditSummary } from './shared/audit-summary.js';
import { loadConfig } from './shared/config.js';
import { createGithubClient, readPullRequestContext, type ActionsEventContext } from './shared/github-client.js';
import { createLogger } from './shared/logger.js';
import type { Finding, GateOutcome } from './shared/types.js';
import { decidePipelineOutcome } from './verdict/verdict.js';

const DEFAULT_CONFIG_PATH = '.github/pipeline.config.yml';

// dist/main.js -> ql-pipeline's own checkout root is one level up. rules/
// and prompts/ ship inside ql-pipeline itself, not the consumer repo being
// governed, so they're resolved from here rather than from process.cwd().
const PIPELINE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadRulesText(ruleFiles: readonly string[]): string {
  return ruleFiles.map((file) => readFileSync(join(PIPELINE_ROOT, 'rules', file), 'utf-8')).join('\n\n');
}

function loadPromptTemplate(fileName: string): string {
  return readFileSync(join(PIPELINE_ROOT, 'prompts', fileName), 'utf-8');
}

function gateFailureToFinding(outcome: GateOutcome): Finding {
  return {
    severity: 'must',
    rule: `gate#${outcome.area}-${outcome.gate}`,
    file: '(gate)',
    line: 1,
    problem: `${outcome.area} ${outcome.gate} gate failed for command \`${outcome.command}\`:\n${outcome.output}`,
    suggestedFix: null,
    autoFixable: true,
  };
}

async function main(): Promise<void> {
  const logger = createLogger('info');

  const token = process.env['GITHUB_TOKEN'];
  if (token === undefined || token.length === 0) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }
  const configPath = process.env['PIPELINE_CONFIG_PATH'] ?? DEFAULT_CONFIG_PATH;

  const config = loadConfig(configPath);
  // @actions/github's real payload type only declares `pull_request.number`
  // explicitly and leaves the rest (including `title`) to a `[key: string]:
  // any` catch-all, so it doesn't structurally satisfy our stricter
  // ActionsEventContext — even though the real webhook payload always has a
  // string `title` at runtime. Narrowing that gap here keeps
  // readPullRequestContext's own contract honest and unit-testable.
  const pr = readPullRequestContext(context as unknown as ActionsEventContext);
  const client = createGithubClient(token);

  const commitMessages = await client.listCommitMessages(pr);
  const route = determineRoute({ commitMessages, prTitle: pr.title }, config);

  if (!route.ok) {
    logger.error('PR is unroutable', { reason: route.reason });
    core.setFailed(route.reason);
    return;
  }

  logger.info('routed PR', { areas: route.decision.areas, types: route.decision.types });
  await client.addLabels(
    pr,
    route.decision.areas.map((area) => `area:${area}`),
  );

  // RULES.md R4 / AGENT.md invariant #5: the pipeline never auto-merges or
  // auto-fixes changes to its own governance paths, structurally — not by
  // trusting the AI review to notice. This check runs before gates/review
  // so a protected-path PR never even reaches the AI.
  const changedFiles = await client.listChangedFiles(pr);
  if (touchesProtectedPaths(changedFiles, config.fixer.protectedPaths)) {
    logger.error('PR touches protected pipeline-governance paths; always requires a human', {
      protectedPaths: config.fixer.protectedPaths,
    });
    await client.addLabels(pr, ['needs-human']);
    await client.postComment(
      pr,
      'This PR touches pipeline-governance paths (rules, prompts, config, or workflows) and always requires human review — the pipeline never auto-merges or auto-fixes changes to its own laws (RULES.md R4).',
    );
    core.setFailed('PR touches protected paths and requires human review');
    return;
  }

  const gateOutcomes = await runGates(route.decision.gates, { cwd: process.cwd() });
  for (const outcome of gateOutcomes) {
    logger.info(`gate ${outcome.area}/${outcome.gate}: ${outcome.passed ? 'passed' : 'FAILED'}`);
    if (!outcome.passed) {
      logger.error(outcome.output);
    }
  }

  let findings: readonly Finding[];

  if (!allGatesPassed(gateOutcomes)) {
    // A build/test break is reviewed the same as any other finding (plan.md
    // §4.3) — skip the (expensive) AI review entirely rather than reviewing
    // code that doesn't even build.
    findings = gateOutcomes.filter((outcome) => !outcome.passed).map(gateFailureToFinding);
  } else {
    const { description, diff } = await client.getPullRequestDetails(pr);
    const reviewResult = await runReview(
      {
        areas: route.decision.areas,
        ruleFiles: route.decision.ruleFiles,
        rulesText: loadRulesText(route.decision.ruleFiles),
        gateOutcomes,
        prDescription: description,
        diff,
      },
      loadPromptTemplate('reviewer.md'),
      { cwd: process.cwd() },
    );

    if (!reviewResult.ok) {
      logger.error('review could not be completed', { reason: reviewResult.reason });
      core.setFailed(reviewResult.reason);
      return;
    }
    findings = reviewResult.outcome.findings;
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
    }),
  );

  if (decision.kind === 'MERGE') {
    await executeMergeDecision(client, pr, decision.advisoryFindings, config.merge);
    logger.info('merged', { advisoryFindingCount: decision.advisoryFindings.length });
    return;
  }

  // FIX and BLOCK both mean something is wrong; post the complaint either
  // way so a human sees exactly what, rather than having to dig through
  // Action logs (whether it's day-one-unfixable, or attempts exhausted).
  const summary = formatComplaintSummary(decision.findings, attemptNumber, config.fixer.maxFixAttempts);
  await client.requestChangesWithComments(pr, summary, decision.findings.map(findingToReviewComment));

  if (decision.kind === 'BLOCK') {
    await client.addLabels(pr, ['needs-human']);
    core.setFailed(`blocked: ${decision.reason}`);
    return;
  }

  const primaryArea = route.decision.areas[0]!;
  const fixOutcome = await runFix(decision.findings, loadPromptTemplate('fixer.md'), primaryArea, {
    cwd: process.cwd(),
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

  await client.addLabels(pr, ['needs-human']);
  if (fixOutcome.kind === 'no-changes') {
    core.setFailed('the fix agent made no usable changes; this needs a human');
    return;
  }
  core.setFailed(`fix attempt failed: ${fixOutcome.reason}`);
}

main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error : String(error));
});
