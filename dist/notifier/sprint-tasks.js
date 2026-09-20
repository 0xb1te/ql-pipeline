// @neuron notify.sprint.sprintTasks
import { QlAuthClient } from '@0xb1te/ql-auth-client';
import { proxyFetchFromEnv } from '../standards/house-credentials.js';
/**
 * Reads ql-sprint's `GET /v1/tasks`, so a governance run can tell whether the pull request in
 * front of it is a task somebody planned or one somebody invented.
 *
 * The same hop the notifier makes, in the other direction, and deliberately the same one: a
 * freshly minted `client_credentials` token for the route's JWT guard, and the `sprint` exposure's
 * own ql-proxy secret for the edge in front of it. A second way to reach ql-sprint would be a
 * second set of credentials to keep in step.
 *
 * Fails open, which is the whole reason it returns a result instead of throwing. Every way this
 * can fail - no network, a refused token, a 503, a body that is not the shape promised - means
 * this run does not know whether the pull request has a task. It does not mean the pull request
 * has none. The check this feeds is advisory even when it works, so an unreachable ql-sprint has
 * no business costing a review that has otherwise passed.
 */
// @signal readSprintTasks
export async function readSprintTasks(credentials, env = process.env) {
    try {
        const authFetch = proxyFetchFromEnv(env, 'auth');
        const auth = new QlAuthClient({
            baseUrl: credentials.qlAuthUrl,
            ...(authFetch !== undefined ? { fetch: authFetch } : {}),
        });
        const { access_token: accessToken } = await auth.issueToken({
            grantType: 'client_credentials',
            clientId: credentials.qlAuthClientId,
            clientSecret: credentials.qlAuthClientSecret,
        });
        const sprintFetch = proxyFetchFromEnv(env, 'sprint') ?? fetch;
        const response = await sprintFetch(`${trimSlash(credentials.sprintUrl)}/v1/tasks`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!response.ok) {
            return { ok: false, reason: `ql-sprint answered GET /v1/tasks with status ${String(response.status)}` };
        }
        const body = await response.json();
        const tasks = readTasks(body);
        if (tasks === null) {
            return { ok: false, reason: 'ql-sprint’s GET /v1/tasks did not return a { tasks: [...] } body' };
        }
        return { ok: true, tasks };
    }
    catch (cause) {
        return { ok: false, reason: `could not reach ql-sprint - ${String(cause)}` };
    }
}
/**
 * Narrows the wire body to the three fields this pipeline reads, or null when it is not the shape
 * ql-sprint promises.
 *
 * A task without a string `id` is dropped rather than failing the read: ql-sprint owns that record
 * and may grow it, and one malformed entry should not blind the check to the rest. A body that is
 * not `{ tasks: [...] }` at all is a different matter - that is not a list with a bad row in it,
 * it is not a list.
 */
function readTasks(body) {
    const raw = body?.tasks;
    if (!Array.isArray(raw))
        return null;
    return raw
        .filter((entry) => typeof entry === 'object' && entry !== null)
        .filter((entry) => typeof entry['id'] === 'string' && entry['id'] !== '')
        .map((entry) => ({
        id: entry['id'],
        branch: typeof entry['branch'] === 'string' ? entry['branch'] : null,
        prNumber: typeof entry['prNumber'] === 'number' ? entry['prNumber'] : null,
    }));
}
function trimSlash(url) {
    return url.endsWith('/') ? url.slice(0, -1) : url;
}
//# sourceMappingURL=sprint-tasks.js.map