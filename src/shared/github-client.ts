// @neuron shared.core.githubClient
import { getOctokit } from '@actions/github';
import type { PrComment } from './human-direction.js';
import type { ReviewThread } from '../reviewer/settled-threads.js';
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

/**
 * Where the workflow puts a PR it had to look up, because the event that
 * started the run did not carry one.
 *
 * A `pull_request` event describes its PR in the payload. An `issue_comment`
 * — which is how a person asks for another pass by writing on the PR — does
 * not: GitHub sends it with an `issue`, so there is no head ref, no head sha
 * and no base branch until somebody asks the API. The workflow's `resolve`
 * job asks once, and hands the answer down through these.
 */
export const RESOLVED_PR_VARS = {
  number: 'QL_PIPELINE_PR_NUMBER',
  title: 'QL_PIPELINE_PR_TITLE',
  headRef: 'QL_PIPELINE_PR_HEAD_REF',
  headSha: 'QL_PIPELINE_PR_HEAD_SHA',
  baseRef: 'QL_PIPELINE_PR_BASE_REF',
  isFork: 'QL_PIPELINE_PR_IS_FORK',
} as const;

/** The slice of the process environment this module reads. */
export type EventEnv = Readonly<Record<string, string | undefined>>;

/**
 * Reads the resolved PR, or undefined when none was handed down.
 *
 * "Partly handed down" is an error rather than a fallthrough. A resolver that
 * set the number but lost the head sha is broken, and the alternative — giving
 * up and reporting "this must be triggered by a pull_request event" — would
 * send whoever reads that message hunting the trigger, which is the one thing
 * that is not wrong.
 */
