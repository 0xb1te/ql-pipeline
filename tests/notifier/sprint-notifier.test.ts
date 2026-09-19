import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSprintNotifier,
  sprintNotifierCredentialsFromEnv,
  SPRINT_URL_VAR,
  type SprintNotice,
} from '../../src/notifier/sprint-notifier.js';

const FULL_ENV = {
  QL_SPRINT_URL: 'https://sprint.example.com',
  QL_AUTH_URL: 'https://auth.example.com',
  QL_AUTH_CLIENT_ID: 'client-id',
  QL_AUTH_CLIENT_SECRET: 'client-secret',
};

/** The body this module always sends: a JSON string, narrowed once here rather than cast at each read. */
function readBody(init: RequestInit | undefined): string {
  const body = init?.body;
  return typeof body === 'string' ? body : '';
}

const NOTICE: SprintNotice = { repo: '0xb1te/ql-desktop', prNumber: 44, verdict: 'awaiting-human' };

describe('sprintNotifierCredentialsFromEnv', () => {
  it('reads the four it needs, reusing the ql-auth credentials the standards hop already has', () => {
    expect(sprintNotifierCredentialsFromEnv(FULL_ENV)).toEqual({
      sprintUrl: 'https://sprint.example.com',
      qlAuthUrl: 'https://auth.example.com',
      qlAuthClientId: 'client-id',
      qlAuthClientSecret: 'client-secret',
    });
  });

  it('is undefined when no ql-sprint is configured, which is ordinary rather than an error', () => {
    // A repository can be governed perfectly well by a fleet that runs no ql-sprint. Failing a
    // governance run because nobody is listening in Telegram would be absurd.
    const withoutSprint = { ...FULL_ENV, [SPRINT_URL_VAR]: undefined };

    expect(sprintNotifierCredentialsFromEnv(withoutSprint)).toBeUndefined();
  });

  it('is undefined when ql-sprint is named but the credentials to reach it are not set', () => {
    expect(sprintNotifierCredentialsFromEnv({ QL_SPRINT_URL: 'https://sprint.example.com' })).toBeUndefined();
  });

  it('treats a whitespace-only value as unset', () => {
    expect(sprintNotifierCredentialsFromEnv({ ...FULL_ENV, QL_SPRINT_URL: '   ' })).toBeUndefined();
  });
});

describe('createSprintNotifier', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Answers the token mint, then the notify POST, recording both. */
  function stubFetch(notifyStatus = 200): Array<{ url: string; init?: RequestInit }> {
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
        return Promise.resolve(new Response('{}', { status: notifyStatus }));
      }),
    );
    return calls;
  }

  it('posts the notice to /v1/pipeline/notify with the minted token', async () => {
    const calls = stubFetch();

    await createSprintNotifier(sprintNotifierCredentialsFromEnv(FULL_ENV)!, FULL_ENV)(NOTICE);

    const notify = calls.find((call) => call.url.includes('sprint.example.com'));
    expect(notify?.url).toBe('https://sprint.example.com/v1/pipeline/notify');
    const headers = new Headers(notify?.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer minted-token');
    expect(JSON.parse(readBody(notify?.init))).toMatchObject({ prNumber: 44, verdict: 'awaiting-human' });
  });

  it('does not double the slash when the configured url has a trailing one', async () => {
    const env = { ...FULL_ENV, QL_SPRINT_URL: 'https://sprint.example.com/' };
    const calls = stubFetch();

    await createSprintNotifier(sprintNotifierCredentialsFromEnv(env)!, env)(NOTICE);

    expect(calls.find((call) => call.url.includes('sprint.example'))?.url).toBe(
      'https://sprint.example.com/v1/pipeline/notify',
    );
  });

  it("sends the sprint hop's own edge secret, not another exposure's", async () => {
    // ql-proxy gives every protected exposure a secret of its own, so house's would be refused
    // here exactly as auth's was refused at house's address.
    const env = { ...FULL_ENV, QL_HOUSE_PROXY_TOKEN: 'house-secret', QL_SPRINT_PROXY_TOKEN: 'sprint-secret' };
    const calls = stubFetch();

    await createSprintNotifier(sprintNotifierCredentialsFromEnv(env)!, env)(NOTICE);

    const notify = calls.find((call) => call.url.includes('sprint.example.com'));
    expect(new Headers(notify?.init?.headers).get('x-ql-proxy-token')).toBe('sprint-secret');
  });

  it('works against an unprotected ql-sprint, sending no edge secret at all', async () => {
    const calls = stubFetch();

    await createSprintNotifier(sprintNotifierCredentialsFromEnv(FULL_ENV)!, FULL_ENV)(NOTICE);

    const notify = calls.find((call) => call.url.includes('sprint.example.com'));
    expect(new Headers(notify?.init?.headers).get('x-ql-proxy-token')).toBeNull();
  });

  it('throws when ql-sprint refuses, leaving the caller to decide what that costs', async () => {
    stubFetch(503);

    await expect(createSprintNotifier(sprintNotifierCredentialsFromEnv(FULL_ENV)!, FULL_ENV)(NOTICE)).rejects.toThrow(
      /status 503/,
    );
  });
});
