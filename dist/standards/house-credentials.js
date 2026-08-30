// @neuron standards.reader.houseCredentials
import { HouseClient } from '@0xb1te/house-client';
import { QlAuthClient } from '@0xb1te/ql-auth-client';
import { HouseStandardsReader } from './house-standards-reader.js';
/**
 * Reads the four environment variables `govern` needs to reach house-api —
 * separate from `createPipelineContext` deliberately: `gate` and the
 * scaffolding commands never touch house-api, so they never have to know
 * these exist or fail because one is unset in an environment that doesn't
 * need it.
 */
// @signal readHouseCredentialsFromEnv
export function readHouseCredentialsFromEnv(env = process.env) {
    const houseApiUrl = env['HOUSE_API_URL'];
    const qlAuthUrl = env['QL_AUTH_URL'];
    const qlAuthClientId = env['QL_AUTH_CLIENT_ID'];
    const qlAuthClientSecret = env['QL_AUTH_CLIENT_SECRET'];
    const missing = [
        ['HOUSE_API_URL', houseApiUrl],
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
    };
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
    const auth = new QlAuthClient({ baseUrl: credentials.qlAuthUrl });
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
    const client = new HouseClient({ baseUrl: credentials.houseApiUrl, token: accessToken });
    return new HouseStandardsReader({ client, workspaceRoot, standardsRoot, projectId });
}
//# sourceMappingURL=house-credentials.js.map