import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROXY_TOKEN_HEADER,
  createHouseStandardsReader,
  proxyFetchFromEnv,
  readHouseCredentialsFromEnv,
} from '../../src/standards/house-credentials.js';

const FULL_ENV = {
  QL_HOUSE_API_URL: 'https://house.example.com',
  QL_AUTH_URL: 'https://auth.example.com',
  QL_AUTH_CLIENT_ID: 'client-id',
  QL_AUTH_CLIENT_SECRET: 'client-secret',
};

/** The same environment on the pre-020 spelling of the house-api origin. */
const LEGACY_ENV = {
  HOUSE_API_URL: FULL_ENV.QL_HOUSE_API_URL,
  QL_AUTH_URL: FULL_ENV.QL_AUTH_URL,
  QL_AUTH_CLIENT_ID: FULL_ENV.QL_AUTH_CLIENT_ID,
  QL_AUTH_CLIENT_SECRET: FULL_ENV.QL_AUTH_CLIENT_SECRET,
};

describe('readHouseCredentialsFromEnv', () => {
  it('reads all four variables when every one is set', () => {
    expect(readHouseCredentialsFromEnv(FULL_ENV)).toEqual({
      houseApiUrl: FULL_ENV.QL_HOUSE_API_URL,
      qlAuthUrl: FULL_ENV.QL_AUTH_URL,
      qlAuthClientId: FULL_ENV.QL_AUTH_CLIENT_ID,
      qlAuthClientSecret: FULL_ENV.QL_AUTH_CLIENT_SECRET,
      houseApiUrlSource: 'QL_HOUSE_API_URL',
    });
  });

  it('names every missing variable at once, not just the first', () => {
    expect(() => readHouseCredentialsFromEnv({ QL_HOUSE_API_URL: FULL_ENV.QL_HOUSE_API_URL })).toThrow(
      /QL_AUTH_URL.*QL_AUTH_CLIENT_ID.*QL_AUTH_CLIENT_SECRET/,
    );
  });

  it('treats an empty string the same as unset', () => {
    expect(() => readHouseCredentialsFromEnv({ ...FULL_ENV, QL_AUTH_CLIENT_SECRET: '' })).toThrow(
      /QL_AUTH_CLIENT_SECRET/,
    );
  });

  it('fails closed with none set at all', () => {
    expect(() => readHouseCredentialsFromEnv({})).toThrow(/QL_HOUSE_API_URL/);
  });

  // Task 020. A consumer picks the reusable workflow up at @main, so it sees
  // the rename before it has created the new secret. These four cases are the
  // whole migration contract.
  it('still accepts the pre-020 HOUSE_API_URL, and says that is where it came from', () => {
    expect(readHouseCredentialsFromEnv(LEGACY_ENV)).toEqual({
      houseApiUrl: FULL_ENV.QL_HOUSE_API_URL,
      qlAuthUrl: FULL_ENV.QL_AUTH_URL,
      qlAuthClientId: FULL_ENV.QL_AUTH_CLIENT_ID,
      qlAuthClientSecret: FULL_ENV.QL_AUTH_CLIENT_SECRET,
      houseApiUrlSource: 'HOUSE_API_URL',
    });
  });

  it('prefers the prefixed name when a half-migrated repo carries both', () => {
    const both = { ...LEGACY_ENV, QL_HOUSE_API_URL: 'https://prefixed.example.com' };
    expect(readHouseCredentialsFromEnv(both)).toMatchObject({
      houseApiUrl: 'https://prefixed.example.com',
      houseApiUrlSource: 'QL_HOUSE_API_URL',
    });
  });

  it('falls back when the prefixed name is set but empty, rather than reading an empty origin', () => {
    const both = { ...LEGACY_ENV, QL_HOUSE_API_URL: '' };
    expect(readHouseCredentialsFromEnv(both)).toMatchObject({
      houseApiUrl: FULL_ENV.QL_HOUSE_API_URL,
      houseApiUrlSource: 'HOUSE_API_URL',
    });
  });

  it('names the current spelling when neither is set, not the deprecated one', () => {
    const neither = { QL_AUTH_URL: FULL_ENV.QL_AUTH_URL };
    expect(() => readHouseCredentialsFromEnv(neither)).toThrow(/QL_HOUSE_API_URL/);
  });
});

