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

/**
 * A fake `exec` that walks a scripted sequence of `git status --porcelain`
 * responses — the fixer snapshots the tree before and after the agent runs,
 * so a realistic fake has to return different output for each call. The
 * last entry is reused if more calls arrive. Every other command succeeds.
 */
function fakeExec(
  options: { statuses?: string[]; failOn?: (command: string) => boolean } = {},
): CommandExecutor {
  const statuses = options.statuses ?? [];
  let statusCall = 0;

  return vi.fn((command: string) => {
    if (options.failOn?.(command) === true) {
      return Promise.reject(new Error(`simulated failure running: ${command}`));
    }
    if (command.startsWith('git status')) {
      const stdout = statuses[Math.min(statusCall, statuses.length - 1)] ?? '';
      statusCall += 1;
      return Promise.resolve({ stdout, stderr: '' });
    }
    return Promise.resolve({ stdout: '', stderr: '' });
  });
}

/** Baseline dirty from the gates, then the agent's edit on top of it. */
const AGENT_MADE_A_CHANGE = ['?? dist/\n', '?? dist/\n M src/api/payments.ts\n'];

/** The gates left artifacts, but the agent changed nothing of its own. */
const AGENT_MADE_NO_CHANGE = ['?? dist/\n', '?? dist/\n'];

