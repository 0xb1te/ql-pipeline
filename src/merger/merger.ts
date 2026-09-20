// @neuron merge.merger.merger
import type { GithubClient, PullRequestInfo, ReviewComment } from '../shared/github-client.js';
import type { Finding, MergeConfig } from '../shared/types.js';

/** Renders a `should`-severity finding as an advisory PR review comment. */
// @signal findingToReviewComment
export function findingToReviewComment(finding: Finding): ReviewComment {
  const suggestion = finding.suggestedFix !== null ? `\n\nSuggested fix: ${finding.suggestedFix}` : '';
  return {
    path: finding.file,
    line: finding.line,
    body: `**[${finding.severity}] ${finding.rule}**\n\n${finding.problem}${suggestion}`,
  };
}

export type MergeExecution =
  | { readonly kind: 'merged'; readonly approval: ApprovalOutcome }
  | { readonly kind: 'awaiting-human'; readonly approval: ApprovalOutcome }
  | { readonly kind: 'stale'; readonly reviewedSha: string; readonly currentSha: string };

/** How the MERGE verdict was recorded on the pull request. */
export type ApprovalOutcome =
  /** A real approving review. */
  | 'approved'
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
// @signal isSelfApprovalRefusal
export function isSelfApprovalRefusal(error: unknown): boolean {
  const shaped = error as { status?: unknown; message?: unknown } | null;
  if (shaped?.status !== 422) return false;
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
async function recordApproval(
  client: Pick<GithubClient, 'approveWithComments' | 'commentReview'>,
  pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>,
  comments: readonly ReviewComment[],
): Promise<ApprovalOutcome> {
  try {
    await client.approveWithComments(pr, comments);
    return 'approved';
  } catch (error) {
    if (!isSelfApprovalRefusal(error)) throw error;
    await client.commentReview(pr, SELF_APPROVAL_NOTE, comments);
    return 'self-authored';
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
export async function recordVerdictLabel(
  client: Pick<GithubClient, 'addLabels' | 'removeLabel'>,
  pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>,
  verdict: typeof NEEDS_HUMAN_LABEL | typeof READY_TO_MERGE_LABEL,
): Promise<void> {
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
export async function executeMergeDecision(
  client: GithubClient,
  pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number' | 'headRef' | 'headSha'>,
  advisoryFindings: readonly Finding[],
  mergeConfig: MergeConfig,
): Promise<MergeExecution> {
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
