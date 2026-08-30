// @neuron entrypoint.cli.bootstrap
import { context } from '@actions/github';
import { couldGovernPullRequest, governsPullRequest, resolveTargetBranch } from '../merger/target-branch.js';
import { determineRoute } from '../router/router.js';
import { loadConfig } from '../shared/config.js';
import { createGithubClient, readPullRequestContext, } from '../shared/github-client.js';
import { createLogger } from '../shared/logger.js';
const DEFAULT_CONFIG_PATH = '.github/pipeline.config.yml';
/**
 * Everything every job needs before it can do anything: credentials,
 * config, and the PR it is acting on. Shared by the gate jobs and the
 * pipeline job so the three checks cannot drift apart on setup.
 */
// @signal createPipelineContext
export function createPipelineContext() {
    const token = process.env['GITHUB_TOKEN'];
    if (token === undefined || token.length === 0) {
        throw new Error('GITHUB_TOKEN environment variable is required');
    }
    const configPath = process.env['PIPELINE_CONFIG_PATH'] ?? DEFAULT_CONFIG_PATH;
    return {
        config: loadConfig(configPath),
        // @actions/github's payload type leaves most of `pull_request` to a
        // `[key: string]: any` catch-all, so it doesn't structurally satisfy
        // our stricter ActionsEventContext even though the real webhook
        // payload always carries these fields.
        pr: readPullRequestContext(context),
        client: createGithubClient(token),
        logger: createLogger('info'),
        consumerRoot: process.cwd(),
    };
}
/**
 * Decides whether this PR is in scope and, if so, what it routes to. Every
 * job runs this independently rather than one job routing on behalf of the
 * others: it costs a single API call, and it means each check reports the
 * truth about the PR in front of it instead of inheriting a verdict from a
 * job that may have been skipped.
 *
 * Callers decide how loudly to react — a gate job that can't route just
 * fails; the pipeline job additionally comments and labels.
 */
// @signal resolveRouting
export async function resolveRouting(client, pr, config) {
    // Cheapest possible exit for a PR this pipeline has no authority over:
    // no API calls at all, let alone gates or AI spend.
    if (!couldGovernPullRequest(pr.baseRef, config.merge)) {
        return {
            kind: 'not-governed',
            reason: `this PR targets "${pr.baseRef}", which is not a branch this pipeline governs`,
        };
    }
    const commitMessages = await client.listCommitMessages(pr);
    const route = determineRoute({ commitMessages, prTitle: pr.title }, config);
    if (!route.ok) {
        return { kind: 'unroutable', reason: route.reason };
    }
    const target = resolveTargetBranch(route.decision.areas, config.merge);
    if (!target.ok) {
        return { kind: 'target-conflict', reason: target.reason };
    }
    if (!governsPullRequest(pr.baseRef, target.targetBranch)) {
        return {
            kind: 'not-governed',
            reason: `this PR targets "${pr.baseRef}" but its areas resolve to "${target.targetBranch}"`,
        };
    }
    return { kind: 'proceed', route: route.decision, targetBranch: target.targetBranch };
}
//# sourceMappingURL=bootstrap.js.map