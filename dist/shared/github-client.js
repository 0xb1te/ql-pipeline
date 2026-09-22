// @neuron shared.core.githubClient
import { getOctokit } from '@actions/github';
import { AUTOMATION_MARKER } from './types.js';
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
};
/**
 * Reads the resolved PR, or undefined when none was handed down.
 *
 * "Partly handed down" is an error rather than a fallthrough. A resolver that
 * set the number but lost the head sha is broken, and the alternative — giving
 * up and reporting "this must be triggered by a pull_request event" — would
 * send whoever reads that message hunting the trigger, which is the one thing
 * that is not wrong.
 */
function readResolvedPullRequest(context, env) {
    const raw = Object.fromEntries(Object.entries(RESOLVED_PR_VARS).map(([field, variable]) => [field, (env[variable] ?? '').trim()]));
    if (Object.values(raw).every((value) => value === '')) {
        return undefined;
    }
    const missing = Object.entries(RESOLVED_PR_VARS)
        .filter(([field]) => raw[field] === '')
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
export function readPullRequestContext(context, env = process.env) {
    const pr = context.payload.pull_request;
    if (pr === undefined) {
        const resolved = readResolvedPullRequest(context, env);
        if (resolved !== undefined) {
            return resolved;
        }
        throw new Error('this workflow must be triggered by a pull_request event, or be handed a resolved pull request ' +
            `through ${RESOLVED_PR_VARS.number} and its siblings (no pull_request found in the event payload)`);
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
 * Appends the marker, unless it is already there.
 *
 * Applied inside the client rather than at each call site on purpose: a body that reaches GitHub
 * unstamped is a loop, and "remember to stamp it" is not a property a codebase can hold.
 */
// @signal stampAutomated
export function stampAutomated(body) {
    return body.includes(AUTOMATION_MARKER) ? body : `${body}

${AUTOMATION_MARKER}`;
}
/** Thin Octokit wrapper for the two calls this pipeline needs so far. */
// @signal createGithubClient
export function createGithubClient(token) {
    const octokit = getOctokit(token);
    /**
     * Posts one review and hands back the ids of the inline comments it created.
     *
     * Shared by the two events that carry findings, so the id read-back cannot drift between them.
     *
     * Listing and filtering by review id is the only exact way to learn which comments this review
     * created; `createReview` answers with the review alone. A failure there must not fail the review
     * that already landed - the complaint is posted either way, and losing the ids only costs the
     * replies.
     */
    const postReviewWithThreads = async (pr, event, body, comments) => {
        const review = await octokit.rest.pulls.createReview({
            owner: pr.owner,
            repo: pr.repo,
            pull_number: pr.number,
            event,
            body: stampAutomated(body),
            comments: comments.map((comment) => ({
                path: comment.path,
                line: comment.line,
                body: stampAutomated(comment.body),
            })),
        });
        try {
            const all = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
                owner: pr.owner,
                repo: pr.repo,
                pull_number: pr.number,
            });
            return all
                .filter((comment) => comment.pull_request_review_id === review.data.id)
                .map((comment) => comment.id);
        }
        catch {
            return [];
        }
    };
    return {
        async listCommitMessages(pr) {
            const commits = await octokit.paginate(octokit.rest.pulls.listCommits, {
                owner: pr.owner,
                repo: pr.repo,
                pull_number: pr.number,
            });
            return commits.map((commit) => commit.commit.message);
        },
        async listChangedFiles(pr) {
            const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
                owner: pr.owner,
                repo: pr.repo,
                pull_number: pr.number,
            });
            return files.map((file) => file.filename);
        },
        async getPullRequestDetails(pr) {
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
            const diff = diffResponse.data;
            return { description: metadata.data.body ?? '', diff };
        },
        async addLabels(pr, labels) {
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
        async removeLabel(pr, label) {
            try {
                await octokit.rest.issues.removeLabel({
                    owner: pr.owner,
                    repo: pr.repo,
                    issue_number: pr.number,
                    name: label,
                });
            }
            catch (error) {
                // A label that is not on the PR is the state this asks for, so a 404 is
                // the desired outcome arriving as an exception. Anything else is real.
                if (error.status !== 404)
                    throw error;
            }
        },
        async postComment(pr, body) {
            await octokit.rest.issues.createComment({
                owner: pr.owner,
                repo: pr.repo,
                issue_number: pr.number,
                body: stampAutomated(body),
            });
        },
        async approveWithComments(pr, comments) {
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
        async listComments(pr) {
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
            const isBot = (user) => user?.type === 'Bot';
            // `createdAt` is carried only to sort by, then dropped: PrComment is what an agent reads,
            // and a timestamp there is noise it would have to ignore.
            const all = [
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
        async commentReview(pr, body, comments) {
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
        async requestChangesWithComments(pr, body, comments) {
            return postReviewWithThreads(pr, 'REQUEST_CHANGES', body, comments);
        },
        async commentReviewWithThreads(pr, body, comments) {
            return postReviewWithThreads(pr, 'COMMENT', body, comments);
        },
        async replyToReviewComment(pr, commentId, body) {
            await octokit.rest.pulls.createReplyForReviewComment({
                owner: pr.owner,
                repo: pr.repo,
                pull_number: pr.number,
                comment_id: commentId,
                body: stampAutomated(body),
            });
        },
        async listReviewThreads(pr) {
            const query = `query($owner:String!,$repo:String!,$number:Int!){
        repository(owner:$owner,name:$repo){
          pullRequest(number:$number){
            reviewThreads(first:100){
              nodes { id isResolved comments(first:1){ nodes { body } } }
            }
          }
        }
      }`;
            const response = await octokit.graphql(query, { owner: pr.owner, repo: pr.repo, number: pr.number });
            return response.repository.pullRequest.reviewThreads.nodes.map((node) => ({
                id: node.id,
                isResolved: node.isResolved,
                // The thread's *first* comment is the finding itself. A later reply carries the marker
                // too, so reading any other comment would call a person's thread the pipeline's as soon
                // as the pipeline answered in it.
                openedByPipeline: (node.comments.nodes[0]?.body ?? '').includes(AUTOMATION_MARKER),
            }));
        },
        async resolveReviewThread(threadId) {
            await octokit.graphql(`mutation($threadId:ID!){ resolveReviewThread(input:{threadId:$threadId}){ thread { id } } }`, { threadId });
        },
        async mergePullRequest(pr, method, expectedHeadSha) {
            await octokit.rest.pulls.merge({
                owner: pr.owner,
                repo: pr.repo,
                pull_number: pr.number,
                merge_method: method,
                sha: expectedHeadSha,
            });
        },
        async getHeadSha(pr) {
            const { data } = await octokit.rest.pulls.get({
                owner: pr.owner,
                repo: pr.repo,
                pull_number: pr.number,
            });
            return data.head.sha;
        },
        async deleteBranch(pr) {
            await octokit.rest.git.deleteRef({
                owner: pr.owner,
                repo: pr.repo,
                ref: `heads/${pr.headRef}`,
            });
        },
        async listPullRequestsByLabel(repo, label) {
            const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
                owner: repo.owner,
                repo: repo.repo,
                labels: label,
                state: 'open',
            });
            return issues
                .filter((issue) => issue.pull_request !== undefined)
                .map((issue) => ({
                number: issue.number,
                title: issue.title,
                url: issue.html_url,
                isDraft: issue.draft === true,
                labels: issue.labels
                    .map((entry) => (typeof entry === 'string' ? entry : (entry.name ?? '')))
                    .filter((name) => name.length > 0),
                updatedAt: issue.updated_at,
            }));
        },
    };
}
//# sourceMappingURL=github-client.js.map