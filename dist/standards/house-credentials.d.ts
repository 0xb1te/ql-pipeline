import { HouseStandardsReader } from './house-standards-reader.js';
export interface HouseCredentials {
    readonly houseApiUrl: string;
    readonly qlAuthUrl: string;
    readonly qlAuthClientId: string;
    readonly qlAuthClientSecret: string;
}
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
