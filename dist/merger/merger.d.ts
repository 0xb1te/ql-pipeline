import type { GithubClient, PullRequestInfo, ReviewComment } from '../shared/github-client.js';
import type { Finding, MergeConfig } from '../shared/types.js';
/** Renders a `should`-severity finding as an advisory PR review comment. */
export declare function findingToReviewComment(finding: Finding): ReviewComment;
export type MergeExecution = {
    readonly kind: 'merged';
} | {
    readonly kind: 'stale';
    readonly reviewedSha: string;
    readonly currentSha: string;
};
/**
 * Carries out a MERGE verdict: re-check that the head commit is still the
 * one that was reviewed, approve the PR (attaching any advisory `should`
 * findings as review comments), merge using the configured method, and
 * delete the branch if configured to.
 *
 * The staleness check is deliberately belt-and-braces: this explicit
 * comparison gives a clear, self-explaining outcome, and passing the SHA to
 * the merge API means GitHub rejects the merge even if a commit lands in
 * the window between the check and the call. Branch protection on the
 * target branch remains the outer enforcement layer — this only ever runs
 * once the verdict engine has already decided MERGE is warranted.
 */
export declare function executeMergeDecision(client: GithubClient, pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number' | 'headRef' | 'headSha'>, advisoryFindings: readonly Finding[], mergeConfig: MergeConfig): Promise<MergeExecution>;
