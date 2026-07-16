import { getOctokit } from '@actions/github';
import type { MergeMethod } from './types.js';

export interface PullRequestInfo {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly headRef: string;
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
      | { readonly number: number; readonly title: string; readonly head: { readonly ref: string } }
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
  return {
    owner: context.repo.owner,
    repo: context.repo.repo,
    number: pr.number,
    title: pr.title,
    headRef: pr.head.ref,
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
  getPullRequestDetails: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>) => Promise<PullRequestDetails>;
  addLabels: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>, labels: readonly string[]) => Promise<void>;
  approveWithComments: (
    pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>,
    comments: readonly ReviewComment[],
  ) => Promise<void>;
  requestChangesWithComments: (
    pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>,
    body: string,
    comments: readonly ReviewComment[],
  ) => Promise<void>;
  mergePullRequest: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>, method: MergeMethod) => Promise<void>;
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

    async mergePullRequest(pr, method): Promise<void> {
      await octokit.rest.pulls.merge({
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
        merge_method: method,
      });
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
