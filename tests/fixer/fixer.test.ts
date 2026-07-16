import { describe, expect, it, vi } from 'vitest';
import { runFix } from '../../src/fixer/fixer.js';
import type { CursorAgentRunner } from '../../src/reviewer/cursor-runner.js';
import type { CommandExecutor } from '../../src/shared/exec.js';
import type { Finding } from '../../src/shared/types.js';

function finding(): Finding {
  return {
    severity: 'security',
    rule: 'backend.rules#no-string-concat-sql',
    file: 'src/api/payments.ts',
    line: 12,
    problem: 'string-concatenated SQL allows injection',
    suggestedFix: 'use a parameterized query',
    autoFixable: true,
  };
}

const BASE_OPTIONS = {
  cwd: '/repo',
  branch: 'task/007-payments',
  protectedPaths: ['.github/workflows/'],
  attemptNumber: 1,
  maxFixAttempts: 3,
};

function agentThatSucceeds(): CursorAgentRunner {
  return vi.fn<CursorAgentRunner>().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
}

/** A fake `exec` whose `git status --porcelain` response is configurable; every other command just succeeds. */
function fakeExec(options: { dirty?: boolean; failOn?: (command: string) => boolean } = {}): CommandExecutor {
  return vi.fn((command: string) => {
    if (options.failOn?.(command) === true) {
      return Promise.reject(new Error(`simulated failure running: ${command}`));
    }
    if (command.startsWith('git status')) {
      return Promise.resolve({ stdout: options.dirty === false ? '' : ' M src/api/payments.ts\n', stderr: '' });
    }
    return Promise.resolve({ stdout: '', stderr: '' });
  });
}

describe('runFix', () => {
  it('invokes cursor-agent in write-capable "agent" mode, not read-only "ask"', async () => {
    const agentRunner = agentThatSucceeds();

    await runFix([finding()], 'template', 'backend', {
      ...BASE_OPTIONS,
      agentRunner,
      commandExecutor: fakeExec({ dirty: true }),
    });

    expect(agentRunner).toHaveBeenCalledWith(expect.any(String), { cwd: '/repo', mode: 'agent' });
  });

  it('builds the prompt from the template, attempt number, and findings', async () => {
    const agentRunner = agentThatSucceeds();

    await runFix([finding()], 'Attempt {{ATTEMPT_NUMBER}} of {{MAX_ATTEMPTS}}: {{COMPLAINT}}', 'backend', {
      ...BASE_OPTIONS,
      agentRunner,
      commandExecutor: fakeExec({ dirty: true }),
    });

    const promptArg = (agentRunner as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(promptArg).toContain('Attempt 1 of 3');
    expect(promptArg).toContain('backend.rules#no-string-concat-sql');
  });

  it('commits and pushes when the agent leaves real changes behind', async () => {
    const exec = fakeExec({ dirty: true });

    const outcome = await runFix([finding()], 'template', 'backend', {
      ...BASE_OPTIONS,
      agentRunner: agentThatSucceeds(),
      commandExecutor: exec,
    });

    expect(outcome).toEqual({
      kind: 'committed',
      commitMessage: 'fix(backend): resolve pipeline complaint (attempt 1) [bot]',
    });
    expect(exec).toHaveBeenCalledWith('git add -A', { cwd: '/repo' });
    expect(exec).toHaveBeenCalledWith(
      'git commit -m "fix(backend): resolve pipeline complaint (attempt 1) [bot]"',
      { cwd: '/repo' },
    );
    expect(exec).toHaveBeenCalledWith('git push origin HEAD:task/007-payments', { cwd: '/repo' });
  });

  it('reverts protected paths before checking whether anything changed', async () => {
    const order: string[] = [];
    const exec: CommandExecutor = vi.fn((command: string) => {
      if (command.startsWith('git checkout')) order.push('revert');
      if (command.startsWith('git status')) order.push('status-check');
      if (command.startsWith('git add') || command.startsWith('git commit') || command.startsWith('git push')) {
        order.push('commit-or-push');
      }
      return Promise.resolve({ stdout: command.startsWith('git status') ? ' M x\n' : '', stderr: '' });
    });

    await runFix([finding()], 'template', 'backend', {
      ...BASE_OPTIONS,
      agentRunner: agentThatSucceeds(),
      commandExecutor: exec,
    });

    expect(order[0]).toBe('revert');
    expect(order[1]).toBe('status-check');
    expect(order.slice(2)).toEqual(['commit-or-push', 'commit-or-push', 'commit-or-push']);
  });

  it('reports no-changes when nothing is left after the protected-path revert', async () => {
    const outcome = await runFix([finding()], 'template', 'backend', {
      ...BASE_OPTIONS,
      agentRunner: agentThatSucceeds(),
      commandExecutor: fakeExec({ dirty: false }),
    });

    expect(outcome).toEqual({ kind: 'no-changes' });
  });

  it('does not attempt to commit when there is nothing to commit', async () => {
    const exec = fakeExec({ dirty: false });

    await runFix([finding()], 'template', 'backend', {
      ...BASE_OPTIONS,
      agentRunner: agentThatSucceeds(),
      commandExecutor: exec,
    });

    expect(exec).not.toHaveBeenCalledWith('git add -A', expect.anything());
  });

  it('fails immediately when cursor-agent itself exits non-zero, without touching the tree', async () => {
    const agentRunner = vi.fn<CursorAgentRunner>().mockResolvedValue({ stdout: '', stderr: 'boom', exitCode: 1 });
    const exec = fakeExec({ dirty: true });

    const outcome = await runFix([finding()], 'template', 'backend', {
      ...BASE_OPTIONS,
      agentRunner,
      commandExecutor: exec,
    });

    expect(outcome).toEqual({ kind: 'agent-error', reason: 'cursor-agent exited with code 1: boom' });
    expect(exec).not.toHaveBeenCalled();
  });

  it('reports an error when the commit/push step itself fails', async () => {
    const exec = fakeExec({ dirty: true, failOn: (command) => command.startsWith('git push') });

    const outcome = await runFix([finding()], 'template', 'backend', {
      ...BASE_OPTIONS,
      agentRunner: agentThatSucceeds(),
      commandExecutor: exec,
    });

    expect(outcome.kind).toBe('agent-error');
    if (outcome.kind === 'agent-error') {
      expect(outcome.reason).toMatch(/failed to commit\/push/);
    }
  });
});
