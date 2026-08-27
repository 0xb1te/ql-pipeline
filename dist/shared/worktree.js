/**
 * Parses `git status --porcelain` output. Rename entries (`R  old -> new`)
 * are recorded under the destination path, which is the one that exists in
 * the tree afterwards. Paths containing spaces or special characters are
 * quoted by git; the quotes are stripped so the values match real paths.
 */
export function parsePorcelain(output) {
    const state = new Map();
    for (const rawLine of output.split('\n')) {
        if (rawLine.trim().length === 0) {
            continue;
        }
        const status = rawLine.slice(0, 2);
        const pathPart = rawLine.slice(3);
        const renameIndex = pathPart.lastIndexOf(' -> ');
        const path = renameIndex === -1 ? pathPart : pathPart.slice(renameIndex + 4);
        state.set(unquote(path.trim()), status);
    }
    return state;
}
function unquote(path) {
    return path.startsWith('"') && path.endsWith('"') && path.length >= 2 ? path.slice(1, -1) : path;
}
/**
 * Snapshots what git currently thinks is dirty. Returns null when the state
 * can't be determined at all (not a git repo, git missing) — callers treat
 * that as "unknown", never as "unchanged", so an unverifiable check always
 * fails closed.
 */
export async function captureWorktreeState(cwd, exec) {
    try {
        const { stdout } = await exec('git status --porcelain', { cwd });
        return parsePorcelain(stdout);
    }
    catch {
        return null;
    }
}
/**
 * Paths that appeared or changed status between two snapshots.
 *
 * Comparing against a baseline — rather than asking "is the tree pristine?"
 * — is what makes this usable at all: by the time the reviewer or fixer
 * runs, the build and test gates have already produced node_modules, dist,
 * caches and the like. Those are present in both snapshots, so they are
 * correctly ignored, while anything the agent itself touched shows up.
 */
export function changedPaths(before, after) {
    const changed = [];
    for (const [path, status] of after) {
        if (before.get(path) !== status) {
            changed.push(path);
        }
    }
    return changed.sort();
}
/** Whether anything changed between two snapshots. */
export function worktreeChanged(before, after) {
    return changedPaths(before, after).length > 0;
}
//# sourceMappingURL=worktree.js.map