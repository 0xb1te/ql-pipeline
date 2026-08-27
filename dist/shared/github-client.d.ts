import type { MergeMethod } from './types.js';
export interface PullRequestInfo {
    readonly owner: string;
    readonly repo: string;
    readonly number: number;
    readonly title: string;
    readonly headRef: string;
    /** Head commit SHA at the moment this run started, for the stale-run guard. */
    readonly headSha: string;
    /** The branch this PR targets — checked against the configured target branch. */
    readonly baseRef: string;
    /**
     * True when the PR comes from a fork. The fixer cannot push to a fork's
     * branch with the base repo's token, so fork PRs are reviewed but never
     * auto-fixed.
     */
    readonly isFork: boolean;
}
/**
 * The slice of `@actions/github`'s `Context` this module actually reads.
 * Defined narrowly (rather than importing `Context` directly) so this stays
 * easy to unit test with a plain object — `@actions/github`'s real payload
 * type is a loosely-typed catch-all that would otherwise force `any` at
 * every read.
 */
export interface ActionsEventContext {
    readonly repo: {
        readonly owner: string;
        readonly repo: string;
    };
    readonly payload: {
        readonly pull_request?: {
            readonly number: number;
            readonly title: string;
            readonly head: {
                readonly ref: string;
                readonly sha: string;
                readonly repo: {
                    readonly full_name: string;
                } | null;
            };
            readonly base: {
                readonly ref: string;
                readonly repo: {
                    readonly full_name: string;
                };
            };
        } | undefined;
    };
}
export declare function readPullRequestContext(context: ActionsEventContext): PullRequestInfo;
export interface ReviewComment {
    readonly path: string;
    readonly line: number;
    readonly body: string;
}
export interface PullRequestDetails {
    readonly description: string;
    readonly diff: string;
}
export interface GithubClient {
    listCommitMessages: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>) => Promise<string[]>;
    listChangedFiles: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>) => Promise<string[]>;
    getPullRequestDetails: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>) => Promise<PullRequestDetails>;
    addLabels: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>, labels: readonly string[]) => Promise<void>;
    postComment: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>, body: string) => Promise<void>;
    approveWithComments: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>, comments: readonly ReviewComment[]) => Promise<void>;
    requestChangesWithComments: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>, body: string, comments: readonly ReviewComment[]) => Promise<void>;
    /**
     * Merges with `expectedHeadSha` pinned, so GitHub itself rejects the
     * merge if another commit landed while this run was working — the
     * pipeline never merges a revision it didn't actually review.
     */
    mergePullRequest: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>, method: MergeMethod, expectedHeadSha: string) => Promise<void>;
    getHeadSha: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>) => Promise<string>;
    deleteBranch: (pr: Pick<PullRequestInfo, 'owner' | 'repo'> & {
        readonly headRef: string;
    }) => Promise<void>;
}
/** Thin Octokit wrapper for the two calls this pipeline needs so far. */
export declare function createGithubClient(token: string): GithubClient;
