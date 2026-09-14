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
    /** Titles of the `## ` sections dropped, in document order. */
    readonly droppedSections: readonly string[];
    /** Characters removed from the source document. */
    readonly droppedChars: number;
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
/** How many section titles a rendered list names before eliding the rest. */
export declare const MAX_LISTED_SECTIONS = 10;
export interface TruncationResult {
    readonly text: string;
    readonly truncated: boolean;
    /** Titles of the `## ` sections dropped, in document order. */
    readonly droppedSections: readonly string[];
    /** Characters removed from the source document. */
    readonly droppedChars: number;
}
/**
 * Renders a dropped-section list for a log line or a prompt note. Long lists
 * are elided: the point is to make the shape of the gap legible, and thirty
 * titles on one line is not. The full list survives in the gate report, which
 * has no line-length pressure.
 */
export declare function describeDroppedSections(sections: readonly string[], droppedChars: number): string;
/**
 * Truncates on a section boundary where possible. The checklists are
 * organised as `## NN — Title` sections, so cutting mid-section would hand
 * the reviewer half a rule; dropping whole trailing sections at least
 * leaves every included rule intact and says what was dropped.
 *
 * "Says what was dropped" is literal: the removed tail is scanned for its
 * section headings, which are returned to the caller and named in the marker.
 * A reviewer that cannot see a rule should at least be able to tell the rule
 * existed - otherwise `Findings: 0` is unreadable, because nothing separates
 * "nothing to report" from "the rule that would have caught it was not in the
 * prompt".
 */
export declare function truncateAtSection(text: string, maxChars: number): TruncationResult;
/**
 * Loads the review pack for this PR's kind and areas from
 * `workflow/review/pr-*`. The pack path is a convention, not a config map.
 */
export declare function resolveStandards(areas: readonly Area[], config: StandardsConfig, workspaceRoot: string, reader?: StandardsReader, kind?: ReviewKind): Promise<StandardsResolution>;
/**
 * The reference ids the reviewer may cite for these standards.
 *
 * Deduplicated: every slice of an area carries that area's id, so a sliced
 * area would otherwise list `frontend.standards` once per slice. The id is a
 * citation vocabulary, not a document count - slicing is deliberately
 * invisible to the reviewer.
 */
export declare function standardsIds(standards: readonly ResolvedStandard[]): string[];
/**
 * Renders one standards document as it appears in the prompt. Exported so the
 * pass planner can size a document exactly as the prompt will carry it, rather
 * than approximating from `text.length` and drifting from the real cost.
 */
export declare function formatStandard(standard: ResolvedStandard): string;
/** Renders the standards block injected into the reviewer prompt. */
export declare function formatStandardsForPrompt(standards: readonly ResolvedStandard[]): string;
