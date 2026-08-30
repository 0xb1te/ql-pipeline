// @neuron fix.fixer.protectedPaths
import type { CommandExecutor } from '../shared/exec.js';

/**
 * Defense-in-depth for RULES.md R4: hard-reverts any fixer edits to the
 * pipeline's own protected paths, structurally rather than by trusting the
 * prompt. Runs one path at a time and swallows failures per-path — not
 * every consumer repo has all of the configured paths (e.g. no rule
 * overrides), and `git checkout --` errors on a pathspec that doesn't exist
 * in the repo at all. A missing path is nothing to protect, not a failure.
 */
// @signal revertProtectedPaths
export async function revertProtectedPaths(
  cwd: string,
  protectedPaths: readonly string[],
  exec: CommandExecutor,
): Promise<void> {
  for (const path of protectedPaths) {
    try {
      await exec(`git checkout -- "${path}"`, { cwd });
    } catch {
      // Nothing tracked at this path in this repo, or nothing to revert.
    }
  }
}
