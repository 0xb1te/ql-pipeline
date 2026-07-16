import { describe, expect, it } from 'vitest';
import { countFixAttempts } from '../../src/fixer/attempt-counter.js';

describe('countFixAttempts', () => {
  it('is 0 for an empty commit list', () => {
    expect(countFixAttempts([])).toBe(0);
  });

  it('is 0 when there are no bot commits', () => {
    expect(countFixAttempts(['feat(frontend): add toggle', 'fix(backend): patch bug'])).toBe(0);
  });

  it('counts a single bot commit', () => {
    expect(countFixAttempts(['fix(backend): resolve pipeline complaint (attempt 1) [bot]'])).toBe(1);
  });

  it('counts multiple bot commits alongside human ones', () => {
    const messages = [
      'feat(backend): add payments endpoint',
      'fix(backend): resolve pipeline complaint (attempt 1) [bot]',
      'fix(backend): resolve pipeline complaint (attempt 2) [bot]',
    ];

    expect(countFixAttempts(messages)).toBe(2);
  });

  it('requires "[bot]" at the end of the header line, not just anywhere', () => {
    expect(countFixAttempts(['fix(backend): [bot] mentioned mid-sentence, not a real bot commit'])).toBe(0);
  });

  it('allows trailing whitespace after "[bot]"', () => {
    expect(countFixAttempts(['fix(backend): resolve complaint [bot] '])).toBe(1);
  });

  it('only inspects the header line, not the commit body', () => {
    const message = 'feat(backend): add endpoint\n\nBody text mentioning [bot] here.';

    expect(countFixAttempts([message])).toBe(0);
  });

  it('is case-sensitive, matching RULES.md R2.3 exactly', () => {
    expect(countFixAttempts(['fix(backend): resolve complaint [BOT]'])).toBe(0);
  });
});
