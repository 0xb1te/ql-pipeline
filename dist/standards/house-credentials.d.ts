import { HouseStandardsReader } from './house-standards-reader.js';
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
export declare const HOUSE_API_URL_VAR = "QL_HOUSE_API_URL";
/**
 * The name this variable had before task 020. Still read, because consumers call
 * the reusable workflow at `@main` and pick up a rename before they have created
 * the new secret - dropping it outright turns every governed repo's check red at
 * its next PR. Remove once consumers have migrated.
 */
export declare const LEGACY_HOUSE_API_URL_VAR = "HOUSE_API_URL";
/**
 * Header ql-proxy checks in front of a protected exposure, before the request
 * reaches ql-auth or house-api at all. Matches `expose.protection.header` in
 * the host's `ql-proxy.yml`.
 */
export declare const PROXY_TOKEN_HEADER = "X-QL-Proxy-Token";
/** The single-token variable every consumer already sets. */
export declare const PROXY_TOKEN_VAR = "QL_PROXY_TOKEN";
/** Per-hop overrides, each taking precedence over `PROXY_TOKEN_VAR` for its own address. */
export declare const AUTH_PROXY_TOKEN_VAR = "QL_AUTH_PROXY_TOKEN";
export declare const HOUSE_PROXY_TOKEN_VAR = "QL_HOUSE_PROXY_TOKEN";
export declare const SPRINT_PROXY_TOKEN_VAR = "QL_SPRINT_PROXY_TOKEN";
export declare const AGENTS_PROXY_TOKEN_VAR = "QL_AGENTS_PROXY_TOKEN";
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
export type ProxyHop = 'auth' | 'house' | 'sprint' | 'agents';
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
export declare function proxyFetchFromEnv(env?: NodeJS.ProcessEnv, hop?: ProxyHop): typeof fetch | undefined;
/**
 * Reads the four environment variables `govern` needs to reach house-api —
 * accepting the pre-020 `HOUSE_API_URL` spelling as well as `QL_HOUSE_API_URL` —
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
