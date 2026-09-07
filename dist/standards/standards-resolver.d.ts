import { type Area, type StandardsConfig } from '../shared/types.js';
import { type ReviewKind } from './review-kind.js';
export interface ResolvedStandard {
    /** Reference id findings cite, e.g. `frontend.standards` or `review.standards`. */
    readonly id: string;
    readonly area: Area | null;
    /** Path relative to the standards root, kept so the reviewer can name its source. */
    readonly docPath: string;
    readonly text: string;
    readonly truncated: boolean;
}
export interface StandardsResolution {
    readonly standards: readonly ResolvedStandard[];
    /** Docs the pack named that were not present — surfaced, never silently ignored. */
    readonly missing: readonly string[];
}
/**
 * A source of standards documents, keyed by the same absolute path
 * `resolveStandards` joins from `workspaceRoot` + `config.root` + a
 * pack-relative doc path.
 */
export interface StandardsReader {
    exists: (path: string) => Promise<boolean>;
    read: (path: string) => Promise<string>;
}
export interface ReviewPackEntry {
    readonly id: string;
    readonly area: Area | null;
    readonly docPath: string;
}
export declare function standardsIdFor(area: Area): string;
export declare function reviewPackEntries(kind: ReviewKind, areas: readonly Area[]): ReviewPackEntry[];
/** Every file a local `.standards` checkout must have for `doctor` to pass. */
export declare function allReviewDocumentPaths(): string[];
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
 * Loads the review pack for this PR's kind and areas from
 * `workflow/review/pr-*`. The pack path is a convention, not a config map.
 */
export declare function resolveStandards(areas: readonly Area[], config: StandardsConfig, workspaceRoot: string, reader?: StandardsReader, kind?: ReviewKind): Promise<StandardsResolution>;
/** The reference ids the reviewer may cite for these standards. */
export declare function standardsIds(standards: readonly ResolvedStandard[]): string[];
/** Renders the standards block injected into the reviewer prompt. */
export declare function formatStandardsForPrompt(standards: readonly ResolvedStandard[]): string;
