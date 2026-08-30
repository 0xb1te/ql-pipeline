// @neuron routing.router.areaPaths
import { AREAS } from '../shared/types.js';
/**
 * Compiles a path glob to a regex. Supports the three forms the monorepo
 * convention needs:
 *   `*`   any run of characters within one path segment
 *   `**`  any run of characters, crossing segment boundaries
 *   `?`   exactly one character within a segment
 *
 * `/**` is treated as an optional suffix, so `apps/*backend*` "and
 * everything under it" also matches the directory entry itself.
 */
// @signal globToRegExp
export function globToRegExp(glob) {
    let pattern = '';
    for (let i = 0; i < glob.length; i += 1) {
        const rest = glob.slice(i);
        if (rest.startsWith('/**')) {
            pattern += '(?:/.*)?';
            i += 2;
            continue;
        }
        if (rest.startsWith('**')) {
            pattern += '.*';
            i += 1;
            continue;
        }
        const char = glob[i];
        if (char === '*') {
            pattern += '[^/]*';
        }
        else if (char === '?') {
            pattern += '[^/]';
        }
        else {
            pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        }
    }
    return new RegExp(`^${pattern}$`);
}
// @signal matchesGlob
export function matchesGlob(path, glob) {
    return globToRegExp(glob).test(path);
}
/**
 * Areas implied by the files a PR actually touches, in canonical order.
 *
 * This is deliberately *additive* to the conventional-commit header rather
 * than a replacement for it: commit hygiene stays mandatory (a PR with no
 * parseable header is still unroutable), but a PR labelled `feat(frontend)`
 * that also edits `apps/api-backend/` cannot thereby dodge the backend
 * rules.
 */
// @signal areasFromPaths
export function areasFromPaths(changedFiles, areaPaths) {
    const matched = new Set();
    for (const file of changedFiles) {
        const normalized = file.replace(/\\/g, '/');
        for (const area of AREAS) {
            const globs = areaPaths[area];
            if (globs === undefined || matched.has(area)) {
                continue;
            }
            if (globs.some((glob) => matchesGlob(normalized, glob))) {
                matched.add(area);
            }
        }
    }
    return AREAS.filter((area) => matched.has(area));
}
//# sourceMappingURL=area-paths.js.map