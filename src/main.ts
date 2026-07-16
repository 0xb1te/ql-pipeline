import * as core from '@actions/core';
import { context } from '@actions/github';
import { allGatesPassed, runGates } from './router/gate-runner.js';
import { determineRoute } from './router/router.js';
import { loadConfig } from './shared/config.js';
import { createGithubClient, readPullRequestContext, type ActionsEventContext } from './shared/github-client.js';
import { createLogger } from './shared/logger.js';

const DEFAULT_CONFIG_PATH = '.github/pipeline.config.yml';

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

  const outcomes = await runGates(route.decision.gates, { cwd: process.cwd() });
  for (const outcome of outcomes) {
    logger.info(`gate ${outcome.area}/${outcome.gate}: ${outcome.passed ? 'passed' : 'FAILED'}`);
    if (!outcome.passed) {
      logger.error(outcome.output);
    }
  }

  if (!allGatesPassed(outcomes)) {
    core.setFailed('one or more gates failed; see logs above');
    return;
  }

  logger.info('gates passed; AI review is not implemented yet (Phase 3), so this run stops here');
}

main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error : String(error));
});
