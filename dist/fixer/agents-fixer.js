// @neuron fix.fixer.agentsFixer
import { QlAuthClient } from '@0xb1te/ql-auth-client';
import { proxyFetchFromEnv } from '../standards/house-credentials.js';
export const AGENTS_URL_VAR = 'QL_AGENTS_URL';
export const AGENTS_WORKTREE_BASE_VAR = 'QL_AGENTS_WORKTREE_BASE';
/** Terminal run states. Anything else means the run is still ours to wait for. */
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
/**
 * Everything needed to reach ql-agents, or undefined when this fleet has not published one.
 *
 * Undefined is not an error, for the same reason it is not one in the sprint notifier: a fleet
 * can govern perfectly well with the in-process cursor fixer and never run ql-agents at all.
 * What makes it an error is *asking* for the `ql_agents` provider without it, and that judgement
 * belongs to the caller, which is the only thing that knows which provider was configured.
 *
 * It reuses the ql-auth credentials the standards hop already needs, so a fleet that has those
 * and publishes ql-agents only has to add `QL_AGENTS_URL`.
 */
// @signal agentsFixerCredentialsFromEnv
export function agentsFixerCredentialsFromEnv(env = process.env) {
    const agentsUrl = present(env[AGENTS_URL_VAR]);
    const worktreeBaseDir = present(env[AGENTS_WORKTREE_BASE_VAR]);
    const qlAuthUrl = present(env['QL_AUTH_URL']);
    const qlAuthClientId = present(env['QL_AUTH_CLIENT_ID']);
    const qlAuthClientSecret = present(env['QL_AUTH_CLIENT_SECRET']);
    if (agentsUrl === undefined ||
        worktreeBaseDir === undefined ||
        qlAuthUrl === undefined ||
        qlAuthClientId === undefined ||
        qlAuthClientSecret === undefined) {
        return undefined;
    }
    return { agentsUrl, worktreeBaseDir, qlAuthUrl, qlAuthClientId, qlAuthClientSecret };
}
function present(value) {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}
function trimSlash(url) {
    return url.endsWith('/') ? url.slice(0, -1) : url;
}
/**
 * The complaint, as the brief a coding agent is given.
 *
 * Protected paths are stated in the brief because with this provider they cannot be enforced the
 * way the cursor fixer enforces them. `runFix` reverts them in its own working tree before it
 * commits; ql-agents works in a worktree on its own host and pushes the branch itself, so there
 * is no moment where this process holds the diff. The backstop is R4 on the run that push
 * triggers — `touchesProtectedPaths` escalates the pull request to a human and refuses to
 * auto-merge it — so a violation is caught and blocked rather than silently merged. Saying so
 * here is what makes the weaker guarantee deliberate instead of accidental.
 */
// @signal buildAgentsBrief
export function buildAgentsBrief(findings, protectedPaths) {
    const complaints = findings
        .map((finding, index) => {
        const where = `${finding.file}:${String(finding.line)}`;
        const fix = finding.suggestedFix === null ? '' : `\nSuggested fix: ${finding.suggestedFix}`;
        return `${String(index + 1)}. [${finding.severity}] ${finding.rule} at ${where}\n${finding.problem}${fix}`;
    })
        .join('\n\n');
    const guard = protectedPaths.length === 0
        ? ''
        : `\n\nDo not edit these paths under any circumstance:\n${protectedPaths.map((p) => `- ${p}`).join('\n')}\n` +
            'A change to any of them is reverted and escalated to a human, so editing one spends this ' +
            'attempt and fixes nothing.';
    return ('A pull request review raised the findings below. Fix them in this checkout and commit the ' +
        `result to the branch you were given. Change nothing else.\n\n${complaints}${guard}`);
}
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_MS = 10_000;
/**
 * Runs one fix attempt through ql-agents instead of spawning `cursor-agent` in this process.
 *
 * The provider indirection is the point. `runFix` is welded to the Cursor CLI: it spawns a
 * binary, diffs its own working tree and commits what it finds. Everything about that is Cursor,
 * and changing model vendor meant changing the fixer. ql-agents already owns "run a coding agent
 * against a branch" for the rest of the suite, so routing through it makes the vendor a
 * descriptor on the far side rather than a code path here.
 *
 * The shape of the work moves with it. ql-agents clones the repository into a worktree on its own
 * host and pushes the branch itself, so this function never holds a diff: it dispatches, reports
 * the run id, waits, and reads the verdict. That is also why protected paths are a brief and an
 * R4 backstop rather than a revert — see {@link buildAgentsBrief}.
 */
