/** Renders a `should`-severity finding as an advisory PR review comment. */
// @signal findingToReviewComment
export function findingToReviewComment(finding) {
    const suggestion = finding.suggestedFix !== null ? `\n\nSuggested fix: ${finding.suggestedFix}` : '';
    return {
        path: finding.file,
        line: finding.line,
        body: `**[${finding.severity}] ${finding.rule}**\n\n${finding.problem}${suggestion}`,
    };
}
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
// @signal isSelfApprovalRefusal
export function isSelfApprovalRefusal(error) {
    const shaped = error;
    if (shaped?.status !== 422)
        return false;
    // Only a string is read: octokit's errors carry one, and anything else here is not the message
    // this is trying to recognise — stringifying an object would produce '[object Object]' and
    // never match, which is the right answer arrived at by the wrong route.
    const message = typeof shaped.message === 'string' ? shaped.message.toLowerCase() : '';
    return message.includes('own pull request');
}
/** What the comment review says in place of an approval, so the PR still carries the verdict. */
export const SELF_APPROVAL_NOTE = [
    'This review passed. It is recorded as a comment rather than an approval because GitHub does',
    'not allow approving your own pull request, and this pipeline is authenticated as the account',
    'that opened it — a consequence of `GH_TOKEN` being a token that belongs to a person rather',
    'than to a bot.',
    '',
    'If branch protection here requires an approving review, that approval has to come from',
    'somebody else; nothing the pipeline can do will satisfy it.',
].join(' ');
/**
 * Records the verdict, approving where GitHub permits it and commenting where it does not.
 *
 * The fallback is deliberately narrow. Any other failure rethrows, because a review that did not
 * land is a governance run that did not do its job, and quietly downgrading every error to a
 * comment would hide that.
 */
async function recordApproval(client, pr, comments) {
    try {
        await client.approveWithComments(pr, comments);
        return 'approved';
    }
    catch (error) {
        if (!isSelfApprovalRefusal(error))
            throw error;
        await client.commentReview(pr, SELF_APPROVAL_NOTE, comments);
        return 'self-authored';
    }
}
/** Label applied instead of merging when `merge.require_human_approval` is on. */
export const READY_TO_MERGE_LABEL = 'ready-to-merge';
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
// @signal executeMergeDecision
export async function executeMergeDecision(client, pr, advisoryFindings, mergeConfig) {
    const currentSha = await client.getHeadSha(pr);
    if (currentSha !== pr.headSha) {
        return { kind: 'stale', reviewedSha: pr.headSha, currentSha };
    }
    const comments = advisoryFindings.map(findingToReviewComment);
    const approval = await recordApproval(client, pr, comments);
    // Human-approval mode stops here, one call short of merging. The approval
    // and the advisory comments still land, so the PR carries the full review —
    // but the merge itself is a person's to make. Deliberately placed after the
    // staleness check and the approval so the only difference between the two
    // modes is whether the merge API is called at all.
    if (mergeConfig.requireHumanApproval) {
        await client.addLabels(pr, [READY_TO_MERGE_LABEL]);
        return { kind: 'awaiting-human', approval };
    }
    await client.mergePullRequest(pr, mergeConfig.method, pr.headSha);
    if (mergeConfig.deleteBranch) {
        await client.deleteBranch(pr);
    }
    return { kind: 'merged', approval };
}
//# sourceMappingURL=merger.js.map