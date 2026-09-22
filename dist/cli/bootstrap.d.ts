import { type GithubClient, type PullRequestInfo } from '../shared/github-client.js';
import { type Logger } from '../shared/logger.js';
import type { PipelineConfig, RouteDecision } from '../shared/types.js';
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
export declare function actionsRunUrl(env: Readonly<Record<string, string | undefined>>): string | null;
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
export declare function createPipelineContext(): PipelineContext;
export type RoutingOutcome = {
    readonly kind: 'proceed';
    readonly route: RouteDecision;
    readonly targetBranch: string;
} | {
    readonly kind: 'not-governed';
    readonly reason: string;
} | {
    readonly kind: 'unroutable';
    readonly reason: string;
} | {
    readonly kind: 'target-conflict';
    readonly reason: string;
};
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
export declare function resolveRouting(client: Pick<GithubClient, 'listCommitMessages'>, pr: PullRequestInfo, config: PipelineConfig): Promise<RoutingOutcome>;
