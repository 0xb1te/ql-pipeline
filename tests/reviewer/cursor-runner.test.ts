import { describe, expect, it } from 'vitest';
import { reviewerMutatedCheckout } from '../../src/reviewer/cursor-runner.js';
import { parsePorcelain } from '../../src/shared/worktree.js';

describe('reviewerMutatedCheckout', () => {
  it('is false when nothing changed between the two snapshots', () => {
    const before = parsePorcelain('');
    const after = parsePorcelain('');

    expect(reviewerMutatedCheckout(before, after)).toBe(false);
  });

  it('ignores artifacts that were already dirty before the review started', () => {
    // The build and test gates run before the reviewer, so `dist/` and
    // friends are routinely dirty by this point — that is not the
    // reviewer's doing and must not fail the run.
    const before = parsePorcelain('?? dist/\n?? node_modules/\n');
    const after = parsePorcelain('?? dist/\n?? node_modules/\n');

    expect(reviewerMutatedCheckout(before, after)).toBe(false);
  });

  it('is true when the reviewer added a file', () => {
    const before = parsePorcelain('?? dist/\n');
    const after = parsePorcelain('?? dist/\n?? sneaky.ts\n');

    expect(reviewerMutatedCheckout(before, after)).toBe(true);
  });

  it('is true when the reviewer modified a tracked file', () => {
    const before = parsePorcelain('');
    const after = parsePorcelain(' M src/index.ts\n');

    expect(reviewerMutatedCheckout(before, after)).toBe(true);
  });

  it('fails closed when the "before" snapshot could not be taken', () => {
    expect(reviewerMutatedCheckout(null, parsePorcelain(''))).toBe(true);
  });

  it('fails closed when the "after" snapshot could not be taken', () => {
    expect(reviewerMutatedCheckout(parsePorcelain(''), null)).toBe(true);
  });
});
