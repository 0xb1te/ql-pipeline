import { runCursorAgent, isWorkingTreeClean, type CursorAgentRunner } from '../reviewer/cursor-runner.js';
import { defaultCommandExecutor, type CommandExecutor } from '../shared/exec.js';
import type { Area, Finding } from '../shared/types.js';
import { buildFixerPrompt } from './complaint.js';
import { revertProtectedPaths } from './protected-paths.js';

export type FixOutcome =
  | { readonly kind: 'committed'; readonly commitMessage: string }
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

  const prompt = buildFixerPrompt(promptTemplate, findings, options.attemptNumber, options.maxFixAttempts);
  const invocation = await agentRunner(prompt, { cwd: options.cwd, mode: 'agent' });

  if (invocation.exitCode !== 0) {
    return { kind: 'agent-error', reason: `cursor-agent exited with code ${invocation.exitCode}: ${invocation.stderr}` };
  }

  await revertProtectedPaths(options.cwd, options.protectedPaths, exec);

  const nothingChanged = await isWorkingTreeClean(options.cwd, exec);
  if (nothingChanged) {
    return { kind: 'no-changes' };
  }

  const commitMessage = `fix(${area}): resolve pipeline complaint (attempt ${options.attemptNumber}) [bot]`;
  try {
    await exec('git add -A', { cwd: options.cwd });
    await exec(`git commit -m "${commitMessage}"`, { cwd: options.cwd });
    await exec(`git push origin HEAD:${options.branch}`, { cwd: options.cwd });
  } catch (cause) {
    return { kind: 'agent-error', reason: `failed to commit/push the fix: ${String(cause)}` };
  }

  return { kind: 'committed', commitMessage };
}
