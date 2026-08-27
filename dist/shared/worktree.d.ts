import type { CommandExecutor } from './exec.js';
/** Path → porcelain status code, as reported by `git status --porcelain`. */
export type WorktreeState = ReadonlyMap<string, string>;
/**
 * Parses `git status --porcelain` output. Rename entries (`R  old -> new`)
 * are recorded under the destination path, which is the one that exists in
 * the tree afterwards. Paths containing spaces or special characters are
 * quoted by git; the quotes are stripped so the values match real paths.
 */
export declare function parsePorcelain(output: string): WorktreeState;
/**
 * Snapshots what git currently thinks is dirty. Returns null when the state
 * can't be determined at all (not a git repo, git missing) — callers treat
 * that as "unknown", never as "unchanged", so an unverifiable check always
 * fails closed.
 */
export declare function captureWorktreeState(cwd: string, exec: CommandExecutor): Promise<WorktreeState | null>;
/**
 * Paths that appeared or changed status between two snapshots.
 *
 * Comparing against a baseline — rather than asking "is the tree pristine?"
 * — is what makes this usable at all: by the time the reviewer or fixer
 * runs, the build and test gates have already produced node_modules, dist,
 * caches and the like. Those are present in both snapshots, so they are
 * correctly ignored, while anything the agent itself touched shows up.
 */
export declare function changedPaths(before: WorktreeState, after: WorktreeState): string[];
/** Whether anything changed between two snapshots. */
export declare function worktreeChanged(before: WorktreeState, after: WorktreeState): boolean;
