import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSprintTasks } from '../../src/notifier/sprint-tasks.js';
import { sprintNotifierCredentialsFromEnv } from '../../src/notifier/sprint-notifier.js';

const FULL_ENV = {
  QL_SPRINT_URL: 'https://sprint.example.com',
  QL_AUTH_URL: 'https://auth.example.com',
  QL_AUTH_CLIENT_ID: 'client-id',
  QL_AUTH_CLIENT_SECRET: 'client-secret',
};

const TASK = {
  id: '2a7f3c19-4d5e-4f60-9b21-0c8e5a6d7b41',
  branch: 'features/add-a-thing-2a7f3c',
  prNumber: 44,
  name: 'Add a thing',
  state: 'in-review',
};

/** Answers the token mint, then GET /v1/tasks with whatever this test wants back. */
function stubFetch(
  tasksResponse: () => Response,
): Array<{ url: string; init?: RequestInit }> {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, ...(init === undefined ? {} : { init }) });
      if (url.includes('auth.example.com')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'minted-token', token_type: 'Bearer', expires_in: 300 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(tasksResponse());
    }),
  );
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const CREDENTIALS = sprintNotifierCredentialsFromEnv(FULL_ENV)!;

describe('readSprintTasks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads GET /v1/tasks with a freshly minted bearer token', async () => {
    const calls = stubFetch(() => json({ tasks: [TASK] }));

    const result = await readSprintTasks(CREDENTIALS, FULL_ENV);

    const read = calls.find((call) => call.url.includes('sprint.example.com'));
    expect(read?.url).toBe('https://sprint.example.com/v1/tasks');
    expect(new Headers(read?.init?.headers).get('authorization')).toBe('Bearer minted-token');
    expect(result).toEqual({ ok: true, tasks: [{ id: TASK.id, branch: TASK.branch, prNumber: 44 }] });
  });

  it('keeps only the three fields the decision reads, ignoring the rest of the record', async () => {
    stubFetch(() => json({ tasks: [TASK] }));

    const result = await readSprintTasks(CREDENTIALS, FULL_ENV);

    expect(result.ok && result.tasks[0]).not.toHaveProperty('state');
  });

  it('does not double the slash when the configured url has a trailing one', async () => {
    const env = { ...FULL_ENV, QL_SPRINT_URL: 'https://sprint.example.com/' };
    const calls = stubFetch(() => json({ tasks: [] }));

    await readSprintTasks(sprintNotifierCredentialsFromEnv(env)!, env);

    expect(calls.find((call) => call.url.includes('sprint.example'))?.url).toBe('https://sprint.example.com/v1/tasks');
  });

  it("sends the sprint hop's own edge secret, not another exposure's", async () => {
    const env = { ...FULL_ENV, QL_HOUSE_PROXY_TOKEN: 'house-secret', QL_SPRINT_PROXY_TOKEN: 'sprint-secret' };
    const calls = stubFetch(() => json({ tasks: [] }));

    await readSprintTasks(sprintNotifierCredentialsFromEnv(env)!, env);

    const read = calls.find((call) => call.url.includes('sprint.example.com'));
    expect(new Headers(read?.init?.headers).get('x-ql-proxy-token')).toBe('sprint-secret');
  });

  it('distinguishes an empty sprint from an unreachable one', async () => {
    // The whole reason this returns a result: collapse these two and an outage reads as
    // "no task exists", which is the one conclusion this must never reach by accident.
    stubFetch(() => json({ tasks: [] }));

    await expect(readSprintTasks(CREDENTIALS, FULL_ENV)).resolves.toEqual({ ok: true, tasks: [] });
  });

  it('fails open when ql-sprint refuses, naming the status', async () => {
    stubFetch(() => json({ error: 'nope' }, 503));

    const result = await readSprintTasks(CREDENTIALS, FULL_ENV);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('status 503');
  });

  it('fails open when the network is down rather than throwing at the caller', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );

    const result = await readSprintTasks(CREDENTIALS, FULL_ENV);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('ECONNREFUSED');
  });

  it('fails open when the body is not the shape ql-sprint promises', async () => {
    stubFetch(() => json({ items: [TASK] }));

    const result = await readSprintTasks(CREDENTIALS, FULL_ENV);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('{ tasks: [...] }');
  });

  it('fails open when the body is not JSON at all', async () => {
    stubFetch(() => new Response('<html>gateway</html>', { status: 200 }));

    expect((await readSprintTasks(CREDENTIALS, FULL_ENV)).ok).toBe(false);
  });

  it('drops one malformed row rather than going blind to the rest of the list', async () => {
    stubFetch(() => json({ tasks: [{ branch: 'features/no-id' }, null, 'nonsense', TASK] }));

    const result = await readSprintTasks(CREDENTIALS, FULL_ENV);

    expect(result.ok && result.tasks).toEqual([{ id: TASK.id, branch: TASK.branch, prNumber: 44 }]);
  });

  it('normalises an absent branch and PR number to null, not undefined', async () => {
    stubFetch(() => json({ tasks: [{ id: TASK.id }] }));

    const result = await readSprintTasks(CREDENTIALS, FULL_ENV);

    expect(result.ok && result.tasks[0]).toEqual({ id: TASK.id, branch: null, prNumber: null });
  });
});
