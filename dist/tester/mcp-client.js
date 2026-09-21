// @neuron tester.preview.mcpClient
export class McpUnreachableError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'McpUnreachableError';
    }
}
const DEFAULT_TIMEOUT_MS = 30_000;
// @signal createMcpClient
export function createMcpClient(options) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const doFetch = options.fetchImpl ?? fetch;
    let nextId = 1;
    async function rpc(method, params) {
        const id = nextId;
        nextId += 1;
        const controller = new AbortController();
        const timer = setTimeout(() => {
            controller.abort();
        }, timeoutMs);
        let response;
        try {
            response = await doFetch(options.endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json', accept: 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
                signal: controller.signal,
            });
        }
        catch (cause) {
            throw new McpUnreachableError(`${method} could not reach the MCP server at ${options.endpoint}: ${String(cause)}`, { cause });
        }
        finally {
            clearTimeout(timer);
        }
        if (!response.ok) {
            throw new McpUnreachableError(`${method} returned HTTP ${String(response.status)} from ${options.endpoint}`);
        }
        const body = (await response.json());
        if (body.error !== undefined) {
            // A JSON-RPC error is the server answering, so it is a result about the feature rather
            // than a transport fault - the caller turns it into a failed case, not an unreachable one.
            throw new Error(`${method} failed: ${body.error.message} (code ${String(body.error.code)})`);
        }
        return body.result;
    }
    return {
        async listTools() {
            const result = (await rpc('tools/list', {}));
            return (result?.tools ?? [])
                .map((tool) => tool.name)
                .filter((name) => typeof name === 'string');
        },
        async callTool(name, args) {
            const result = (await rpc('tools/call', { name, arguments: args }));
            return { content: result?.content ?? result, isError: result?.isError === true };
        },
    };
}
//# sourceMappingURL=mcp-client.js.map