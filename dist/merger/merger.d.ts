import type { GithubClient, PullRequestInfo, ReviewComment } from '../shared/github-client.js';
import type { Finding, MergeConfig } from '../shared/types.js';
/** Renders a `should`-severity finding as an advisory PR review comment. */
export declare function findingToReviewComment(finding: Finding): ReviewComment;
export type MergeExecution = {
    readonly kind: 'merged';
    readonly approval: ApprovalOutcome;
} | {
    readonly kind: 'awaiting-human';
    readonly approval: ApprovalOutcome;
} | {
    readonly kind: 'stale';
    readonly reviewedSha: string;
    readonly currentSha: string;
};
/** How the MERGE verdict was recorded on the pull request. */
export type ApprovalOutcome = 
/** A real approving review. */
'approved'
/** A COMMENT review, because GitHub will not let anyone approve a PR they opened themselves. */
 | 'self-authored';
/**
 * Whether GitHub refused a review because the token's owner opened the pull request.
 *
 * Matched on the status *and* the message: 422 alone covers several unrelated validation
 * failures, and treating one of those as "this is my own PR" would swallow a real error and post
 * a comment review in its place.
 *
 * This became reachable the moment `GH_TOKEN` was set. Without it the pipeline reviews as
 * github-actions[bot], which authors nothing and may approve anything; with it, it reviews as a
 * person, and in a one-maintainer suite that person opened the pull request.
 */
export declare function isSelfApprovalRefusal(error: unknown): boolean;
/** What the comment review says in place of an approval, so the PR still carries the verdict. */
export declare const SELF_APPROVAL_NOTE: string;
/** Label applied instead of merging when `merge.require_human_approval` is on. */
export declare const READY_TO_MERGE_LABEL = "ready-to-merge";
/** Label applied when the pipeline stops and asks for a person. */
export declare const NEEDS_HUMAN_LABEL = "needs-human";
/**
 * Puts the verdict this run reached on the pull request, and takes off the one
 * it did not.
 *
 * The two labels are the pipeline's whole vocabulary for "what happened here",
 * and they were only ever added. A pull request could therefore end a run
 * wearing both — which is not a richer answer, it is two answers, one of them
 * false. ql-desktop#72 finished with `needs-human, ready-to-merge` after an
 * early run escalated over a protected path and a later run, once that path was
 * narrowed, approved it.
 *
 * Both readers downstream are misled by it in opposite directions: a "waiting on
 * a human" count includes a pull request the engine has approved, and a check
 * that tells an escalation from a breakage by looking for `needs-human` reads a
 * stale one as a fresh verdict.
 *
 * Removing first and adding second would leave a window with neither, so the
 * order is deliberate: the true label goes on before the false one comes off.
 */
export declare function recordVerdictLabel(client: Pick<GithubClient, 'addLabels' | 'removeLabel'>, pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>, verdict: typeof NEEDS_HUMAN_LABEL | typeof READY_TO_MERGE_LABEL): Promise<void>;
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
