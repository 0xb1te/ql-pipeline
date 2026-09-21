/**
 * A JSON-RPC client for the application MCP server a preview stack booted.
 *
 * Reached over the **internal compose network**, never the public edge. That is the security
 * boundary the whole design rests on: the preview URL's only lock is a gate token meant for
 * showing somebody a demo, and this surface can manage everything the application can, including
 * its users. The tester job runs on the same host for exactly this reason, so nothing about
 * automated testing ever needs a public route. See ql-docs `workflow/flows/app-mcp-surface.md`.
 *
 * Hand-rolled for the same reason the xlsx reader is: two JSON-RPC methods - `tools/list` and
 * `tools/call` - do not justify a dependency in a repository that has four.
 */
export interface McpToolResult {
    /** Whatever the tool returned, as the server sent it. */
    readonly content: unknown;
    /** The server's own `isError` flag: a tool that ran and refused, rather than a transport fault. */
    readonly isError: boolean;
}
export interface McpClient {
    listTools(): Promise<readonly string[]>;
    callTool(name: string, args: unknown): Promise<McpToolResult>;
}
export declare class McpUnreachableError extends Error {
    constructor(message: string, options?: {
        readonly cause?: unknown;
    });
}
export interface McpClientOptions {
    readonly endpoint: string;
    /** Per-call budget. A hung tool must not hold the whole run; the case fails and the rest proceed. */
    readonly timeoutMs?: number;
    readonly fetchImpl?: typeof fetch;
}
export declare function createMcpClient(options: McpClientOptions): McpClient;
