import { spawn } from 'node:child_process';
import type { CommandExecutor } from '../shared/exec.js';

export interface CursorAgentInvocation {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type CursorAgentMode = 'ask' | 'agent';

export interface CursorAgentRunOptions {
  readonly cwd: string;
  readonly mode: CursorAgentMode;
}

export type CursorAgentRunner = (prompt: string, options: CursorAgentRunOptions) => Promise<CursorAgentInvocation>;

/**
 * Invokes the real `cursor-agent` CLI. The prompt (PR diff, complaint JSON,
 * etc. — all PR-derived, untrusted content) is passed as a single argv
 * element via `spawn`, never interpolated into a shell string, so shell
 * metacharacters in it are inert (RULES.md R5.4).
 *
 * `--mode ask` is read-only (used for review); its absence means the
 * default full agent mode, which can write/run commands, paired with
 * `--force` so a headless run never blocks on an interactive permission
 * prompt (used for fixing, Phase 4). `--trust` avoids a workspace-trust
 * prompt on a checkout `cursor-agent` has never seen before.
 */
export const runCursorAgent: CursorAgentRunner = (prompt, options) => {
  return new Promise((resolve, reject) => {
    const args = ['--print', '--output-format', 'json', '--trust', '--workspace', options.cwd];
    if (options.mode === 'ask') {
      args.push('--mode', 'ask');
    } else {
      args.push('--force');
    }
    args.push(prompt);

    const child = spawn('cursor-agent', args, { cwd: options.cwd, shell: false });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
};

/**
 * The reviewer runs in read-only mode, but a mode flag is a prompt-level
 * instruction, not a guarantee — this checks the checkout was actually left
 * untouched. Any failure to check (not a git repo, git missing) is treated
 * as "not clean": if we can't verify read-only behavior held, we don't
 * assume it did.
 */
export async function isWorkingTreeClean(cwd: string, exec: CommandExecutor): Promise<boolean> {
  try {
    const { stdout } = await exec('git status --porcelain', { cwd });
    return stdout.trim().length === 0;
  } catch {
    return false;
  }
}
