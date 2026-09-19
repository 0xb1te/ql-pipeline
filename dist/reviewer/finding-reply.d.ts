/** What happened to the findings this run raised, as the threads should hear it. */
export type FixAttemptOutcome = 
/** A commit was pushed. Whether it resolved *this* finding is not yet known. */
{
    readonly kind: 'committed';
    readonly commitMessage: string;
    readonly files: readonly string[];
}
/** The agent ran and changed nothing usable, so the finding stands. */
 | {
    readonly kind: 'no-changes';
}
/** No fix was attempted at all — a fork, a non-Cursor provider, a BLOCK. */
 | {
    readonly kind: 'not-attempted';
    readonly why: string;
};
export interface FindingReplyContext {
    readonly outcome: FixAttemptOutcome;
    readonly attemptNumber: number;
    readonly maxFixAttempts: number;
}
/**
 * The reply posted into a finding's own thread once the run has done what it can.
 *
 * A finding that gets fixed and never answered leaves the thread reading as an open complaint
 * forever: the PR shows "changes requested" over a comment nobody responded to, while a commit
 * addressed it minutes later. The thread is where a person looks, so the thread is where the
 * answer belongs.
 *
 * **It never claims this finding is resolved.** The fixer works from all findings at once and
 * reports one commit, not a mapping from finding to edit — so "fixed" would be a guess dressed as
 * a fact. What it can say truthfully is what was attempted, what landed, and that the next review
 * decides. If the finding survives, the next run raises it again and the thread shows both.
 */
export declare function replyForFinding(context: FindingReplyContext): string;
