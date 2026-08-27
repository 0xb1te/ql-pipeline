import type { GithubClient, PullRequestInfo, ReviewComment } from '../shared/github-client.js';
import type { Finding, MergeConfig } from '../shared/types.js';

/** Renders a `should`-severity finding as an advisory PR review comment. */
export function findingToReviewComment(finding: Finding): ReviewComment {
  const suggestion = finding.suggestedFix !== null ? `\n\nSuggested fix: ${finding.suggestedFix}` : '';
  return {
    path: finding.file,
    line: finding.line,
    body: `**[${finding.severity}] ${finding.rule}**\n\n${finding.problem}${suggestion}`,
  };
}

export type MergeExecution =
  | { readonly kind: 'merged' }
  | { readonly kind: 'awaiting-human' }
  | { readonly kind: 'stale'; readonly reviewedSha: string; readonly currentSha: string };

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
  await client.approveWithComments(pr, comments);

  // Human-approval mode stops here, one call short of merging. The approval
  // and the advisory comments still land, so the PR carries the full review —
  // but the merge itself is a person's to make. Deliberately placed after the
  // staleness check and the approval so the only difference between the two
  // modes is whether the merge API is called at all.
  if (mergeConfig.requireHumanApproval) {
    await client.addLabels(pr, [READY_TO_MERGE_LABEL]);
    return { kind: 'awaiting-human' };
  }

  await client.mergePullRequest(pr, mergeConfig.method, pr.headSha);

  if (mergeConfig.deleteBranch) {
    await client.deleteBranch(pr);
  }

  return { kind: 'merged' };
}
