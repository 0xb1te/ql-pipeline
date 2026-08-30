import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHouseStandardsReader, readHouseCredentialsFromEnv } from '../../src/standards/house-credentials.js';

const FULL_ENV = {
  HOUSE_API_URL: 'https://house.example.com',
  QL_AUTH_URL: 'https://auth.example.com',
  QL_AUTH_CLIENT_ID: 'client-id',
  QL_AUTH_CLIENT_SECRET: 'client-secret',
};

describe('readHouseCredentialsFromEnv', () => {
  it('reads all four variables when every one is set', () => {
    expect(readHouseCredentialsFromEnv(FULL_ENV)).toEqual({
      houseApiUrl: FULL_ENV.HOUSE_API_URL,
      qlAuthUrl: FULL_ENV.QL_AUTH_URL,
      qlAuthClientId: FULL_ENV.QL_AUTH_CLIENT_ID,
      qlAuthClientSecret: FULL_ENV.QL_AUTH_CLIENT_SECRET,
    });
  });

  it('names every missing variable at once, not just the first', () => {
    expect(() => readHouseCredentialsFromEnv({ HOUSE_API_URL: FULL_ENV.HOUSE_API_URL })).toThrow(
      /QL_AUTH_URL.*QL_AUTH_CLIENT_ID.*QL_AUTH_CLIENT_SECRET/,
    );
  });

  it('treats an empty string the same as unset', () => {
    expect(() => readHouseCredentialsFromEnv({ ...FULL_ENV, QL_AUTH_CLIENT_SECRET: '' })).toThrow(
      /QL_AUTH_CLIENT_SECRET/,
    );
  });

  it('fails closed with none set at all', () => {
    expect(() => readHouseCredentialsFromEnv({})).toThrow(/HOUSE_API_URL/);
  });
});

/** An unsigned-but-well-formed JWT: enough for decode-only code that never verifies a signature. */
function fakeJwt(payload: Record<string, unknown>): string {
  const part = (data: unknown): string => Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${part({ alg: 'none' })}.${part(payload)}.`;
}

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
