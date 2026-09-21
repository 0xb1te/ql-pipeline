export interface ToolDescriptor {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Record<string, unknown>;
}
export interface ToolResult {
    readonly content: readonly {
        readonly type: 'text';
        readonly text: string;
    }[];
    readonly isError: boolean;
}
/**
 * Maintenance first, then inspection - the order `tools/list` reports them in, and the order a
 * reader meets them. Adding a tool is meant to be a deliberate act: two exact-equality assertions
 * (tests/mcp/tools.test.ts and tests/mcp/server.test.ts) pin this list by name, and a new entry
 * fails both until it is named there too.
 */
export declare const TOOLS: readonly ToolDescriptor[];
/**
 * Dispatches a tool call: the read-only inspection tools answer in-process (./inspect.ts), and
 * anything left is one of the three maintenance commands, run as a child process of the
 * already-built CLI (`dist/main.js`) exactly as a person at a terminal would.
 *
 * ## The CI-verb carve-out
 *
 * `gate` and `govern` are deliberately not exposed on this server, and the reason is not that
 * they are CI-triggered - it is that they **write**. `govern` merges to the target branch,
 * approves pull requests, posts comments and pushes fix commits; `gate` executes the shell
 * commands named in `gates:`. This repository's own config sets `require_human_approval: true`
 * precisely so that no agent both changes code and merges it, and a tool calling `runGovern`
 * would hand that capability back through another door.
 *
 * What makes the carve-out survivable is that the *reading* half is here: the reason to want
 * `govern` on an MCP was to learn what it would decide, and `ql_pipeline_verdict` answers that
 * without merging anything.
 *
 * Recorded, not assumed: ql-docs GR-04's parity clause admits exactly one exception (secrets),
 * which this is not, and says a capability the CLI has and the MCP lacks is a House `problem`.
 * That conversation is still owed. See docs/features/040-governance-verbs-on-mcp/plan.md.
 */
export declare function runTool(name: string, args: unknown): Promise<ToolResult>;
