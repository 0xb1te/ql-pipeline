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
 * Whether a finding points at a line GitHub will accept an inline review comment on.
 *
 * Not every finding is about a line of code. A failed gate carries the pseudo-path `(gate)` and a
 * pull request that answers to no ql-sprint task carries `(task)`, because what they are about is
 * the pull request itself. GitHub rejects a review comment whose path is not in the diff with a
 * 422, and `recordApproval` deliberately rethrows anything that is not the self-approval refusal
 * — so one advisory finding with nowhere to point would fail a run that had otherwise passed,
 * which is the exact opposite of what `should` severity means.
 *
 * The parenthesised spelling is the marker because it cannot collide with a real path - no file
 * in a repository is named `(gate)`, and git would have to be talked into it if one were.
 */
// @signal isDiffAnchored
export function isDiffAnchored(finding) {
    return !/^\(.+\)$/.test(finding.file);
}
/**
 * The findings that can be inline comments, as inline comments.
 *
 * Both review paths post comments and both must apply the same rule, so the rule lives here rather
 * than at each call site. It was written for the approval path and not applied to the blocking one,
 * which is how a failed *required* gate - `must` severity, pseudo-path `(gate)` - reached
 * `requestChangesWithComments` and 422'd the run it was supposed to be explaining. That is the worst
 * possible moment to throw: the complaint is the only thing the pull request was going to get.
 *
 * Callers are responsible for reporting what this drops. It returns comments, not a verdict, and a
 * finding silently missing from both the inline comments and the body would be worse than the 422.
 */
// @signal inlineComments
export function inlineComments(findings) {
    return findings.filter(isDiffAnchored).map(findingToReviewComment);
}
/** The findings this pull request cannot carry as inline comments. */
// @signal unanchoredFindings
export function unanchoredFindings(findings) {
    return findings.filter((finding) => !isDiffAnchored(finding));
}
/**
 * Renders the advisory findings that have no line to sit on as one ordinary pull-request comment.
 *
 * They are still reported, just not as inline comments - a finding about the pull request as a
 * whole reads better at the bottom of it than pinned to an arbitrary line anyway.
 */
function formatUnanchoredAdvisories(findings) {
    const rendered = findings.map((finding) => {
        const suggestion = finding.suggestedFix !== null ? `\n\nSuggested fix: ${finding.suggestedFix}` : '';
        return `**[${finding.severity}] ${finding.rule}**\n\n${finding.problem}${suggestion}`;
    });
    return [
        '### Advisory findings',
        '',
        'About this pull request rather than about any line in it. None of them blocked the merge.',
        '',
        rendered.join('\n\n---\n\n'),
    ].join('\n');
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
// @signal isSelfReviewRefusal
export function isSelfReviewRefusal(error) {
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
        if (!isSelfReviewRefusal(error))
            throw error;
        await client.commentReview(pr, SELF_APPROVAL_NOTE, comments);
        return 'self-authored';
    }
}
/** What the comment review says in place of a refusal to approve, so the PR still carries it. */
export const SELF_REVIEW_NOTE = [
    'These findings are recorded as a comment rather than as requested changes because GitHub does',
    'not allow requesting changes on your own pull request, and this pipeline is authenticated as',
    'the account that opened it.',
    '',
    'Nothing about the verdict changes. The merge is blocked by this run failing its own required',
    'check, which it does either way - the review state was never what held the pull request.',
].join(' ');
/**
 * Posts the complaint, refusing to approve where GitHub permits it and commenting where it does
 * not.
 *
 * The exact shape of recordApproval, and for the exact same reason - which is the point. GitHub
 * refuses *both* self-reviews, the approving one and the changes-requesting one, with the same 422.
 * Only the approving half was ever caught, so every FIX and BLOCK verdict on a pull request the
 * token's owner had opened threw out of `requestChangesWithComments` before posting anything. The
 * check went red by crashing rather than by deciding: no findings on the pull request, no threads
 * for the fixer to answer, and a summary comment saying four findings had been made that nobody
 * could read.
 *
 * The threads come back either way, so the fix loop is untouched.
 */
// @signal recordComplaint
export async function recordComplaint(client, pr, body, comments) {
    try {
        return { threads: await client.requestChangesWithComments(pr, body, comments), outcome: 'changes-requested' };
    }
    catch (error) {
        if (!isSelfReviewRefusal(error))
            throw error;
        const threads = await client.commentReviewWithThreads(pr, `${body}\n\n${SELF_REVIEW_NOTE}`, comments);
        return { threads, outcome: 'self-authored' };
    }
}
/** Label applied instead of merging when `merge.require_human_approval` is on. */
export const READY_TO_MERGE_LABEL = 'ready-to-merge';
/** Label applied when the pipeline stops and asks for a person. */
export const NEEDS_HUMAN_LABEL = 'needs-human';
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
// @signal recordVerdictLabel
export async function recordVerdictLabel(client, pr, verdict) {
    await client.addLabels(pr, [verdict]);
    await client.removeLabel(pr, verdict === NEEDS_HUMAN_LABEL ? READY_TO_MERGE_LABEL : NEEDS_HUMAN_LABEL);
}
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
    // Split before approving, not after: a finding with a pseudo-path sent as an inline comment is
    // a 422 that recordApproval rethrows, and an advisory finding must never cost the approval it
    // was riding along on.
    const comments = inlineComments(advisoryFindings);
    const approval = await recordApproval(client, pr, comments);
    const unanchored = unanchoredFindings(advisoryFindings);
    if (unanchored.length > 0) {
        await client.postComment(pr, formatUnanchoredAdvisories(unanchored));
    }
    // Human-approval mode stops here, one call short of merging. The approval
    // and the advisory comments still land, so the PR carries the full review —
    // but the merge itself is a person's to make. Deliberately placed after the
    // staleness check and the approval so the only difference between the two
    // modes is whether the merge API is called at all.
    if (mergeConfig.requireHumanApproval) {
        await recordVerdictLabel(client, pr, READY_TO_MERGE_LABEL);
        return { kind: 'awaiting-human', approval };
    }
    // Before the merge, not after: `deleteBranch` below can make the pull request
    // unavailable to label, and a merged pull request still wearing `needs-human`
    // is a false answer sitting in anybody's history.
    await client.removeLabel(pr, NEEDS_HUMAN_LABEL);
    await client.mergePullRequest(pr, mergeConfig.method, pr.headSha);
    if (mergeConfig.deleteBranch) {
        await client.deleteBranch(pr);
    }
    return { kind: 'merged', approval };
}
//# sourceMappingURL=merger.js.map