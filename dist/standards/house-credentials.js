// @neuron standards.reader.houseCredentials
import { HouseClient } from '@0xb1te/house-client';
import { QlAuthClient } from '@0xb1te/ql-auth-client';
import { HouseStandardsReader } from './house-standards-reader.js';
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
export function proxyFetchFromEnv(env = process.env) {
    const token = env['QL_PROXY_TOKEN'];
    if (token === undefined || token.length === 0) {
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
export function readHouseCredentialsFromEnv(env = process.env) {
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
        houseApiUrl: houseApiUrl,
        qlAuthUrl: qlAuthUrl,
        qlAuthClientId: qlAuthClientId,
        qlAuthClientSecret: qlAuthClientSecret,
        houseApiUrlSource,
    };
}
/** Undefined for both unset and empty, so an empty secret is never mistaken for a value. */
function present(value) {
    return value === undefined || value.length === 0 ? undefined : value;
}
/**
 * Decodes (never verifies) a JWT's middle segment. No verification is
 * needed here: this is the token this process itself just minted, over an
 * authenticated call to `ql-auth` — not a token arriving from an untrusted
 * caller. Only used to read the `project_id` claim `house-api` requires a
 * session's `projectId` to match exactly.
 */
function decodeJwtPayload(token) {
    const segment = token.split('.')[1];
    if (segment === undefined) {
        throw new Error('ql-auth token is not a JWT (missing payload segment)');
    }
    const json = Buffer.from(segment, 'base64url').toString('utf-8');
    return JSON.parse(json);
}
/**
 * Mints a `github_agent` client-credentials token from `ql-auth`, decodes
 * its `project_id` claim, and returns a `HouseStandardsReader` authenticated
 * against `house-api` for the rest of this `govern` run.
 */
// @signal createHouseStandardsReader
export async function createHouseStandardsReader(credentials, workspaceRoot, standardsRoot) {
    // Both hops go through the same exposure, so both carry the same secret.
    const proxyFetch = proxyFetchFromEnv();
    const auth = new QlAuthClient({
        baseUrl: credentials.qlAuthUrl,
        ...(proxyFetch !== undefined ? { fetch: proxyFetch } : {}),
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
        ...(proxyFetch !== undefined ? { fetch: proxyFetch } : {}),
    });
    return new HouseStandardsReader({ client, workspaceRoot, standardsRoot, projectId });
}
//# sourceMappingURL=house-credentials.js.map