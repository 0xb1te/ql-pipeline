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
