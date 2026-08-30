import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const { runToolMock } = vi.hoisted(() => ({ runToolMock: vi.fn() }));
vi.mock('../../src/mcp/tools.js', async () => {
  const actual = await import('../../src/mcp/tools.js');
  return { ...actual, runTool: runToolMock, TOOLS: actual.TOOLS };
});

const { main } = await import('../../src/mcp/server.js');

class FakeStdin extends EventEmitter {
  setEncoding(): void {
    // no-op: the fake always deals in strings already
  }
}

/** Drives one JSON-RPC request through `main`'s stdio loop and captures the single response line written back. */
async function send(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  const stdin = new FakeStdin();
  const written: string[] = [];
  const stdout = { write: (chunk: string): boolean => (written.push(chunk), true) };

  main(stdin as unknown as NodeJS.ReadableStream, stdout as unknown as NodeJS.WritableStream);
  stdin.emit('data', `${JSON.stringify(request)}\n`);

  // The handler is async (awaits runTool); give its microtask a turn.
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(written).toHaveLength(1);
  return JSON.parse(written[0]!.trim()) as Record<string, unknown>;
}

describe('MCP server dispatch', () => {
  it('answers initialize with a protocol version and server info', async () => {
    const response = await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

    expect(response['id']).toBe(1);
    expect(response['result']).toMatchObject({ serverInfo: { name: 'ql-pipeline' } });
  });

  it('lists exactly the three maintenance tools on tools/list', async () => {
    const response = await send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

    const result = response['result'] as { tools: { name: string }[] };
    expect(result.tools.map((t) => t.name)).toEqual(['ql_pipeline_doctor', 'ql_pipeline_init', 'ql_pipeline_upgrade']);
  });

  it('forwards tools/call to runTool with the call\'s name and arguments', async () => {
    runToolMock.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false });

    const response = await send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'ql_pipeline_doctor', arguments: { root: '/repo' } },
    });

    expect(runToolMock).toHaveBeenCalledWith('ql_pipeline_doctor', { root: '/repo' });
    expect(response['result']).toEqual({ content: [{ type: 'text', text: 'ok' }], isError: false });
  });

  it('returns a JSON-RPC error rather than crashing when a line is not valid JSON', async () => {
    const stdin = new FakeStdin();
    const written: string[] = [];
    const stdout = { write: (chunk: string): boolean => (written.push(chunk), true) };
    main(stdin as unknown as NodeJS.ReadableStream, stdout as unknown as NodeJS.WritableStream);

    stdin.emit('data', 'not json at all\n');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const response = JSON.parse(written[0]!.trim()) as Record<string, unknown>;
    expect(response['error']).toBeDefined();
  });

  it('answers an unrecognized method with an empty result instead of an error', async () => {
    const response = await send({ jsonrpc: '2.0', id: 4, method: 'notifications/whatever', params: {} });

    expect(response['result']).toEqual({});
  });
});
