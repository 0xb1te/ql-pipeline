// @neuron tester.preview.mcpClient

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

interface JsonRpcResponse {
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

export class McpUnreachableError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'McpUnreachableError';
  }
}

export interface McpClientOptions {
  readonly endpoint: string;
  /** Per-call budget. A hung tool must not hold the whole run; the case fails and the rest proceed. */
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;

// @signal createMcpClient
export function createMcpClient(options: McpClientOptions): McpClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;
  let nextId = 1;

  async function rpc(method: string, params: unknown): Promise<unknown> {
    const id = nextId;
    nextId += 1;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let response: Response;
    try {
      response = await doFetch(options.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: controller.signal,
      });
    } catch (cause) {
      throw new McpUnreachableError(
        `${method} could not reach the MCP server at ${options.endpoint}: ${String(cause)}`,
        { cause },
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new McpUnreachableError(`${method} returned HTTP ${String(response.status)} from ${options.endpoint}`);
    }

    const body = (await response.json()) as JsonRpcResponse;
    if (body.error !== undefined) {
      // A JSON-RPC error is the server answering, so it is a result about the feature rather
      // than a transport fault - the caller turns it into a failed case, not an unreachable one.
      throw new Error(`${method} failed: ${body.error.message} (code ${String(body.error.code)})`);
    }
    return body.result;
  }

  return {
    async listTools(): Promise<readonly string[]> {
      const result = (await rpc('tools/list', {})) as { tools?: readonly { name?: unknown }[] } | undefined;
      return (result?.tools ?? [])
        .map((tool) => tool.name)
        .filter((name): name is string => typeof name === 'string');
    },

    async callTool(name: string, args: unknown): Promise<McpToolResult> {
      const result = (await rpc('tools/call', { name, arguments: args })) as
        | { content?: unknown; isError?: unknown }
        | undefined;
      return { content: result?.content ?? result, isError: result?.isError === true };
    },
  };
}
