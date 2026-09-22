import { type ArgvExecutor } from '../shared/exec.js';
import { type PipelineContext } from './bootstrap.js';
/** The preview host's checkout of ql-proxy, built. A repository variable on the consumer. */
export declare const PROXY_HOME_VAR = "QL_PROXY_HOME";
/** Which ql-proxy.yml the CLI reads on that host. Optional; the CLI has its own default. */
export declare const PROXY_CONFIG_VAR = "QL_PROXY_CONFIG";
/**
 * The token ql-proxy's own `gh pr comment` announces the address with. The workflow passes
 * `github.token` here and never GH_TOKEN, deliberately: ql-proxy's comment carries no automation
 * marker, so it must arrive as github-actions[bot] - which the resolve job declines - rather than
 * as the person GH_TOKEN belongs to, whose comments start another run.
 */
export declare const ANNOUNCE_TOKEN_VAR = "QL_PREVIEW_ANNOUNCE_TOKEN";
/** Read by the devops compose to mount `docs/${QL_TASK_FOLDER}/seed.sql` into the database. */
export declare const TASK_FOLDER_VAR = "QL_TASK_FOLDER";
/** Offered to the devops compose so it can pass the switch through to the application. */
export declare const MCP_ENABLED_VAR = "QL_MCP_ENABLED";
/** The job outputs the workflow reads to decide whether, and where, the tester runs. */
export declare const DEPLOYED_OUTPUT = "deployed";
export declare const URL_OUTPUT = "url";
export declare const PROJECT_OUTPUT = "project";
export declare const MCP_URL_OUTPUT = "mcp-url";
export declare const MCP_READY_OUTPUT = "mcp-ready";
export interface DeployPreviewDeps {
    readonly exec: ArgvExecutor;
    readonly env: NodeJS.ProcessEnv;
    /** Whether the MCP server at this address answers `tools/list`. */
    readonly probeMcp: (endpoint: string) => Promise<boolean>;
    readonly sleep: (ms: number) => Promise<void>;
    readonly now: () => number;
}
export type DeployPreviewOutcome = {
    readonly kind: 'skipped';
    readonly reason: string;
} | {
    readonly kind: 'failed';
    readonly reason: string;
} | {
    readonly kind: 'deployed';
    readonly url: string;
    readonly project: string;
    readonly mcpUrl: string | null;
    readonly mcpReady: boolean;
};
type Context = Pick<PipelineContext, 'config' | 'pr' | 'client' | 'logger' | 'consumerRoot'>;
/**
 * Brings the pull request's preview up and says where it is, as an outcome the caller turns into
 * job outputs.
 *
 * Every dependency that touches the machine - the two processes it spawns, the clock, the MCP
 * probe - is injected, so the whole sequence is testable without ql-proxy, Docker or a network.
 *
 * The decision to deploy is made again here, from the same facts `govern` used, rather than
 * trusted from the job condition. The workflow's `if:` is the gate that saves a runner; this is
 * the gate that refuses to bring a stack up for a repository whose folder is not there.
 */
export declare function deployPreview(ctx: Context, deps: DeployPreviewDeps): Promise<DeployPreviewOutcome>;
/**
 * The `preview` job's command: deploy, then publish what happened as job outputs.
 *
 * A skipped deploy is not a failure - the job condition should have kept this from running, and
 * a second guard that agrees is a quiet exit. A failed one fails the check, because a green pull
 * request that could not be previewed is something a person should hear about on the PR.
 */
export declare function runDeployPreview(): Promise<void>;
export {};
