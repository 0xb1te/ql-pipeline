import type { PrComment } from './human-direction.js';
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
/**
 * Where the workflow puts a PR it had to look up, because the event that
 * started the run did not carry one.
 *
 * A `pull_request` event describes its PR in the payload. An `issue_comment`
 * — which is how a person asks for another pass by writing on the PR — does
 * not: GitHub sends it with an `issue`, so there is no head ref, no head sha
 * and no base branch until somebody asks the API. The workflow's `resolve`
 * job asks once, and hands the answer down through these.
 */
export declare const RESOLVED_PR_VARS: {
    readonly number: "QL_PIPELINE_PR_NUMBER";
    readonly title: "QL_PIPELINE_PR_TITLE";
    readonly headRef: "QL_PIPELINE_PR_HEAD_REF";
    readonly headSha: "QL_PIPELINE_PR_HEAD_SHA";
    readonly baseRef: "QL_PIPELINE_PR_BASE_REF";
    readonly isFork: "QL_PIPELINE_PR_IS_FORK";
};
/** The slice of the process environment this module reads. */
export type EventEnv = Readonly<Record<string, string | undefined>>;
/**
 * The PR this run is about.
 *
 * The payload wins whenever it has one, so a `pull_request` run behaves
 * exactly as it did before any of this existed; the resolved variables are
 * only consulted for the events that carry no PR of their own.
 */
export declare function readPullRequestContext(context: ActionsEventContext, env?: EventEnv): PullRequestInfo;
/**
 * Stamped into every comment this pipeline writes, so a later run can recognise its own voice.
 *
 * Identity cannot do this job. The workflow acts as `secrets.GH_TOKEN` when one is set, and that
 * token belongs to a person — the same person who comments on the pull request. Once `GH_TOKEN`
 * is configured, the pipeline's comments and the operator's are written by the *same GitHub
 * account*, so "was this written by a bot?" has no answer, and "was this written by me?" would
 * decline the operator's own direction along with the pipeline's chatter.
 *
 * What the two do not share is what they say. An HTML comment renders as nothing, survives
 * GitHub's Markdown untouched, and is carried in the webhook payload the trigger reads — so the
 * guard can ask the one question that still separates them.
 *
 * Without this, a `GH_TOKEN` that finally closes the fix loop also makes every verdict comment
 * start another run that writes another verdict comment, forever.
 */
export declare const AUTOMATION_MARKER = "<!-- ql-pipeline:automated -->";
/**
 * Appends the marker, unless it is already there.
 *
 * Applied inside the client rather than at each call site on purpose: a body that reaches GitHub
 * unstamped is a loop, and "remember to stamp it" is not a property a codebase can hold.
 */
export declare function stampAutomated(body: string): string;
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
    /**
     * Everything said on the PR - the conversation and the inline threads - with
     * each author marked as a bot or not, so the caller can drop what the
     * pipeline itself wrote before handing the rest to an agent.
     *
     * Both kinds are fetched because they mean the same thing to a reader: an
     * instruction typed into a finding's thread is as much direction as one left
     * at the bottom of the page, and honouring only one would make the answer
     * depend on where somebody happened to click.
     */
    listComments: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>) => Promise<readonly PrComment[]>;
    approveWithComments: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>, comments: readonly ReviewComment[]) => Promise<void>;
    /**
     * Posts the review and hands back the ids of the inline comments it created,
     * so the run that fixes a finding can answer the very thread that raised it.
     *
     * The ids are read back rather than taken from the create response: GitHub's
     * `createReview` returns the review, not its comments, so the only exact way
     * to learn them is to list the PR's review comments and keep the ones
     * belonging to this review.
     */
    requestChangesWithComments: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>, body: string, comments: readonly ReviewComment[]) => Promise<readonly number[]>;
    /**
     * Replies inside one review-comment thread.
     *
     * A finding that gets fixed but never answered leaves the thread reading as
     * an open complaint forever - the PR shows "changes requested" and a comment
     * nobody responded to, even though a commit addressed it minutes later.
     */
    replyToReviewComment: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>, commentId: number, body: string) => Promise<void>;
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
