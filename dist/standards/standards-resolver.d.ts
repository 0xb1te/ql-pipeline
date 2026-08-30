import type { Area, StandardsConfig } from '../shared/types.js';
export interface ResolvedStandard {
    /** Reference id findings cite, e.g. `frontend.standards`. */
    readonly id: string;
    readonly area: Area;
    /** Path relative to the standards root, kept so the reviewer can name its source. */
    readonly docPath: string;
    readonly text: string;
    readonly truncated: boolean;
}
export interface StandardsResolution {
    readonly standards: readonly ResolvedStandard[];
    /** Docs the config named that were not present — surfaced, never silently ignored. */
    readonly missing: readonly string[];
}
/**
 * A source of standards documents, keyed by the same absolute path
 * `resolveStandards` joins from `workspaceRoot` + `config.root` + a
 * configured doc path. HTTP-backed implementations (`HouseStandardsReader`)
 * reverse that join internally to recover the doc path they actually need —
 * this interface's shape stays the local-filesystem one so neither side has
 * to change when a new transport is added.
 *
 * Both methods are `Promise`-returning because a reader backed by a network
 * call is inherently async; the local-filesystem reader below just resolves
 * immediately.
 */
export interface StandardsReader {
    exists: (path: string) => Promise<boolean>;
    read: (path: string) => Promise<string>;
}
export declare function standardsIdFor(area: Area): string;
/**
 * Truncates on a section boundary where possible. The checklists are
 * organised as `## NN — Title` sections, so cutting mid-section would hand
 * the reviewer half a rule; dropping whole trailing sections at least
 * leaves every included rule intact and says what was dropped.
 */
export declare function truncateAtSection(text: string, maxChars: number): {
    text: string;
    truncated: boolean;
};
/**
 * Loads the engineering standards that apply to a PR's areas — the house
 * workflow documentation, checked out alongside the code under review.
 *
 * Each area's documents are concatenated into a single reference the
 * reviewer can cite, budgeted per area so a large checklist cannot crowd
 * the diff out of the prompt.
 */
export declare function resolveStandards(areas: readonly Area[], config: StandardsConfig, workspaceRoot: string, reader?: StandardsReader): Promise<StandardsResolution>;
/** The reference ids the reviewer may cite for these standards. */
export declare function standardsIds(standards: readonly ResolvedStandard[]): string[];
/** Renders the standards block injected into the reviewer prompt. */
export declare function formatStandardsForPrompt(standards: readonly ResolvedStandard[]): string;