/** An unsigned-but-well-formed JWT: enough for decode-only code that never verifies a signature. */
function fakeJwt(payload: Record<string, unknown>): string {
  const part = (data: unknown): string => Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${part({ alg: 'none' })}.${part(payload)}.`;
}

describe('proxyFetchFromEnv', () => {
  it('is undefined when no proxy token is set, so a public exposure still works', () => {
    expect(proxyFetchFromEnv({})).toBeUndefined();
  });

  it('treats an empty token the same as unset', () => {
    expect(proxyFetchFromEnv({ QL_PROXY_TOKEN: '' })).toBeUndefined();
  });

  it('sends the shared secret in the header ql-proxy checks', async () => {
    const seen: Array<Record<string, string>> = [];
    const spy = vi.fn((_input: unknown, init?: RequestInit) => {
      seen.push(Object.fromEntries(new Headers(init?.headers).entries()));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', spy);

    const proxied = proxyFetchFromEnv({ QL_PROXY_TOKEN: 'shared-secret' })!;
    await proxied('https://house.example.com/v1/x');

    expect(seen[0]?.[PROXY_TOKEN_HEADER.toLowerCase()]).toBe('shared-secret');
  });

  it('adds the header without dropping the ones the clients already set', async () => {
    const seen: Array<Record<string, string>> = [];
    const spy = vi.fn((_input: unknown, init?: RequestInit) => {
      seen.push(Object.fromEntries(new Headers(init?.headers).entries()));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', spy);

    const proxied = proxyFetchFromEnv({ QL_PROXY_TOKEN: 'shared-secret' })!;
    // The plain-object shape both published clients build.
    await proxied('https://auth.example.com/v1/token', {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: 'Bearer jwt', 'Content-Type': 'application/json' },
    });

    const headers = seen[0] ?? {};
    expect(headers['authorization']).toBe('Bearer jwt');
    expect(headers['content-type']).toBe('application/json');
    expect(headers['accept']).toBe('application/json');
    expect(headers[PROXY_TOKEN_HEADER.toLowerCase()]).toBe('shared-secret');
  });
});

describe('proxyFetchFromEnv, per hop', () => {
  const HEADER = PROXY_TOKEN_HEADER.toLowerCase();

  function capture(): Array<Record<string, string>> {
    const seen: Array<Record<string, string>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: unknown, init?: RequestInit) => {
        seen.push(Object.fromEntries(new Headers(init?.headers).entries()));
        return Promise.resolve(new Response('{}', { status: 200 }));
      }),
    );
    return seen;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gives each hop its own secret, because each exposure has one of its own', async () => {
    // The bug this pins: ql-auth and house-api are separate ql-proxy exposures
    // holding separate secrets, so one token sent to both is refused by one of
    // them - surfaced as a 401 that reads like bad client credentials.
    const env = {
      QL_AUTH_PROXY_TOKEN: 'auth-secret',
      QL_HOUSE_PROXY_TOKEN: 'house-secret',
    };
    const seen = capture();

    await proxyFetchFromEnv(env, 'auth')!('https://auth.example.com/v1/token');
    await proxyFetchFromEnv(env, 'house')!('https://house.example.com/v1/here');

    expect(seen[0]?.[HEADER]).toBe('auth-secret');
    expect(seen[1]?.[HEADER]).toBe('house-secret');
  });

  it('gives the sprint hop a secret of its own too, alongside the other two', async () => {
    // ql-sprint is a third exposure, published separately from ql-auth and house-api, so it holds
    // a third secret. Sending house's to it would be refused at the edge for the same reason
    // sending auth's to house was.
    const env = {
      QL_AUTH_PROXY_TOKEN: 'auth-secret',
      QL_HOUSE_PROXY_TOKEN: 'house-secret',
      QL_SPRINT_PROXY_TOKEN: 'sprint-secret',
    };
    const seen = capture();

    await proxyFetchFromEnv(env, 'sprint')!('https://sprint.example.com/v1/pipeline/notify');

    expect(seen[0]?.[HEADER]).toBe('sprint-secret');
  });

  it('leaves the sprint hop unconfigured when only the other two are set', () => {
    // A fleet that governs pull requests but never publishes ql-sprint sets no sprint token, and
    // must not have house's silently sent to an address it does not belong to.
    const seen = capture();
    const env = { QL_AUTH_PROXY_TOKEN: 'auth-secret', QL_HOUSE_PROXY_TOKEN: 'house-secret' };

    expect(proxyFetchFromEnv(env, 'sprint')).toBeUndefined();
    expect(seen).toHaveLength(0);
  });

  it('falls back to the shared token, so a single-exposure fleet is untouched', async () => {
    const seen = capture();

    await proxyFetchFromEnv({ QL_PROXY_TOKEN: 'shared-secret' }, 'auth')!('https://auth.example.com/v1/token');

    expect(seen[0]?.[HEADER]).toBe('shared-secret');
  });

  it('lets one hop be overridden while the other keeps the shared token', async () => {
    // The migration state: an operator adds the secret for the hop that was
    // failing and leaves the one that already worked alone.
    const env = { QL_PROXY_TOKEN: 'shared-secret', QL_AUTH_PROXY_TOKEN: 'auth-secret' };
    const seen = capture();

    await proxyFetchFromEnv(env, 'auth')!('https://auth.example.com/v1/token');
    await proxyFetchFromEnv(env, 'house')!('https://house.example.com/v1/here');

    expect(seen[0]?.[HEADER]).toBe('auth-secret');
    expect(seen[1]?.[HEADER]).toBe('shared-secret');
  });

  it('treats an empty per-hop override as unset rather than as a secret', async () => {
    // An unset GitHub secret interpolates to the empty string, so this is the
    // ordinary shape of "not configured" and must not blank out the fallback.
    const seen = capture();

    await proxyFetchFromEnv({ QL_PROXY_TOKEN: 'shared-secret', QL_AUTH_PROXY_TOKEN: '' }, 'auth')!(
      'https://auth.example.com/v1/token',
    );

    expect(seen[0]?.[HEADER]).toBe('shared-secret');
  });

  it('is undefined when neither the hop nor the shared variable is set', () => {
    expect(proxyFetchFromEnv({}, 'auth')).toBeUndefined();
    expect(proxyFetchFromEnv({ QL_AUTH_PROXY_TOKEN: '' }, 'house')).toBeUndefined();
  });
});

describe('createHouseStandardsReader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mints a token from ql-auth, decodes project_id from it, and hands house-api that project_id', async () => {
    const token = fakeJwt({ sub: 'agent-1', authority: 'github_agent', project_id: 'proj-from-jwt', suite_id: 'suite-1', routes: [], iat: 0, exp: 0, jti: 'j1' });
    // Typed narrower than `typeof fetch` on purpose: both real clients this
    // test drives (QlAuthClient, HouseClient) only ever call fetch with a
    // plain string URL, never a URL or Request object.
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/v1/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: 3600 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      throw new Error(`unexpected fetch in this test: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const reader = await createHouseStandardsReader(
      {
        houseApiUrl: 'https://house.example.com',
        qlAuthUrl: 'https://auth.example.com',
        qlAuthClientId: 'client-id',
        qlAuthClientSecret: 'client-secret',
        houseApiUrlSource: 'QL_HOUSE_API_URL',
      },
      '/workspace',
      '.standards',
    );

    // The reader is wired with the decoded project_id; prove it by making a
    // real (mocked) house-api call and inspecting the request body it sent.
    const houseCallBody = await new Promise<string>((resolve) => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (url.endsWith('/v1/sessions')) {
          resolve(typeof init?.body === 'string' ? init.body : '');
          return Promise.resolve(
            new Response(
              JSON.stringify({ sessionId: 's1', cursor: 'workflow/rules/stage-5-frontend/checklist.md', body: 'FE', children: [], next: [] }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        throw new Error(`unexpected fetch in this test: ${url}`);
      });
      void reader.exists('/workspace/.standards/workflow/rules/stage-5-frontend/checklist.md');
    });

    expect(JSON.parse(houseCallBody)).toMatchObject({ projectId: 'proj-from-jwt' });
  });
});
