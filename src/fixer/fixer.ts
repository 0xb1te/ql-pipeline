import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCursorAgent, type CursorAgentRunner } from '../reviewer/cursor-runner.js';
import { defaultCommandExecutor, type CommandExecutor } from '../shared/exec.js';
import { captureWorktreeState, changedPaths } from '../shared/worktree.js';
import type { Area, Finding } from '../shared/types.js';
import { buildFixerPrompt } from './complaint.js';
import { revertProtectedPaths } from './protected-paths.js';

export type FixOutcome =
  | { readonly kind: 'committed'; readonly commitMessage: string; readonly files: readonly string[] }
  | { readonly kind: 'no-changes' }
  | { readonly kind: 'agent-error'; readonly reason: string };

export interface RunFixOptions {
  readonly cwd: string;
  readonly branch: string;
  readonly protectedPaths: readonly string[];
  readonly attemptNumber: number;
  readonly maxFixAttempts: number;
  readonly agentRunner?: CursorAgentRunner;
  readonly commandExecutor?: CommandExecutor;
}

/**
 * Runs one fix attempt: invokes cursor-agent in its default, write-capable
 * mode (paired with `--force` so a headless run never blocks on an
 * interactive permission prompt), hard-reverts any edits to protected paths
 * regardless of what the agent did (RULES.md R4), and — only if that leaves
 * real changes behind — commits and pushes with pipeline-authored commit
 * hygiene. The agent never commits or pushes itself; it only produces a
 * working-tree diff for the pipeline to act on.
 */
export async function runFix(
  findings: readonly Finding[],
  promptTemplate: string,
  area: Area,
  options: RunFixOptions,
): Promise<FixOutcome> {
  const agentRunner = options.agentRunner ?? runCursorAgent;
  const exec = options.commandExecutor ?? defaultCommandExecutor;

  // Baseline the tree before the agent runs. Comparing against this — not
  // against a pristine checkout — is what keeps build/test artifacts left
  // behind by the gates out of the fix commit: they are present in both
  // snapshots, so only what the agent actually touched gets staged.
  const before = await captureWorktreeState(options.cwd, exec);
  if (before === null) {
    return { kind: 'agent-error', reason: 'could not read the working tree state before running the fix agent' };
  }

  const prompt = buildFixerPrompt(promptTemplate, findings, options.attemptNumber, options.maxFixAttempts);
  const invocation = await agentRunner(prompt, { cwd: options.cwd, mode: 'agent' });

  if (invocation.exitCode !== 0) {
    return { kind: 'agent-error', reason: `cursor-agent exited with code ${invocation.exitCode}: ${invocation.stderr}` };
  }

  await revertProtectedPaths(options.cwd, options.protectedPaths, exec);

  const after = await captureWorktreeState(options.cwd, exec);
  if (after === null) {
    return { kind: 'agent-error', reason: 'could not read the working tree state after running the fix agent' };
  }

  const touched = changedPaths(before, after);
  if (touched.length === 0) {
    return { kind: 'no-changes' };
  }

  const commitMessage = `fix(${area}): resolve pipeline complaint (attempt ${options.attemptNumber}) [bot]`;
  // The paths come from files the *agent* created, so they are untrusted
  // input and must never be interpolated into a shell string (RULES.md
  // R5.4) — a file named `x"; rm -rf /; "` would otherwise be executed.
  // Handing git a pathspec file keeps them out of the shell entirely; the
  // only interpolated value is a temp path we generated ourselves.
  const pathspecFile = join(tmpdir(), `ql-pipeline-fix-${randomUUID()}.pathspec`);
  try {
    writeFileSync(pathspecFile, touched.join('\n'), 'utf-8');
    await exec(`git add --pathspec-from-file="${pathspecFile}"`, { cwd: options.cwd });
    await exec(`git commit -m "${commitMessage}"`, { cwd: options.cwd });
    await exec(`git push origin HEAD:${options.branch}`, { cwd: options.cwd });
  } catch (cause) {
    return { kind: 'agent-error', reason: `failed to commit/push the fix: ${String(cause)}` };
  } finally {
    try {
      unlinkSync(pathspecFile);
    } catch {
      // A leftover temp file on a throwaway CI runner is not worth failing over.
    }
  }

  return { kind: 'committed', commitMessage, files: touched };
}
