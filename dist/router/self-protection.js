// @neuron routing.router.selfProtection
/**
 * RULES.md R4 / AGENT.md invariant #5: the pipeline must never auto-merge
 * (or auto-fix) changes to its own governance paths. A protected path
 * ending in "/" is a directory prefix; anything else is matched exactly,
 * so a path like ".github/pipeline.config.yml.bak" doesn't accidentally
 * match ".github/pipeline.config.yml".
 */
// @signal touchesProtectedPaths
export function touchesProtectedPaths(changedFiles, protectedPaths) {
    return changedFiles.some((file) => protectedPaths.some((protectedPath) => (protectedPath.endsWith('/') ? file.startsWith(protectedPath) : file === protectedPath)));
}
//# sourceMappingURL=self-protection.js.map