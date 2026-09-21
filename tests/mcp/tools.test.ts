import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

const { runTool, TOOLS } = await import('../../src/mcp/tools.js');

const REPO = resolve('/repo');

beforeEach(() => {
  spawnMock.mockClear();
});

class FakeChildProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
}

function emitClose(child: FakeChildProcess, exitCode: number, stdout = '', stderr = ''): void {
  if (stdout.length > 0) {
    child.stdout.emit('data', Buffer.from(stdout));
  }
  if (stderr.length > 0) {
    child.stderr.emit('data', Buffer.from(stderr));
  }
  child.emit('close', exitCode);
}

describe('TOOLS', () => {
  // Exact equality on purpose, and kept exact when the list grew from three to seven: adding a
  // tool to an MCP server is a public-API change, and this assertion is what makes it a
  // deliberate act rather than a side effect of an import. Loosening it to a `toContain` would
  // let a tool appear without anyone deciding it should.
  it('lists exactly the maintenance and inspection tools, never gate or govern', () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual([
      'ql_pipeline_doctor',
      'ql_pipeline_init',
      'ql_pipeline_upgrade',
      'ql_pipeline_route',
      'ql_pipeline_gate_reports',
      'ql_pipeline_verdict',
      'ql_pipeline_human_queue',
    ]);
  });

  it('exposes no tool that runs gate or govern', () => {
    const names = TOOLS.map((tool) => tool.name).join(' ');
    expect(names).not.toContain('gate_stage');
    expect(names).not.toContain('govern');
  });

  it('gives every tool a unique name', () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('runTool', () => {
  it('spawns the built CLI\'s doctor command with --root and reports success on exit 0', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const resultPromise = runTool('ql_pipeline_doctor', { root: '/repo' });
    emitClose(child, 0, 'All checks passed.\n');
    const result = await resultPromise;

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['doctor', '--root', REPO]),
      expect.objectContaining({ cwd: REPO }),
    );
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('All checks passed.');
  });

  it('reports isError on a non-zero exit code and includes stderr', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const resultPromise = runTool('ql_pipeline_doctor', { root: REPO });
    emitClose(child, 1, 'Setup is incomplete.\n', 'boom\n');
    const result = await resultPromise;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Setup is incomplete.');
    expect(result.content[0]?.text).toContain('boom');
  });

  it('passes --force through to upgrade only when requested', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const resultPromise = runTool('ql_pipeline_upgrade', { root: REPO, force: true });
    emitClose(child, 0);
    await resultPromise;

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['upgrade', '--root', REPO, '--force']),
      expect.anything(),
    );
  });

  it('defaults root to the current working directory when omitted', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const resultPromise = runTool('ql_pipeline_init', {});
    emitClose(child, 0);
    await resultPromise;

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['init', '--root', process.cwd()]),
      expect.anything(),
    );
  });

  it('reports an error result, not a thrown exception, when the tool name is unknown', async () => {
    const result = await runTool('not_a_real_tool', {});

    expect(result.isError).toBe(true);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('reports an error result when the child process fails to launch at all', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const resultPromise = runTool('ql_pipeline_doctor', { root: REPO });
    child.emit('error', new Error('ENOENT'));
    const result = await resultPromise;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('ENOENT');
  });
});
