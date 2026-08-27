import type { Finding } from '../shared/types.js';
export interface DiffLineIndex {
    hasFile(file: string): boolean;
    hasLine(file: string, line: number): boolean;
}
/**
 * Indexes which (file, line) pairs actually exist in the *new* side of a
 * unified diff, so reviewer findings can be checked against reality instead
 * of trusted at face value. Only context and added lines count — a removed
 * line no longer exists in the new file, so a finding can't legitimately
 * point at one.
 */
export declare function buildDiffLineIndex(diff: string): DiffLineIndex;
export interface GroundingResult {
    readonly grounded: readonly Finding[];
    readonly discarded: readonly {
        readonly finding: Finding;
        readonly reason: string;
    }[];
}
/**
 * Applies the reviewer's grounding requirement (SPECIFICATION.md §6): a
 * finding must cite a file/line that really appears in the diff, and a
 * reference that was actually loaded for this PR. Anything else is
 * discarded rather than trusted — the hallucination guard on the reviewer.
 *
 * A "reference" is any loaded document id: a rule file (`backend.rules`)
 * or an engineering standards document (`backend.standards`). Both are
 * cited the same way, `<id>#<section>`.
 */
export declare function groundFindings(findings: readonly Finding[], diffIndex: DiffLineIndex, loadedReferences: readonly string[]): GroundingResult;
