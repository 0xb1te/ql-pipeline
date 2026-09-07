import type { CommitType } from '../shared/types.js';
export declare const REVIEW_KINDS: readonly ["pr-feature", "pr-fix", "pr-bugfix"];
export type ReviewKind = (typeof REVIEW_KINDS)[number];
/**
 * Which ql-docs review pack a PR loads. Branch prefix wins: that is how
 * feature / hotfix / bugfix flows name their work. Commit type is the
 * fallback when the branch is unnamed (`fix` → bugfix, anything else →
 * feature). Hotfix cannot be told from `fix(` alone.
 */
export declare function reviewKindFor(headRef: string, types: readonly CommitType[]): ReviewKind;
