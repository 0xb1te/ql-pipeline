// @neuron review.reviewer.findingReply
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
/**
 * The reply posted into a finding's thread the moment an agent accepts it, before it has done
 * anything at all.
 *
 * Separate from {@link replyForFinding}, which answers with what an attempt *did*. This one
 * answers the question a reader actually has while the attempt is running, which until now had
 * no answer on the pull request for however many minutes the agent took: has anybody got this.
 *
 * It names the run rather than describing one, because a run id is the thing a person can look
 * up, quote in a message, or use to cancel.
 */
// @signal pickedUpReply
export function pickedUpReply(context) {
    return (`Picked up by agent \`${context.runId}\` (attempt ${String(context.attemptNumber)} of ` +
        `${String(context.maxFixAttempts)}). It is running now and has every finding in this review, ` +
        `not just this one. This thread gets a second reply saying what the attempt actually did.`);
}
// @signal replyForFinding
export function replyForFinding(context) {
    const { outcome, attemptNumber, maxFixAttempts } = context;
    const attempt = `Attempt ${String(attemptNumber)} of ${String(maxFixAttempts)}`;
    if (outcome.kind === 'committed') {
        const files = outcome.files.length === 0 ? '' : `\n\nFiles touched: ${outcome.files.join(', ')}`;
        return (`${attempt}: pushed \`${outcome.commitMessage}\`.${files}\n\n` +
            `That commit was written against every finding in this review at once, so whether it ` +
            `settles *this* one is for the next review to say — if it did not, this finding comes back ` +
            `and you will see it raised again here.`);
    }
    if (outcome.kind === 'no-changes') {
        return (`${attempt}: the fix agent ran and produced no usable change, so this finding stands. ` +
            `It needs a person — or a comment on this PR telling the agent what to do differently.`);
    }
    return `No fix was attempted: ${outcome.why} This finding stands and needs a person.`;
}
//# sourceMappingURL=finding-reply.js.map