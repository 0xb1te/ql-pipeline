import { describe, expect, it } from 'vitest';
import { reviewKindFor } from '../../src/standards/review-kind.js';

describe('reviewKindFor', () => {
  it('picks pr-feature from a features/ branch', () => {
    expect(reviewKindFor('features/016-review-pr-packs', ['fix'])).toBe('pr-feature');
  });

  it('picks pr-fix from a hotfixes/ branch', () => {
    expect(reviewKindFor('hotfixes/003-checkout-500', ['feat'])).toBe('pr-fix');
  });

  it('picks pr-bugfix from a bugfixes/ branch', () => {
    expect(reviewKindFor('bugfixes/012-vat', ['feat'])).toBe('pr-bugfix');
  });

  it('falls back to pr-bugfix for a fix commit on an unnamed branch', () => {
    expect(reviewKindFor('patch-1', ['fix'])).toBe('pr-bugfix');
  });

  it('falls back to pr-feature for a feat commit on an unnamed branch', () => {
    expect(reviewKindFor('patch-1', ['feat'])).toBe('pr-feature');
  });

  it('prefers feature when both feat and fix are on an unnamed branch', () => {
    expect(reviewKindFor('wip', ['feat', 'fix'])).toBe('pr-feature');
  });
});
