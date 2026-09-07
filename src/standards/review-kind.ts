// @neuron standards.reader.reviewKind
import type { CommitType } from '../shared/types.js';

export const REVIEW_KINDS = ['pr-feature', 'pr-fix', 'pr-bugfix'] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

/**
 * Which ql-docs review pack a PR loads. Branch prefix wins: that is how
 * feature / hotfix / bugfix flows name their work. Commit type is the
 * fallback when the branch is unnamed (`fix` → bugfix, anything else →
 * feature). Hotfix cannot be told from `fix(` alone.
 */
// @signal reviewKindFor
export function reviewKindFor(headRef: string, types: readonly CommitType[]): ReviewKind {
  const branch = headRef.replace(/\\/g, '/');
  if (hasSegment(branch, 'hotfixes')) {
    return 'pr-fix';
  }
  if (hasSegment(branch, 'bugfixes')) {
    return 'pr-bugfix';
  }
  if (hasSegment(branch, 'features')) {
    return 'pr-feature';
  }
  if (types.includes('fix') && !types.includes('feat')) {
    return 'pr-bugfix';
  }
  return 'pr-feature';
}

function hasSegment(ref: string, name: string): boolean {
  return ref === name || ref.startsWith(`${name}/`) || ref.includes(`/${name}/`);
}
