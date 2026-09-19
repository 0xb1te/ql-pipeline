// @neuron standards.reader.houseCredentials
import { HouseClient } from '@0xb1te/house-client';
import { QlAuthClient, type JwtPayload } from '@0xb1te/ql-auth-client';
import { HouseStandardsReader, type HouseSessionClient } from './house-standards-reader.js';

export interface HouseCredentials {
  readonly houseApiUrl: string;
  readonly qlAuthUrl: string;
  readonly qlAuthClientId: string;
  readonly qlAuthClientSecret: string;
  /**
   * Which variable `houseApiUrl` was actually read from. `HOUSE_API_URL` means
   * this environment is still on the pre-`QL_` name and should migrate.
   *
   * Reported rather than printed: this function stays pure (architecture
   * invariant 1), so the caller owns the deprecation warning.
   */
  readonly houseApiUrlSource: typeof HOUSE_API_URL_VAR | typeof LEGACY_HOUSE_API_URL_VAR;
}

/** The house-api origin variable, under the `QL_` prefix the rest of the suite uses. */
export const HOUSE_API_URL_VAR = 'QL_HOUSE_API_URL';

/**
 * The name this variable had before task 020. Still read, because consumers call
 * the reusable workflow at `@main` and pick up a rename before they have created
 * the new secret - dropping it outright turns every governed repo's check red at
 * its next PR. Remove once consumers have migrated.
 */
export const LEGACY_HOUSE_API_URL_VAR = 'HOUSE_API_URL';

/**
 * Header ql-proxy checks in front of a protected exposure, before the request
 * reaches ql-auth or house-api at all. Matches `expose.protection.header` in
 * the host's `ql-proxy.yml`.
 */
export const PROXY_TOKEN_HEADER = 'X-QL-Proxy-Token';

/** The single-token variable every consumer already sets. */
export const PROXY_TOKEN_VAR = 'QL_PROXY_TOKEN';

/** Per-hop overrides, each taking precedence over `PROXY_TOKEN_VAR` for its own address. */
export const AUTH_PROXY_TOKEN_VAR = 'QL_AUTH_PROXY_TOKEN';
export const HOUSE_PROXY_TOKEN_VAR = 'QL_HOUSE_PROXY_TOKEN';
export const SPRINT_PROXY_TOKEN_VAR = 'QL_SPRINT_PROXY_TOKEN';

/**
 * Which of the protected addresses a request is going to.
 *
 * They are separate addresses, not one. `QL_AUTH_URL`, `QL_HOUSE_API_URL` and
 * `QL_SPRINT_URL` are separate ql-proxy exposures on any host that publishes
 * them separately, and a protected exposure carries a secret *of its own* -
 * ql-proxy generates one per exposure precisely so that a leaked value opens
 * one address rather than every address at once.
 *
 * One token therefore does not open both, and this file used to assume it did:
 * `govern` sent the same `QL_PROXY_TOKEN` to ql-auth and to house-api, so on a
 * host where the two exposures hold different secrets the ql-auth hop was
 * refused at the edge. The error it surfaced was `ql-auth request failed with
 * status 401`, which reads as a bad client id or secret and sends an operator to
 * rotate credentials that were never wrong.
 *
 * Deliberately not solved by pointing both exposures at ql-proxy's host-wide
 * `QL_PROXY_PROTECTION_TOKEN`: that is one key for every address, which is the
 * arrangement per-exposure secrets exist to replace.
 */
export type ProxyHop = 'auth' | 'house' | 'sprint';

const HOP_TOKEN_VAR: Record<ProxyHop, string> = {
  auth: AUTH_PROXY_TOKEN_VAR,
  house: HOUSE_PROXY_TOKEN_VAR,
  // The sprint hop is outbound-only and optional: a fleet that never publishes
  // ql-sprint simply never calls it, and an absent token here means the same as
  // it does for the other two - "nothing in front to satisfy", not "refuse".
  sprint: SPRINT_PROXY_TOKEN_VAR,
};

/**
 * A `fetch` that adds the ql-proxy shared secret to every request, or
 * `undefined` when no secret is configured.
 *
 * This exists because neither `QlAuthClient` nor `HouseClient` takes arbitrary
 * headers — both expose a `fetch` override instead, which is the seam that
 * lets ql-pipeline speak to a protected exposure without either published
 * client having to learn about ql-proxy.
 *
 * Absent means "the exposure is public", not "refuse to run": a self-hosted
 * fleet on a private network has nothing in front of it to satisfy.
 */
// @signal proxyFetchFromEnv
export function proxyFetchFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  hop?: ProxyHop,
): typeof fetch | undefined {
  // The per-hop variable wins and the shared one is the fallback, which is what
  // keeps this backwards compatible: a fleet whose two services sit behind a
  // single exposure - or behind a host-wide secret - sets only QL_PROXY_TOKEN
  // and is unaffected. Omitting the hop is the pre-existing behaviour exactly.
  const token = (hop === undefined ? undefined : present(env[HOP_TOKEN_VAR[hop]])) ?? present(env[PROXY_TOKEN_VAR]);
  if (token === undefined) {
    return undefined;
  }
  return (input, init) => {
    // `new Headers` normalises the plain-object form both clients build, so
    // their Authorization and Content-Type survive rather than being replaced.
    const headers = new Headers(init?.headers);
    headers.set(PROXY_TOKEN_HEADER, token);
    return fetch(input, { ...init, headers });
  };
}

