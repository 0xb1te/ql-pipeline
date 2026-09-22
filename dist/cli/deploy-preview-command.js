// @neuron entrypoint.cli.deployPreviewCommand
import { join } from 'node:path';
import * as core from '@actions/core';
import { decidePreviewDeploy, findPreviewInListing, formatPreviewSummary, mcpEndpointFor, parsePreviewUpOutput, previewUpArgs, } from '../deploy/preview-stack.js';
import { defaultArgvExecutor } from '../shared/exec.js';
import { createMcpClient } from '../tester/mcp-client.js';
import { assessPreviewEnvironment, readPreviewEnvironmentSnapshot, PREVIEW_ENVIRONMENT_DIR, } from '../verdict/preview-environment.js';
import { lookupTaskFolder } from '../verdict/task-artifacts.js';
import { createPipelineContext } from './bootstrap.js';
/** The preview host's checkout of ql-proxy, built. A repository variable on the consumer. */
export const PROXY_HOME_VAR = 'QL_PROXY_HOME';
/** Which ql-proxy.yml the CLI reads on that host. Optional; the CLI has its own default. */
export const PROXY_CONFIG_VAR = 'QL_PROXY_CONFIG';
/**
 * The token ql-proxy's own `gh pr comment` announces the address with. The workflow passes
 * `github.token` here and never GH_TOKEN, deliberately: ql-proxy's comment carries no automation
 * marker, so it must arrive as github-actions[bot] - which the resolve job declines - rather than
 * as the person GH_TOKEN belongs to, whose comments start another run.
 */
export const ANNOUNCE_TOKEN_VAR = 'QL_PREVIEW_ANNOUNCE_TOKEN';
/** Read by the devops compose to mount `docs/${QL_TASK_FOLDER}/seed.sql` into the database. */
export const TASK_FOLDER_VAR = 'QL_TASK_FOLDER';
/** Offered to the devops compose so it can pass the switch through to the application. */
export const MCP_ENABLED_VAR = 'QL_MCP_ENABLED';
/** The job outputs the workflow reads to decide whether, and where, the tester runs. */
export const DEPLOYED_OUTPUT = 'deployed';
export const URL_OUTPUT = 'url';
export const PROJECT_OUTPUT = 'project';
export const MCP_URL_OUTPUT = 'mcp-url';
export const MCP_READY_OUTPUT = 'mcp-ready';
const READY_POLL_MS = 5_000;
async function probeOverMcp(endpoint) {
    try {
        await createMcpClient({ endpoint, timeoutMs: READY_POLL_MS }).listTools();
        return true;
    }
    catch {
        return false;
    }
}
function firstLine(text) {
    return text.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '') ?? '';
}
function messageOf(cause) {
    if (cause instanceof Error) {
        const withStreams = cause;
        const stderr = typeof withStreams.stderr === 'string' ? withStreams.stderr.trim() : '';
        return stderr !== '' ? `${cause.message}\n${stderr}` : cause.message;
    }
    return String(cause);
}
/**
 * Brings the pull request's preview up and says where it is, as an outcome the caller turns into
 * job outputs.
 *
 * Every dependency that touches the machine - the two processes it spawns, the clock, the MCP
 * probe - is injected, so the whole sequence is testable without ql-proxy, Docker or a network.
 *
 * The decision to deploy is made again here, from the same facts `govern` used, rather than
 * trusted from the job condition. The workflow's `if:` is the gate that saves a runner; this is
 * the gate that refuses to bring a stack up for a repository whose folder is not there.
 */
