import { describe, expect, it, vi } from 'vitest';
import { allGatesPassed, runGates, type CommandExecutor } from '../../src/router/gate-runner.js';
import type { AreaGate } from '../../src/shared/types.js';

describe('runGates', () => {
  it('shells out for real via the default executor when none is injected', async () => {
    // Uses the current Node binary itself rather than a shell builtin
    // (true/false/exit) so this is portable across Windows and POSIX CI.
    const node = JSON.stringify(process.execPath);
    const gates: AreaGate[] = [
      { area: 'backend', build: `${node} -e "process.exit(0)"`, test: `${node} -e "process.exit(1)"` },
    ];

    const outcomes = await runGates(gates, { cwd: process.cwd() });

    expect(outcomes[0]).toEqual({ area: 'backend', gate: 'build', command: gates[0]!.build, passed: true, output: '' });
    expect(outcomes[1]?.gate).toBe('test');
    expect(outcomes[1]?.passed).toBe(false);
    expect(typeof outcomes[1]?.output).toBe('string');
  });

  it('runs build and test for a gate that defines both', async () => {
    const exec = vi.fn<CommandExecutor>().mockResolvedValue({ stdout: 'ok', stderr: '' });
    const gates: AreaGate[] = [{ area: 'frontend', build: 'npm run build', test: 'npm test' }];

    const outcomes = await runGates(gates, { cwd: '/repo', exec });

    expect(exec).toHaveBeenNthCalledWith(1, 'npm run build', { cwd: '/repo' });
    expect(exec).toHaveBeenNthCalledWith(2, 'npm test', { cwd: '/repo' });
    expect(outcomes).toEqual([
      { area: 'frontend', gate: 'build', command: 'npm run build', passed: true, output: 'ok' },
      { area: 'frontend', gate: 'test', command: 'npm test', passed: true, output: 'ok' },
    ]);
  });

  it('skips a gate kind that is not configured for an area', async () => {
    const exec = vi.fn<CommandExecutor>().mockResolvedValue({ stdout: '', stderr: '' });
    const gates: AreaGate[] = [{ area: 'docs', build: 'true' }];

    const outcomes = await runGates(gates, { cwd: '/repo', exec });

    expect(exec).toHaveBeenCalledTimes(1);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.gate).toBe('build');
  });

  it('produces no outcomes for an area with no gate commands at all', async () => {
    const exec = vi.fn<CommandExecutor>();
    const gates: AreaGate[] = [{ area: 'docs' }];

    const outcomes = await runGates(gates, { cwd: '/repo', exec });

    expect(exec).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
  });

  it('runs multiple areas in order, sequentially rather than concurrently', async () => {
    const started: string[] = [];
    const exec = vi.fn<CommandExecutor>(async (command) => {
      started.push(command);
      // If calls were concurrent, the second call could start before the
      // first resolves; awaiting a delay here would surface that as
      // out-of-order entries in `started`.
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { stdout: command, stderr: '' };
    });
    const gates: AreaGate[] = [
      { area: 'frontend', build: 'cmd-a' },
      { area: 'backend', build: 'cmd-b' },
    ];

    await runGates(gates, { cwd: '/repo', exec });

    expect(started).toEqual(['cmd-a', 'cmd-b']);
  });

  it('marks a gate failed and captures stdout+stderr when the command rejects with an exec-shaped error', async () => {
    const exec = vi.fn<CommandExecutor>().mockRejectedValue({ stdout: 'partial output', stderr: 'boom' });
    const gates: AreaGate[] = [{ area: 'backend', test: 'npm test' }];

    const outcomes = await runGates(gates, { cwd: '/repo', exec });

    expect(outcomes).toEqual([
      { area: 'backend', gate: 'test', command: 'npm test', passed: false, output: 'partial outputboom' },
    ]);
  });

  it('falls back to String(cause) when the rejection is not exec-shaped', async () => {
    const exec = vi.fn<CommandExecutor>().mockRejectedValue(new Error('spawn failed'));
    const gates: AreaGate[] = [{ area: 'backend', build: 'npm run build' }];

    const outcomes = await runGates(gates, { cwd: '/repo', exec });

    expect(outcomes[0]?.passed).toBe(false);
    expect(outcomes[0]?.output).toContain('spawn failed');
  });

  it('falls back to String(cause) when the rejection is not an object at all', async () => {
    const exec = vi.fn<CommandExecutor>().mockRejectedValue('rejected as a plain string');
    const gates: AreaGate[] = [{ area: 'backend', build: 'npm run build' }];

    const outcomes = await runGates(gates, { cwd: '/repo', exec });

    expect(outcomes[0]?.passed).toBe(false);
    expect(outcomes[0]?.output).toBe('rejected as a plain string');
  });
});

describe('allGatesPassed', () => {
  it('is true when every outcome passed', () => {
    expect(
      allGatesPassed([
        { area: 'frontend', gate: 'build', command: 'x', passed: true, output: '' },
        { area: 'frontend', gate: 'test', command: 'y', passed: true, output: '' },
      ]),
    ).toBe(true);
  });

  it('is false when any outcome failed', () => {
    expect(
      allGatesPassed([
        { area: 'frontend', gate: 'build', command: 'x', passed: true, output: '' },
        { area: 'frontend', gate: 'test', command: 'y', passed: false, output: 'error' },
      ]),
    ).toBe(false);
  });

  it('is vacuously true for no gates', () => {
    expect(allGatesPassed([])).toBe(true);
  });
});
