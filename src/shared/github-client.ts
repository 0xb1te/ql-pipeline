import { getOctokit } from '@actions/github';

export interface PullRequestInfo {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly title: string;
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
    readonly pull_request?: { readonly number: number; readonly title: string } | undefined;
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
  };
}

export interface GithubClient {
  listCommitMessages(pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>): Promise<string[]>;
  addLabels(pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>, labels: readonly string[]): Promise<void>;
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
  };
}
