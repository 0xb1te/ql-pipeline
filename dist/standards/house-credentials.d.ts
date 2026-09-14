import { HouseStandardsReader } from './house-standards-reader.js';
export interface HouseCredentials {
    readonly houseApiUrl: string;
    readonly qlAuthUrl: string;
    readonly qlAuthClientId: string;
    readonly qlAuthClientSecret: string;
}
/**
 * Header ql-proxy checks in front of a protected exposure, before the request
 * reaches ql-auth or house-api at all. Matches `expose.protection.header` in
 * the host's `ql-proxy.yml`.
 */
export declare const PROXY_TOKEN_HEADER = "X-QL-Proxy-Token";
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
export declare function proxyFetchFromEnv(env?: NodeJS.ProcessEnv): typeof fetch | undefined;
/**
 * Reads the four environment variables `govern` needs to reach house-api —
 * separate from `createPipelineContext` deliberately: `gate` and the
 * scaffolding commands never touch house-api, so they never have to know
 * these exist or fail because one is unset in an environment that doesn't
 * need it.
 */
export declare function readHouseCredentialsFromEnv(env?: NodeJS.ProcessEnv): HouseCredentials;
/**
 * Mints a `github_agent` client-credentials token from `ql-auth`, decodes
 * its `project_id` claim, and returns a `HouseStandardsReader` authenticated
 * against `house-api` for the rest of this `govern` run.
 */
export declare function createHouseStandardsReader(credentials: HouseCredentials, workspaceRoot: string, standardsRoot: string): Promise<HouseStandardsReader>;