function readResolvedPullRequest(context: ActionsEventContext, env: EventEnv): PullRequestInfo | undefined {
  const raw = Object.fromEntries(
    Object.entries(RESOLVED_PR_VARS).map(([field, variable]) => [field, (env[variable] ?? '').trim()]),
  ) as Record<keyof typeof RESOLVED_PR_VARS, string>;

  if (Object.values(raw).every((value) => value === '')) {
    return undefined;
  }

  const missing = Object.entries(RESOLVED_PR_VARS)
    .filter(([field]) => raw[field as keyof typeof RESOLVED_PR_VARS] === '')
    .map(([, variable]) => variable);
  if (missing.length > 0) {
    throw new Error(`the pull request was only partly resolved into the environment - ${missing.join(', ')} is empty`);
  }

  const number = Number(raw.number);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${RESOLVED_PR_VARS.number} must be a positive integer, got '${raw.number}'`);
  }
  if (raw.isFork !== 'true' && raw.isFork !== 'false') {
    throw new Error(`${RESOLVED_PR_VARS.isFork} must be 'true' or 'false', got '${raw.isFork}'`);
  }

  return {
    owner: context.repo.owner,
    repo: context.repo.repo,
    number,
    title: raw.title,
    headRef: raw.headRef,
    headSha: raw.headSha,
    baseRef: raw.baseRef,
    isFork: raw.isFork === 'true',
  };
}

/**
 * The PR this run is about.
 *
 * The payload wins whenever it has one, so a `pull_request` run behaves
 * exactly as it did before any of this existed; the resolved variables are
 * only consulted for the events that carry no PR of their own.
 */
// @signal readPullRequestContext
export function readPullRequestContext(context: ActionsEventContext, env: EventEnv = process.env): PullRequestInfo {
  const pr = context.payload.pull_request;
  if (pr === undefined) {
    const resolved = readResolvedPullRequest(context, env);
    if (resolved !== undefined) {
      return resolved;
    }
    throw new Error(
      'this workflow must be triggered by a pull_request event, or be handed a resolved pull request ' +
        `through ${RESOLVED_PR_VARS.number} and its siblings (no pull_request found in the event payload)`,
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

/**
 * Stamped into every comment this pipeline writes, so a later run can recognise its own voice.
 *
 * Identity cannot do this job. The workflow acts as `secrets.GH_TOKEN` when one is set, and that
 * token belongs to a person — the same person who comments on the pull request. Once `GH_TOKEN`
 * is configured, the pipeline's comments and the operator's are written by the *same GitHub
 * account*, so "was this written by a bot?" has no answer, and "was this written by me?" would
 * decline the operator's own direction along with the pipeline's chatter.
 *
 * What the two do not share is what they say. An HTML comment renders as nothing, survives
 * GitHub's Markdown untouched, and is carried in the webhook payload the trigger reads — so the
 * guard can ask the one question that still separates them.
 *
 * Without this, a `GH_TOKEN` that finally closes the fix loop also makes every verdict comment
 * start another run that writes another verdict comment, forever.
 */
export const AUTOMATION_MARKER = '<!-- ql-pipeline:automated -->';

/**
 * Appends the marker, unless it is already there.
 *
 * Applied inside the client rather than at each call site on purpose: a body that reaches GitHub
 * unstamped is a loop, and "remember to stamp it" is not a property a codebase can hold.
 */
// @signal stampAutomated
export function stampAutomated(body: string): string {
  return body.includes(AUTOMATION_MARKER) ? body : `${body}

${AUTOMATION_MARKER}`;
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
  /**
   * Takes one label off, and treats "it was not there" as success.
   *
   * GitHub answers 404 both for a label this PR never carried and for a label
   * that does not exist in the repository at all. Neither is a failure for the
   * only caller there is: it removes the verdict it did not reach, and the
   * common case is that the PR never carried it.
   */
  removeLabel: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>, label: string) => Promise<void>;
  postComment: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>, body: string) => Promise<void>;
  /**
   * Everything said on the PR - the conversation and the inline threads - with
   * each author marked as a bot or not, so the caller can drop what the
   * pipeline itself wrote before handing the rest to an agent.
   *
   * Both kinds are fetched because they mean the same thing to a reader: an
   * instruction typed into a finding's thread is as much direction as one left
   * at the bottom of the page, and honouring only one would make the answer
   * depend on where somebody happened to click.
   */
  listComments: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>) => Promise<readonly PrComment[]>;
  approveWithComments: (
    pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>,
    comments: readonly ReviewComment[],
  ) => Promise<void>;
  /**
   * Posts the same review as a plain comment rather than an approval.
   *
   * GitHub refuses to let anyone approve their own pull request, and once `GH_TOKEN` is a
   * person's token the pipeline *is* the author of everything that person opens. A COMMENT review
   * is allowed there and carries the findings and the verdict intact — what it cannot do is
   * satisfy a branch-protection rule that requires an approving review.
   */
  commentReview: (
    pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>,
    body: string,
    comments: readonly ReviewComment[],
  ) => Promise<void>;
  /**
   * Posts the review and hands back the ids of the inline comments it created,
   * so the run that fixes a finding can answer the very thread that raised it.
   *
   * The ids are read back rather than taken from the create response: GitHub's
   * `createReview` returns the review, not its comments, so the only exact way
   * to learn them is to list the PR's review comments and keep the ones
   * belonging to this review.
   */
  requestChangesWithComments: (
    pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>,
    body: string,
    comments: readonly ReviewComment[],
  ) => Promise<readonly number[]>;
  /**
   * Replies inside one review-comment thread.
   *
   * A finding that gets fixed but never answered leaves the thread reading as
   * an open complaint forever - the PR shows "changes requested" and a comment
   * nobody responded to, even though a commit addressed it minutes later.
   */
  replyToReviewComment: (
    pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>,
    commentId: number,
    body: string,
  ) => Promise<void>;
  /**
   * Every review thread on the PR, with the pipeline's own marked.
   *
   * GraphQL rather than REST: resolving a thread is a GraphQL-only mutation, and it takes a
   * thread node id that REST never returns — the REST comment ids the review hands back are a
   * different identifier for a different object.
   */
  listReviewThreads: (pr: Pick<PullRequestInfo, 'owner' | 'repo' | 'number'>) => Promise<readonly ReviewThread[]>;
  /** Closes one thread. Resolving an already-resolved thread is accepted by GitHub as a no-op. */
  resolveReviewThread: (threadId: string) => Promise<void>;
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
// @signal createGithubClient
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

    async removeLabel(pr, label): Promise<void> {
      try {
        await octokit.rest.issues.removeLabel({
          owner: pr.owner,
          repo: pr.repo,
          issue_number: pr.number,
          name: label,
        });
      } catch (error) {
        // A label that is not on the PR is the state this asks for, so a 404 is
        // the desired outcome arriving as an exception. Anything else is real.
        if ((error as { status?: number }).status !== 404) throw error;
      }
    },

    async postComment(pr, body): Promise<void> {
      await octokit.rest.issues.createComment({
        owner: pr.owner,
        repo: pr.repo,
        issue_number: pr.number,
        body: stampAutomated(body),
      });
    },

    async approveWithComments(pr, comments): Promise<void> {
      await octokit.rest.pulls.createReview({
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
        event: 'APPROVE',
        comments: comments.map((comment) => ({
          path: comment.path,
          line: comment.line,
          body: stampAutomated(comment.body),
        })),
      });
    },

    async listComments(pr): Promise<readonly PrComment[]> {
      const [conversation, inline] = await Promise.all([
        octokit.paginate(octokit.rest.issues.listComments, {
          owner: pr.owner,
          repo: pr.repo,
          issue_number: pr.number,
        }),
        octokit.paginate(octokit.rest.pulls.listReviewComments, {
          owner: pr.owner,
          repo: pr.repo,
          pull_number: pr.number,
        }),
      ]);

      // `type: 'Bot'` is GitHub's own answer, rather than sniffing for a `[bot]`
      // suffix a person could put in their display name.
      const isBot = (user: { readonly type?: string } | null): boolean => user?.type === 'Bot';
      // `createdAt` is carried only to sort by, then dropped: PrComment is what an agent reads,
      // and a timestamp there is noise it would have to ignore.
      const all: (PrComment & { readonly createdAt: string })[] = [
        ...conversation.map((comment) => ({
          author: comment.user?.login ?? 'unknown',
          isBot: isBot(comment.user),
          body: comment.body ?? '',
          createdAt: comment.created_at,
        })),
        ...inline.map((comment) => ({
          author: comment.user.login,
          isBot: isBot(comment.user),
          body: comment.body,
          createdAt: comment.created_at,
          path: comment.path,
          ...(comment.line === null || comment.line === undefined ? {} : { line: comment.line }),
        })),
      ];
      // One conversation, in the order it happened - the two endpoints are
      // separate only because GitHub stores them apart.
      return all
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(({ createdAt: _createdAt, ...comment }) => comment);
    },

    async commentReview(pr, body, comments): Promise<void> {
      await octokit.rest.pulls.createReview({
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
        event: 'COMMENT',
        body: stampAutomated(body),
        comments: comments.map((comment) => ({
          path: comment.path,
          line: comment.line,
          body: stampAutomated(comment.body),
        })),
      });
    },

    async requestChangesWithComments(pr, body, comments): Promise<readonly number[]> {
      const review = await octokit.rest.pulls.createReview({
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
        event: 'REQUEST_CHANGES',
        body: stampAutomated(body),
        comments: comments.map((comment) => ({
          path: comment.path,
          line: comment.line,
          body: stampAutomated(comment.body),
        })),
      });

      // Listing and filtering by review id is the only exact way to learn which
      // comments this review created; `createReview` answers with the review
      // alone. A failure here must not fail the review that already landed -
      // the complaint is posted either way, and losing the ids only costs the
      // replies.
      try {
        const all = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
          owner: pr.owner,
          repo: pr.repo,
          pull_number: pr.number,
        });
        return all
          .filter((comment) => comment.pull_request_review_id === review.data.id)
          .map((comment) => comment.id);
      } catch {
        return [];
      }
    },

    async replyToReviewComment(pr, commentId, body): Promise<void> {
      await octokit.rest.pulls.createReplyForReviewComment({
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
        comment_id: commentId,
        body: stampAutomated(body),
      });
    },

    async listReviewThreads(pr): Promise<readonly ReviewThread[]> {
      const query = `query($owner:String!,$repo:String!,$number:Int!){
        repository(owner:$owner,name:$repo){
          pullRequest(number:$number){
            reviewThreads(first:100){
              nodes { id isResolved comments(first:1){ nodes { body } } }
            }
          }
        }
      }`;
      const response = await octokit.graphql<{
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: { id: string; isResolved: boolean; comments: { nodes: { body: string }[] } }[];
            };
          };
        };
      }>(query, { owner: pr.owner, repo: pr.repo, number: pr.number });

      return response.repository.pullRequest.reviewThreads.nodes.map((node) => ({
        id: node.id,
        isResolved: node.isResolved,
        // The thread's *first* comment is the finding itself. A later reply carries the marker
        // too, so reading any other comment would call a person's thread the pipeline's as soon
        // as the pipeline answered in it.
        openedByPipeline: (node.comments.nodes[0]?.body ?? '').includes(AUTOMATION_MARKER),
      }));
    },

    async resolveReviewThread(threadId): Promise<void> {
      await octokit.graphql(
        `mutation($threadId:ID!){ resolveReviewThread(input:{threadId:$threadId}){ thread { id } } }`,
        { threadId },
      );
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
