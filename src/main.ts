import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '@actions/core';
import { context } from '@actions/github';
import { executeMergeDecision } from './merger/merger.js';
import { runReview } from './reviewer/reviewer.js';
import { allGatesPassed, runGates } from './router/gate-runner.js';
import { determineRoute } from './router/router.js';
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

function loadReviewPromptTemplate(): string {
  return readFileSync(join(PIPELINE_ROOT, 'prompts', 'reviewer.md'), 'utf-8');
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
      loadReviewPromptTemplate(),
      { cwd: process.cwd() },
    );

    if (!reviewResult.ok) {
      logger.error('review could not be completed', { reason: reviewResult.reason });
      core.setFailed(reviewResult.reason);
      return;
    }
    findings = reviewResult.outcome.findings;
  }

  // Phase 4 adds real fix-attempt tracking (e.g. via a PR label/comment
  // counter); until then every run is attempt 0, so any auto-fixable
  // finding always resolves to FIX below rather than exhausting attempts.
  const decision = decidePipelineOutcome({ findings, attemptsSoFar: 0, maxFixAttempts: config.fixer.maxFixAttempts });

  if (decision.kind === 'MERGE') {
    await executeMergeDecision(client, pr, decision.advisoryFindings, config.merge);
    logger.info('merged', { advisoryFindingCount: decision.advisoryFindings.length });
    return;
  }

  if (decision.kind === 'FIX') {
    // The fix agent doesn't exist yet (Phase 4) — fail the check rather
    // than silently merging or looping, per RULES.md R4/AGENT.md's
    // fail-closed invariant.
    core.setFailed(
      `review found ${decision.findings.length} finding(s) that need a fix; automatic fixing is not implemented yet (Phase 4)`,
    );
    return;
  }

  core.setFailed(`blocked: ${decision.reason}`);
}

main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error : String(error));
});
