// @neuron shared.core.githubClient
import { getOctokit } from '@actions/github';
// @signal readPullRequestContext
export function readPullRequestContext(context) {
    const pr = context.payload.pull_request;
    if (pr === undefined) {
        throw new Error('this workflow must be triggered by a pull_request event (no pull_request found in the event payload)');
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
/** Thin Octokit wrapper for the two calls this pipeline needs so far. */
// @signal createGithubClient
export function createGithubClient(token) {
    const octokit = getOctokit(token);
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
        async postComment(pr, body) {
            await octokit.rest.issues.createComment({
                owner: pr.owner,
                repo: pr.repo,
                issue_number: pr.number,
                body,
            });
        },
        async approveWithComments(pr, comments) {
            await octokit.rest.pulls.createReview({
                owner: pr.owner,
                repo: pr.repo,
                pull_number: pr.number,
                event: 'APPROVE',
                comments: comments.map((comment) => ({ path: comment.path, line: comment.line, body: comment.body })),
            });
        },
        async requestChangesWithComments(pr, body, comments) {
            const review = await octokit.rest.pulls.createReview({
                owner: pr.owner,
                repo: pr.repo,
                pull_number: pr.number,
                event: 'REQUEST_CHANGES',
                body,
                comments: comments.map((comment) => ({ path: comment.path, line: comment.line, body: comment.body })),
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
            }
            catch {
                return [];
            }
        },
        async replyToReviewComment(pr, commentId, body) {
            await octokit.rest.pulls.createReplyForReviewComment({
                owner: pr.owner,
                repo: pr.repo,
                pull_number: pr.number,
                comment_id: commentId,
                body,
            });
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
    };
}
//# sourceMappingURL=github-client.js.map