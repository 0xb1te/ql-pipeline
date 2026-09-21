#!/usr/bin/env node
/**
 * Stdio MCP server exposing the maintenance commands (`doctor`/`init`/`upgrade`) and the
 * read-only inspection of a governance run (route, gate reports, verdict, human queue).
 * `gate` and `govern` themselves are not exposed: they write - merge, approve, comment, push,
 * and run configured shell. See the carve-out on `runTool` in ./tools.ts.
 *
 * Newline-delimited JSON-RPC over stdio, hand-rolled rather than pulled
 * from an SDK — the same shape ql-docs's own `apps/house-api/mcp/house-mcp.mjs`
 * uses. Unlike that bridge (and `@0xb1te/ql-kit`'s bridge helper, which the
 * same reasoning ruled out), this one has no HTTP service to forward to:
 * `ql-pipeline` never runs as a resident server, so each tool call spawns
 * the already-built CLI as a child process instead (`tools.ts`) and returns
 * its output and exit status as the call result.
 */
// @neuron mcp.server.server
import { pathToFileURL } from 'node:url';
import { TOOLS, runTool, type ToolResult } from './tools.js';

interface JsonRpcRequest {
  readonly jsonrpc?: string;
  readonly id?: unknown;
  readonly method?: string;
  readonly params?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// @signal dispatch
async function dispatch(method: string | undefined, params: unknown): Promise<unknown> {
  if (method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'ql-pipeline', version: '0.2.0' },
    };
  }

  if (method === 'tools/list') {
    return { tools: TOOLS };
  }

  if (method === 'tools/call') {
    const call = isRecord(params) ? params : {};
    const name = typeof call['name'] === 'string' ? call['name'] : '';
    const result: ToolResult = await runTool(name, call['arguments']);
    return result;
  }

  // Notifications and any other method this server doesn't implement get
  // an empty result rather than an error — an unfamiliar client shouldn't
  // be able to crash the connection just by probing it.
  return {};
}

// @signal main
export function main(stdin: NodeJS.ReadableStream = process.stdin, stdout: NodeJS.WritableStream = process.stdout): void {
  let buffer = '';
  stdin.setEncoding?.('utf-8');
  stdin.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString();
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length === 0) {
        continue;
      }
      void handleLine(line, stdout);
    }
  });
}

// @signal handleLine
async function handleLine(line: string, stdout: NodeJS.WritableStream): Promise<void> {
  let message: JsonRpcRequest;
  try {
    message = JSON.parse(line) as JsonRpcRequest;
  } catch (cause) {
    stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { message: `invalid JSON: ${String(cause)}` } })}\n`);
    return;
  }

  try {
    const result = await dispatch(message.method, message.params);
    stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
  } catch (cause) {
    stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { message: String(cause) } })}\n`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
