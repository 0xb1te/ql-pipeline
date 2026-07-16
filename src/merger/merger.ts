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

/**
 * Carries out a MERGE verdict: approve the PR (attaching any advisory
 * `should` findings as review comments), merge it using the configured
 * method, and delete the branch if configured to. Branch protection on the
 * target branch is the actual enforcement layer — this only ever runs once
 * the verdict engine has already decided MERGE is warranted.
 */
export async function executeMergeDecision(
  client: GithubClient,
  pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number' | 'headRef'>,
  advisoryFindings: readonly Finding[],
  mergeConfig: MergeConfig,
): Promise<void> {
  const comments = advisoryFindings.map(findingToReviewComment);
  await client.approveWithComments(pr, comments);
  await client.mergePullRequest(pr, mergeConfig.method);

  if (mergeConfig.deleteBranch) {
    await client.deleteBranch(pr);
  }
}