/**
 * Reads the four environment variables `govern` needs to reach house-api —
 * accepting the pre-020 `HOUSE_API_URL` spelling as well as `QL_HOUSE_API_URL` —
 * separate from `createPipelineContext` deliberately: `gate` and the
 * scaffolding commands never touch house-api, so they never have to know
 * these exist or fail because one is unset in an environment that doesn't
 * need it.
 */
// @signal readHouseCredentialsFromEnv
export function readHouseCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): HouseCredentials {
  // The new name wins when both are set, so a half-migrated repo that still
  // carries the old secret moves over the moment the new one is added.
  const prefixed = present(env[HOUSE_API_URL_VAR]);
  const legacy = present(env[LEGACY_HOUSE_API_URL_VAR]);
  const houseApiUrl = prefixed ?? legacy;
  const houseApiUrlSource = prefixed !== undefined ? HOUSE_API_URL_VAR : LEGACY_HOUSE_API_URL_VAR;

  const qlAuthUrl = env['QL_AUTH_URL'];
  const qlAuthClientId = env['QL_AUTH_CLIENT_ID'];
  const qlAuthClientSecret = env['QL_AUTH_CLIENT_SECRET'];

  const missing = [
    // Named under the current spelling: an operator reading this error should
    // create the variable this project asks for now, not the one it accepts.
    [HOUSE_API_URL_VAR, houseApiUrl],
    ['QL_AUTH_URL', qlAuthUrl],
    ['QL_AUTH_CLIENT_ID', qlAuthClientId],
    ['QL_AUTH_CLIENT_SECRET', qlAuthClientSecret],
  ]
    .filter(([, value]) => value === undefined || value.length === 0)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`missing environment variable(s) required to read standards from house-api: ${missing.join(', ')}`);
  }

  return {
    houseApiUrl: houseApiUrl!,
    qlAuthUrl: qlAuthUrl!,
    qlAuthClientId: qlAuthClientId!,
    qlAuthClientSecret: qlAuthClientSecret!,
    houseApiUrlSource,
  };
}

/** Undefined for both unset and empty, so an empty secret is never mistaken for a value. */
function present(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

/**
 * Decodes (never verifies) a JWT's middle segment. No verification is
 * needed here: this is the token this process itself just minted, over an
 * authenticated call to `ql-auth` — not a token arriving from an untrusted
 * caller. Only used to read the `project_id` claim `house-api` requires a
 * session's `projectId` to match exactly.
 */
function decodeJwtPayload(token: string): JwtPayload {
  const segment = token.split('.')[1];
  if (segment === undefined) {
    throw new Error('ql-auth token is not a JWT (missing payload segment)');
  }
  const json = Buffer.from(segment, 'base64url').toString('utf-8');
  return JSON.parse(json) as JwtPayload;
}

/**
 * Mints a `github_agent` client-credentials token from `ql-auth`, decodes
 * its `project_id` claim, and returns a `HouseStandardsReader` authenticated
 * against `house-api` for the rest of this `govern` run.
 */
// @signal createHouseStandardsReader
export async function createHouseStandardsReader(
  credentials: HouseCredentials,
  workspaceRoot: string,
  standardsRoot: string,
): Promise<HouseStandardsReader> {
  // One secret per exposure, so one fetch per hop - see ProxyHop for why sending
  // the same token to both is what made this 401 at the edge.
  const authFetch = proxyFetchFromEnv(process.env, 'auth');
  const houseFetch = proxyFetchFromEnv(process.env, 'house');
  const auth = new QlAuthClient({
    baseUrl: credentials.qlAuthUrl,
    ...(authFetch !== undefined ? { fetch: authFetch } : {}),
  });
  const { access_token: accessToken } = await auth.issueToken({
    grantType: 'client_credentials',
    clientId: credentials.qlAuthClientId,
    clientSecret: credentials.qlAuthClientSecret,
  });

  const projectId = decodeJwtPayload(accessToken).project_id;
  // house-client's generated OpenAPI schema marks every HereResponse field
  // optional (a codegen gap, not something house-api's Java DTOs actually
  // allow — see SessionDtos.java) — cast at this one boundary rather than
  // threading `| undefined` through HouseStandardsReader for fields the
  // real API always sends.
  const client = new HouseClient({
    baseUrl: credentials.houseApiUrl,
    token: accessToken,
    ...(houseFetch !== undefined ? { fetch: houseFetch } : {}),
  }) as unknown as HouseSessionClient;

  return new HouseStandardsReader({ client, workspaceRoot, standardsRoot, projectId });
}