// @signal deployPreview
export async function deployPreview(ctx, deps) {
    const { config, pr, client, logger, consumerRoot } = ctx;
    const taskFolder = lookupTaskFolder(pr.headRef, consumerRoot);
    const environment = assessPreviewEnvironment(readPreviewEnvironmentSnapshot(consumerRoot), config.areas.paths);
    const decision = decidePreviewDeploy({
        enabled: config.preview.enabled,
        environment: environment.kind,
        taskFolder,
        isFork: pr.isFork,
    });
    if (!decision.deploy || taskFolder.kind !== 'folder') {
        logger.info(`preview: not deploying — ${decision.reason}`);
        return { kind: 'skipped', reason: decision.reason };
    }
    const proxyHome = deps.env[PROXY_HOME_VAR];
    if (proxyHome === undefined || proxyHome.trim() === '') {
        return {
            kind: 'failed',
            reason: `${PROXY_HOME_VAR} is not set. It names the preview host's built checkout of ql-proxy and is a ` +
                'repository variable on the consumer, because this job runs on that host and has to be told where the CLI is.',
        };
    }
    const proxyMain = join(proxyHome, 'dist', 'cli', 'entry', 'main.js');
    const proxyConfig = deps.env[PROXY_CONFIG_VAR];
    const announceToken = deps.env[ANNOUNCE_TOKEN_VAR];
    const childEnv = {
        // `docs/features/007-x` -> `features/007-x`, the shape the contract's compose reads.
        [TASK_FOLDER_VAR]: taskFolder.path.replace(/^docs\//, ''),
        [MCP_ENABLED_VAR]: 'true',
        ...(proxyConfig === undefined || proxyConfig === '' ? {} : { [PROXY_CONFIG_VAR]: proxyConfig }),
        ...(announceToken === undefined || announceToken === '' ? {} : { GH_TOKEN: announceToken }),
    };
    const devopsDir = join(consumerRoot, PREVIEW_ENVIRONMENT_DIR);
    const upArgs = previewUpArgs({
        branch: pr.headRef,
        repository: `${pr.owner}/${pr.repo}`,
        pullRequest: pr.number,
        checkoutDir: devopsDir,
        ttlMinutes: config.preview.ttlMinutes,
        protect: config.preview.protect,
    });
    logger.info(`preview: bringing ${PREVIEW_ENVIRONMENT_DIR}/ up through ql-proxy, seeded from ${taskFolder.path}`);
    let upStdout;
    try {
        const result = await deps.exec('node', [proxyMain, ...upArgs], { cwd: consumerRoot, env: childEnv });
        upStdout = result.stdout;
    }
    catch (cause) {
        return { kind: 'failed', reason: `ql-proxy up failed: ${messageOf(cause)}` };
    }
    const { url, token } = parsePreviewUpOutput(upStdout);
    if (url === null) {
        return { kind: 'failed', reason: `ql-proxy up printed no preview URL. Its output was:\n${upStdout.trim()}` };
    }
    logger.info(`preview: live at ${url}`);
    // The listing is the only place the project name, the time left and whether the host actually
    // locked it are stated; `up` prints the URL and nothing else.
    let listing = null;
    try {
        const result = await deps.exec('node', [proxyMain, 'list', '--json'], { cwd: consumerRoot, env: childEnv });
        listing = findPreviewInListing(result.stdout, url);
    }
    catch (cause) {
        logger.warn(`preview: could not read the ql-proxy listing: ${messageOf(cause)}`);
    }
    if (listing === null) {
        logger.warn('preview: the stack is up but the listing does not report it, so its MCP server cannot be located');
    }
    const project = listing?.project ?? '(unknown)';
    let endpoint = null;
    if (listing !== null) {
        try {
            const containers = await deps.exec('docker', ['compose', '-p', listing.project, 'ps', '-q', config.preview.mcp.service], { cwd: consumerRoot });
            const containerId = firstLine(containers.stdout);
            if (containerId === '') {
                logger.warn(`preview: no container for service ${config.preview.mcp.service} in ${listing.project}`);
            }
            else {
                const inspected = await deps.exec('docker', ['inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}', containerId], { cwd: consumerRoot });
                endpoint = mcpEndpointFor(inspected.stdout, config.preview.mcp.port, config.preview.mcp.path);
            }
        }
        catch (cause) {
            logger.warn(`preview: could not locate the MCP server: ${messageOf(cause)}`);
        }
    }
    let ready = false;
    let waitedSeconds = 0;
    if (endpoint !== null) {
        const started = deps.now();
        const deadline = started + config.preview.mcp.readyTimeoutSeconds * 1000;
        // Bounded: a server that never comes up is reported, not waited for forever. Handing the
        // tester an address that does not answer is right - it reports that as a finding.
        for (;;) {
            ready = await deps.probeMcp(endpoint);
            waitedSeconds = Math.round((deps.now() - started) / 1000);
            if (ready || deps.now() >= deadline)
                break;
            await deps.sleep(READY_POLL_MS);
        }
        logger.info(`preview: MCP at ${endpoint} ${ready ? 'answering' : 'not answering'} after ${String(waitedSeconds)}s`);
    }
    const expiresAt = listing?.minutesRemaining === null || listing?.minutesRemaining === undefined || !listing.expires
        ? null
        : new Date(deps.now() + listing.minutesRemaining * 60_000).toISOString();
    await client.postComment(pr, formatPreviewSummary({
        url,
        project,
        token,
        protected: listing?.protected ?? false,
        minutesRemaining: listing !== null && listing.expires ? listing.minutesRemaining : null,
        expiresAt,
        mcp: { endpoint, ready, waitedSeconds },
    }));
    return { kind: 'deployed', url, project, mcpUrl: endpoint, mcpReady: ready };
}
/**
 * The `preview` job's command: deploy, then publish what happened as job outputs.
 *
 * A skipped deploy is not a failure - the job condition should have kept this from running, and
 * a second guard that agrees is a quiet exit. A failed one fails the check, because a green pull
 * request that could not be previewed is something a person should hear about on the PR.
 */
// @signal runDeployPreview
export async function runDeployPreview() {
    const ctx = createPipelineContext();
    const outcome = await deployPreview(ctx, {
        exec: defaultArgvExecutor,
        env: process.env,
        probeMcp: probeOverMcp,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => Date.now(),
    });
    core.setOutput(DEPLOYED_OUTPUT, outcome.kind === 'deployed' ? 'true' : 'false');
    core.setOutput(URL_OUTPUT, outcome.kind === 'deployed' ? outcome.url : '');
    core.setOutput(PROJECT_OUTPUT, outcome.kind === 'deployed' ? outcome.project : '');
    core.setOutput(MCP_URL_OUTPUT, outcome.kind === 'deployed' ? (outcome.mcpUrl ?? '') : '');
    core.setOutput(MCP_READY_OUTPUT, outcome.kind === 'deployed' && outcome.mcpReady ? 'true' : 'false');
    if (outcome.kind === 'failed') {
        core.setFailed(outcome.reason);
    }
}
//# sourceMappingURL=deploy-preview-command.js.map