describe('runFix', () => {
  it('invokes cursor-agent in write-capable "agent" mode, not read-only "ask"', async () => {
    const agentRunner = agentThatSucceeds();

    await runFix([finding()], 'template', 'backend', {
      ...BASE_OPTIONS,
      agentRunner,
      commandExecutor: fakeExec({ statuses: AGENT_MADE_A_CHANGE }),
    });

    expect(agentRunner).toHaveBeenCalledWith(expect.any(String), { cwd: '/repo', mode: 'agent' });
  });

  it('forwards a configured Cursor model to the agent runner', async () => {
    const agentRunner = agentThatSucceeds();

    await runFix([finding()], 'template', 'backend', {
      ...BASE_OPTIONS,
      model: 'cursor-grok-4.6-xhigh-fast',
      agentRunner,
      commandExecutor: fakeExec({ statuses: AGENT_MADE_A_CHANGE }),
    });

    expect(agentRunner).toHaveBeenCalledWith(expect.any(String), {
      cwd: '/repo',
      mode: 'agent',
      model: 'cursor-grok-4.6-xhigh-fast',
    });
  });

  it('builds the prompt from the template, attempt number, and findings', async () => {
    const agentRunner = agentThatSucceeds();

    await runFix([finding()], 'Attempt {{ATTEMPT_NUMBER}} of {{MAX_ATTEMPTS}}: {{COMPLAINT}}', 'backend', {
      ...BASE_OPTIONS,
      agentRunner,
      commandExecutor: fakeExec({ statuses: AGENT_MADE_A_CHANGE }),
    });

    const promptArg = (agentRunner as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(promptArg).toContain('Attempt 1 of 3');
    expect(promptArg).toContain('backend.rules#no-string-concat-sql');
  });

  it('commits and pushes when the agent leaves real changes behind', async () => {
    const exec = fakeExec({ statuses: AGENT_MADE_A_CHANGE });

    const outcome = await runFix([finding()], 'template', 'backend', {
      ...BASE_OPTIONS,
      agentRunner: agentThatSucceeds(),
      commandExecutor: exec,
    });

    expect(outcome).toEqual({
      kind: 'committed',
      commitMessage: 'fix(backend): resolve pipeline complaint (attempt 1) [bot]',
      files: ['src/api/payments.ts'],
    });
    expect(exec).toHaveBeenCalledWith(
      'git commit -m "fix(backend): resolve pipeline complaint (attempt 1) [bot]"',
      { cwd: '/repo' },
    );
    expect(exec).toHaveBeenCalledWith('git push origin HEAD:task/007-payments', { cwd: '/repo' });
  });

  it('stages only the paths the agent touched, leaving gate build artifacts out of the commit', async () => {
    const exec = fakeExec({ statuses: AGENT_MADE_A_CHANGE });

    await runFix([finding()], 'template', 'backend', {
      ...BASE_OPTIONS,
      agentRunner: agentThatSucceeds(),
      commandExecutor: exec,
    });

    expect(exec).toHaveBeenCalledWith(expect.stringMatching(/^git add --pathspec-from-file=/), { cwd: '/repo' });
    expect(exec).not.toHaveBeenCalledWith('git add -A', expect.anything());
    // `dist/` was dirty before the agent ran, so it is not the agent's work
    // and must never reach the fix commit.
    for (const call of (exec as ReturnType<typeof vi.fn>).mock.calls) {
      expect(String(call[0])).not.toContain('dist/');
    }
  });

  it('never puts an agent-created filename into a shell command (RULES.md R5.4)', async () => {
    // The agent controls what files exist, so a filename is untrusted
    // input. Interpolating it into `git add "<path>"` would execute it.
    const hostile = 'src/x"; touch /tmp/pwned; "';
    const exec = fakeExec({ statuses: ['', ` M ${hostile}\n`] });

    const outcome = await runFix([finding()], 'template', 'backend', {
      ...BASE_OPTIONS,
      agentRunner: agentThatSucceeds(),
      commandExecutor: exec,
    });

    expect(outcome.kind).toBe('committed');
    for (const call of (exec as ReturnType<typeof vi.fn>).mock.calls) {
      expect(String(call[0])).not.toContain('touch /tmp/pwned');
    }
  });

  it('snapshots, runs the agent, reverts protected paths, re-snapshots, then commits — in that order', async () => {
    const order: string[] = [];
    let statusCall = 0;
    const exec: CommandExecutor = vi.fn((command: string) => {
      if (command.startsWith('git checkout')) order.push('revert');
      if (command.startsWith('git status')) {
        order.push(statusCall === 0 ? 'snapshot-before' : 'snapshot-after');
        const stdout = statusCall === 0 ? '' : ' M x\n';
        statusCall += 1;
        return Promise.resolve({ stdout, stderr: '' });
      }
      if (command.startsWith('git add') || command.startsWith('git commit') || command.startsWith('git push')) {
        order.push('commit-or-push');
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    await runFix([finding()], 'template', 'backend', {
      ...BASE_OPTIONS,
      agentRunner: agentThatSucceeds(),
      commandExecutor: exec,
    });

    expect(order).toEqual([
      'snapshot-before',
      'revert',
      'snapshot-after',
      'commit-or-push',
      'commit-or-push',
      'commit-or-push',
    ]);
  });

  it('reports no-changes when nothing is left after the protected-path revert', async () => {
    const outcome = await runFix([finding()], 'template', 'backend', {
      ...BASE_OPTIONS,
      agentRunner: agentThatSucceeds(),
      commandExecutor: fakeExec({ statuses: AGENT_MADE_NO_CHANGE }),
    });

    expect(outcome).toEqual({ kind: 'no-changes' });
  });

  it('does not attempt to commit when there is nothing to commit', async () => {
    const exec = fakeExec({ statuses: AGENT_MADE_NO_CHANGE });

    await runFix([finding()], 'template', 'backend', {
      ...BASE_OPTIONS,
      agentRunner: agentThatSucceeds(),
      commandExecutor: exec,
    });

    expect(exec).not.toHaveBeenCalledWith(expect.stringContaining('git add'), expect.anything());
  });

  it('fails immediately when cursor-agent itself exits non-zero, without modifying the tree', async () => {
    const agentRunner = vi.fn<CursorAgentRunner>().mockResolvedValue({ stdout: '', stderr: 'boom', exitCode: 1 });
    const exec = fakeExec({ statuses: AGENT_MADE_A_CHANGE });

    const outcome = await runFix([finding()], 'template', 'backend', {
      ...BASE_OPTIONS,
      agentRunner,
      commandExecutor: exec,
    });

    expect(outcome).toEqual({ kind: 'agent-error', reason: 'cursor-agent exited with code 1: boom' });
    // The pre-run snapshot is the only command that should have run.
    const commands = (exec as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]));
    expect(commands).toEqual(['git status --porcelain']);
  });

  it('fails closed when the working tree cannot be inspected at all', async () => {
    const exec = vi.fn<CommandExecutor>().mockRejectedValue(new Error('not a git repository'));

    const outcome = await runFix([finding()], 'template', 'backend', {
      ...BASE_OPTIONS,
      agentRunner: agentThatSucceeds(),
      commandExecutor: exec,
    });

    expect(outcome.kind).toBe('agent-error');
    if (outcome.kind === 'agent-error') {
      expect(outcome.reason).toMatch(/could not read the working tree state/);
    }
  });

  it('reports an error when the commit/push step itself fails', async () => {
    const exec = fakeExec({ statuses: AGENT_MADE_A_CHANGE, failOn: (command) => command.startsWith('git push') });

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