// @signal runAgentsFix
export async function runAgentsFix(findings, area, options) {
    const doFetch = options.fetchImpl ?? fetch;
    const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const now = options.now ?? Date.now;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    const base = trimSlash(options.credentials.agentsUrl);
    let accessToken;
    try {
        const authFetch = proxyFetchFromEnv(process.env, 'auth');
        const auth = new QlAuthClient({
            baseUrl: options.credentials.qlAuthUrl,
            ...(authFetch !== undefined ? { fetch: authFetch } : {}),
        });
        const issued = await auth.issueToken({
            grantType: 'client_credentials',
            clientId: options.credentials.qlAuthClientId,
            clientSecret: options.credentials.qlAuthClientSecret,
        });
        accessToken = issued.access_token;
    }
    catch (cause) {
        return { kind: 'agent-error', reason: `could not mint a ql-auth token for ql-agents: ${String(cause)}` };
    }
    // The agents hop's own secret. ql-proxy issues one per exposure, so sprint's would be refused
    // at this address exactly as auth's is refused at sprint's.
    const agentsFetch = proxyFetchFromEnv(process.env, 'agents') ?? doFetch;
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
    const brief = buildAgentsBrief(findings, options.protectedPaths);
    const description = options.humanDirection === undefined || options.humanDirection === ''
        ? brief
        : `${brief}\n\nWhat people said on the pull request:\n${options.humanDirection}`;
    let runId;
    try {
        const response = await agentsFetch(`${base}/v1/runs`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                mode: 'implement',
                repo: { url: options.repoUrl },
                worktree: { baseDir: options.worktreeBaseDir, taskId: options.taskId },
                branch: options.branch,
                task: {
                    id: options.taskId,
                    name: `Fix ${String(findings.length)} ${area} finding(s), attempt ${String(options.attemptNumber)}`,
                    description,
                    taskType: 'Bugfix',
                },
                ...(options.model !== undefined && options.model !== '' ? { model: options.model } : {}),
            }),
        });
        if (!response.ok) {
            return {
                kind: 'agent-error',
                reason: `ql-agents refused the run with status ${String(response.status)}`,
            };
        }
        const body = (await response.json());
        if (typeof body.runId !== 'string' || body.runId === '') {
            return { kind: 'agent-error', reason: 'ql-agents accepted the run but returned no run id' };
        }
        runId = body.runId;
    }
    catch (cause) {
        return { kind: 'agent-error', reason: `could not reach ql-agents: ${String(cause)}` };
    }
    if (options.onDispatched !== undefined) {
        try {
            await options.onDispatched(runId);
        }
        catch {
            // The run is already executing. Failing it over an unposted comment would be the messenger
            // undoing the message — the same call `govern` makes for every other best-effort reply.
        }
    }
    const deadline = now() + timeoutMs;
    for (;;) {
        if (now() >= deadline) {
            return {
                kind: 'agent-error',
                reason: `ql-agents run ${runId} did not finish within ${String(Math.round(timeoutMs / 60000))} minutes`,
            };
        }
        await sleep(pollIntervalMs);
        let summary;
        try {
            const response = await agentsFetch(`${base}/v1/runs/${runId}`, { headers });
            if (!response.ok) {
                return {
                    kind: 'agent-error',
                    reason: `ql-agents would not report run ${runId}: status ${String(response.status)}`,
                };
            }
            summary = (await response.json());
        }
        catch (cause) {
            return { kind: 'agent-error', reason: `lost contact with ql-agents while waiting: ${String(cause)}` };
        }
        const status = typeof summary.status === 'string' ? summary.status : '';
        if (!TERMINAL.has(status)) {
            continue;
        }
        if (status === 'completed') {
            // ql-agents pushed the branch itself, so there is no commit message of this pipeline's
            // making to report. The run id is the honest identifier for what happened.
            return { kind: 'committed', commitMessage: `ql-agents run ${runId}`, files: [] };
        }
        return { kind: 'agent-error', reason: `ql-agents run ${runId} ended as ${status}` };
    }
}
//# sourceMappingURL=agents-fixer.js.map