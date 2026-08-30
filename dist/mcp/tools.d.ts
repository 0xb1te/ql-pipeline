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
export declare const TOOLS: readonly ToolDescriptor[];
/**
 * Runs one of the three maintenance commands as a child process of the
 * already-built CLI (`dist/main.js`), exactly as a person at a terminal
 * would — this MCP server has no in-process code path for `doctor`/`init`/
 * `upgrade` of its own. `gate`/`govern` are deliberately not exposed here:
 * they are CI-triggered, not maintenance actions an agent should invoke
 * ad hoc.
 */
export declare function runTool(name: string, args: unknown): Promise<ToolResult>;
