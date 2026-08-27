import { type Area, type AreaPathsConfig } from '../shared/types.js';
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
export declare function globToRegExp(glob: string): RegExp;
export declare function matchesGlob(path: string, glob: string): boolean;
/**
 * Areas implied by the files a PR actually touches, in canonical order.
 *
 * This is deliberately *additive* to the conventional-commit header rather
 * than a replacement for it: commit hygiene stays mandatory (a PR with no
 * parseable header is still unroutable), but a PR labelled `feat(frontend)`
 * that also edits `apps/api-backend/` cannot thereby dodge the backend
 * rules.
 */
export declare function areasFromPaths(changedFiles: readonly string[], areaPaths: AreaPathsConfig): Area[];
