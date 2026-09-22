// @neuron entrypoint.cli.bootstrap
import { context } from '@actions/github';
import { couldGovernPullRequest, governsPullRequest, resolveTargetBranch } from '../merger/target-branch.js';
import { determineRoute } from '../router/router.js';
import { loadConfig } from '../shared/config.js';
import {
  createGithubClient,
  readPullRequestContext,
  type ActionsEventContext,
  type GithubClient,
  type PullRequestInfo,
} from '../shared/github-client.js';
import { createLogger, type Logger } from '../shared/logger.js';
import type { PipelineConfig, RouteDecision } from '../shared/types.js';

const DEFAULT_CONFIG_PATH = '.github/pipeline.config.yml';

/**
 * The Actions run this process belongs to, as a URL, or null when it is not running in Actions.
 *
 * Pure in its argument so it can be tested without mutating the real environment, and read here
 * because bootstrap is where this surface reads `process.env` at all.
 *
 * It is the only identity a governance run has that a reader can act on. `cursor-agent` is
 * spawned with `--print --output-format json` and the runner keeps stdout, stderr and an exit
 * code, so there is no session id to quote at anybody. The run page is also the only place a
 * *cancelled* attempt is visible, and consumers set `concurrency.cancel-in-progress`, so a push
 * silently ends a fix attempt that the summary comment has already announced.
 */
// @signal actionsRunUrl
export function actionsRunUrl(env: Readonly<Record<string, string | undefined>>): string | null {
  const server = env['GITHUB_SERVER_URL'] ?? '';
  const repository = env['GITHUB_REPOSITORY'] ?? '';
  const runId = env['GITHUB_RUN_ID'] ?? '';
  if (server === '' || repository === '' || runId === '') {
    return null;
  }
  return `${server}/${repository}/actions/runs/${runId}`;
}

export interface PipelineContext {
  readonly config: PipelineConfig;
  readonly pr: PullRequestInfo;
  readonly client: GithubClient;
  readonly logger: Logger;
  /** The repo under review — the process working directory in every job. */
  readonly consumerRoot: string;
  /** The Actions run this job is part of, or null when it is not running in Actions. */
  readonly runUrl: string | null;
}

/**
 * Everything every job needs before it can do anything: credentials,
 * config, and the PR it is acting on. Shared by the gate jobs and the
 * pipeline job so the three checks cannot drift apart on setup.
 */
// @signal createPipelineContext
export function createPipelineContext(): PipelineContext {
  const token = process.env['GITHUB_TOKEN'];
  if (token === undefined || token.length === 0) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }

  const configPath = process.env['PIPELINE_CONFIG_PATH'] ?? DEFAULT_CONFIG_PATH;

  return {
    config: loadConfig(configPath),
    // @actions/github's payload type leaves most of `pull_request` to a
    // `[key: string]: any` catch-all, so it doesn't structurally satisfy
    // our stricter ActionsEventContext even though the real webhook
    // payload always carries these fields.
    pr: readPullRequestContext(context as unknown as ActionsEventContext),
    client: createGithubClient(token),
    logger: createLogger('info'),
    consumerRoot: process.cwd(),
    runUrl: actionsRunUrl(process.env),
  };
}

export type RoutingOutcome =
  | { readonly kind: 'proceed'; readonly route: RouteDecision; readonly targetBranch: string }
  | { readonly kind: 'not-governed'; readonly reason: string }
  | { readonly kind: 'unroutable'; readonly reason: string }
  | { readonly kind: 'target-conflict'; readonly reason: string };

/**
 * Decides whether this PR is in scope and, if so, what it routes to. Every
 * job runs this independently rather than one job routing on behalf of the
 * others: it costs a single API call, and it means each check reports the
 * truth about the PR in front of it instead of inheriting a verdict from a
 * job that may have been skipped.
 *
 * Callers decide how loudly to react — a gate job that can't route just
 * fails; the pipeline job additionally comments and labels.
 */
// @signal resolveRouting
export async function resolveRouting(
  client: Pick<GithubClient, 'listCommitMessages'>,
  pr: PullRequestInfo,
  config: PipelineConfig,
): Promise<RoutingOutcome> {
  // Cheapest possible exit for a PR this pipeline has no authority over:
  // no API calls at all, let alone gates or AI spend.
  if (!couldGovernPullRequest(pr.baseRef, config.merge)) {
    return {
      kind: 'not-governed',
      reason: `this PR targets "${pr.baseRef}", which is not a branch this pipeline governs`,
    };
  }

  const commitMessages = await client.listCommitMessages(pr);
  const route = determineRoute({ commitMessages, prTitle: pr.title }, config);
  if (!route.ok) {
    return { kind: 'unroutable', reason: route.reason };
  }

  const target = resolveTargetBranch(route.decision.areas, config.merge);
  if (!target.ok) {
    return { kind: 'target-conflict', reason: target.reason };
  }

  if (!governsPullRequest(pr.baseRef, target.targetBranch)) {
    return {
      kind: 'not-governed',
      reason: `this PR targets "${pr.baseRef}" but its areas resolve to "${target.targetBranch}"`,
    };
  }

  return { kind: 'proceed', route: route.decision, targetBranch: target.targetBranch };
}
