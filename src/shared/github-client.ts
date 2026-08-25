import { getOctokit } from '@actions/github';
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
  readonly repo: { readonly owner: string; readonly repo: string };
  readonly payload: {
    readonly pull_request?:
      | {
          readonly number: number;
          readonly title: string;
          readonly head: {
            readonly ref: string;
            readonly sha: string;
            readonly repo: { readonly full_name: string } | null;
          };
          readonly base: { readonly ref: string; readonly repo: { readonly full_name: string } };
        }
      | undefined;
  };
}

export function readPullRequestContext(context: ActionsEventContext): PullRequestInfo {
  const pr = context.payload.pull_request;
  if (pr === undefined) {
    throw new Error(
      'this workflow must be triggered by a pull_request event (no pull_request found in the event payload)',
    );
  }
  // A deleted fork leaves `head.repo` null; treat that as a fork too, since
  // it's certainly not a branch on the base repo we could push to.
  const isFork = pr.head.repo === null || pr.head.repo.full_name !== pr.base.repo.full_name;

  return {
    owner: context.repo.owner,
    repo: context.repo.repo,
    number: pr.number,
    title: pr.title,
    headRef: pr.head.ref,
    headSha: pr.head.sha,
    baseRef: pr.base.ref,
    isFork,
  };
}

export interface ReviewComment {
  readonly path: string;
  readonly line: number;
  readonly body: string;
}

export interface PullRequestDetails {
  readonly description: string;
  readonly diff: string;
}

// Declared as function-typed properties rather than method shorthand so
// that `expect(client.someMethod).toHaveBeenCalledWith(...)` in tests
// doesn't trip @typescript-eslint/unbound-method — these are plain
// callbacks with no `this`, not methods that rely on binding.
export interface GithubClient {
  listCommitMessages: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>) => Promise<string[]>;
  listChangedFiles: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>) => Promise<string[]>;
  getPullRequestDetails: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>) => Promise<PullRequestDetails>;
  addLabels: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>, labels: readonly string[]) => Promise<void>;
  postComment: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>, body: string) => Promise<void>;
  approveWithComments: (
    pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>,
    comments: readonly ReviewComment[],
  ) => Promise<void>;
  requestChangesWithComments: (
    pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>,
    body: string,
    comments: readonly ReviewComment[],
  ) => Promise<void>;
  /**
   * Merges with `expectedHeadSha` pinned, so GitHub itself rejects the
   * merge if another commit landed while this run was working — the
   * pipeline never merges a revision it didn't actually review.
   */
  mergePullRequest: (
    pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>,
    method: MergeMethod,
    expectedHeadSha: string,
  ) => Promise<void>;
  getHeadSha: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>) => Promise<string>;
  deleteBranch: (pr: Pick<PullRequestInfo, 'owner' | 'repo'> & { readonly headRef: string }) => Promise<void>;
}

/** Thin Octokit wrapper for the two calls this pipeline needs so far. */
export function createGithubClient(token: string): GithubClient {
  const octokit = getOctokit(token);

  return {
    async listCommitMessages(pr): Promise<string[]> {
      const commits = await octokit.paginate(octokit.rest.pulls.listCommits, {
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
      });
      return commits.map((commit) => commit.commit.message);
    },

    async listChangedFiles(pr): Promise<string[]> {
      const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
      });
      return files.map((file) => file.filename);
    },

    async getPullRequestDetails(pr): Promise<PullRequestDetails> {
      const [metadata, diffResponse] = await Promise.all([
        octokit.rest.pulls.get({ owner: pr.owner, repo: pr.repo, pull_number: pr.number }),
        octokit.rest.pulls.get({
          owner: pr.owner,
          repo: pr.repo,
          pull_number: pr.number,
          mediaType: { format: 'diff' },
        }),
      ]);
      // The `diff` media type makes the REST API return raw diff text
      // instead of the JSON pull-request object; Octokit's generated types
      // don't model that override, so `.data` is typed as the JSON shape
      // even though it's actually a string at runtime.
      const diff = diffResponse.data as unknown as string;
      return { description: metadata.data.body ?? '', diff };
    },

    async addLabels(pr, labels): Promise<void> {
      if (labels.length === 0) {
        return;
      }
      await octokit.rest.issues.addLabels({
        owner: pr.owner,
        repo: pr.repo,
        issue_number: pr.number,
        labels: [...labels],
      });
    },

    async postComment(pr, body): Promise<void> {
      await octokit.rest.issues.createComment({
        owner: pr.owner,
        repo: pr.repo,
        issue_number: pr.number,
        body,
      });
    },

    async approveWithComments(pr, comments): Promise<void> {
      await octokit.rest.pulls.createReview({
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
        event: 'APPROVE',
        comments: comments.map((comment) => ({ path: comment.path, line: comment.line, body: comment.body })),
      });
    },

    async requestChangesWithComments(pr, body, comments): Promise<void> {
      await octokit.rest.pulls.createReview({
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
        event: 'REQUEST_CHANGES',
        body,
        comments: comments.map((comment) => ({ path: comment.path, line: comment.line, body: comment.body })),
      });
    },

    async mergePullRequest(pr, method, expectedHeadSha): Promise<void> {
      await octokit.rest.pulls.merge({
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
        merge_method: method,
        sha: expectedHeadSha,
      });
    },

    async getHeadSha(pr): Promise<string> {
      const { data } = await octokit.rest.pulls.get({
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
      });
      return data.head.sha;
    },

    async deleteBranch(pr): Promise<void> {
      await octokit.rest.git.deleteRef({
        owner: pr.owner,
        repo: pr.repo,
        ref: `heads/${pr.headRef}`,
      });
    },
  };
}
