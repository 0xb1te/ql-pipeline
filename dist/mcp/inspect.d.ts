import { type GithubClient } from '../shared/github-client.js';
import type * as GovernCommand from '../cli/govern-command.js';
import type { PipelineConfig } from '../shared/types.js';
import type { ToolDescriptor, ToolResult } from './tools.js';
export declare const INSPECT_TOOLS: readonly ToolDescriptor[];
/**
 * `govern`'s own gate-report reader, reached lazily.
 *
 * GR-04 parity says an MCP path calls the same underlying method the CLI calls, so this must be
 * `readGateReports` and not a private re-walk of the directory - its fail-closed answer to a
 * malformed report is behaviour an inspector has to reproduce, not reinvent. But that function
 * lives in `cli/govern-command.ts`, whose import graph reaches the fixer, the reviewer, the
 * standards reader and the house client. Importing it statically would load all of that into
 * every MCP server start, for a reader two of seven tools use - so it is imported when one of
 * them actually runs.
 */
type ReadGateReports = typeof GovernCommand.readGateReports;
/** Injection seams, defaulted to the real thing — the shape `readGateReports` already uses. */
export interface InspectDeps {
    readonly readReports?: ReadGateReports;
    readonly loadPipelineConfig?: (path: string) => PipelineConfig;
    readonly fileExists?: (path: string) => boolean;
    readonly createClient?: (token: string) => Pick<GithubClient, 'listPullRequestsByLabel'>;
    readonly env?: Readonly<Record<string, string | undefined>>;
}
/**
 * Runs one read-only inspection tool, or answers `null` when the name belongs to somebody else —
 * which is what lets `runTool` keep its own switch for the spawning tools untouched.
 */
export declare function runInspectTool(name: string, args: unknown, deps?: InspectDeps): Promise<ToolResult | null>;
export {};
