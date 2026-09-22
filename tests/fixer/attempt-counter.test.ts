import { describe, expect, it } from 'vitest';
import { countFixAttempts } from '../../src/fixer/attempt-counter.js';
import { FIX_ATTEMPT_MARKER } from '../../src/shared/types.js';

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

describe('counting an attempt a provider committed for itself', () => {
  const marked = (body: string): string => `${body}\n\n${FIX_ATTEMPT_MARKER}`;
  const botCommit = 'fix(backend): resolve pipeline complaint (attempt 1) [bot]';

  it('counts a marked summary when no bot commit exists', () => {
    // The ql_agents provider. ql-agents commits on its own host with its own message, so the
    // commit history says nothing - every run read attempt 1, max_fix_attempts never tripped,
    // and each push started another attempt. An unbounded fix loop.
    expect(countFixAttempts([], [marked('### ql-pipeline summary')])).toBe(1);
    expect(countFixAttempts(['docs: something a person wrote'], [marked('a'), marked('b')])).toBe(2);
  });

  it('counts one attempt when the same attempt left both a commit and a marker', () => {
    // The cursor provider leaves both. Summing them would report two attempts for one and
    // exhaust the budget at half its configured size.
    expect(countFixAttempts([botCommit], [marked('### ql-pipeline summary')])).toBe(1);
  });

  it('still counts bot commits on a pull request older than the marker', () => {
    expect(countFixAttempts([botCommit, botCommit], [])).toBe(2);
  });

  it('takes the larger source when the two disagree', () => {
    expect(countFixAttempts([botCommit, botCommit], [marked('a')])).toBe(2);
    expect(countFixAttempts([botCommit], [marked('a'), marked('b'), marked('c')])).toBe(3);
  });

  it('ignores a comment that carries no marker', () => {
    expect(countFixAttempts([], ['### ql-pipeline summary', 'please rename the variable'])).toBe(0);
  });

  it('reads zero from an empty pull request, and from one nobody has commented on', () => {
    expect(countFixAttempts([], [])).toBe(0);
    expect(countFixAttempts(['feat: a real commit'], [])).toBe(0);
  });

  it('defaults the comments away, so an existing caller compiles and behaves as before', () => {
    expect(countFixAttempts([botCommit])).toBe(1);
  });

  it('bounds the loop: three marked attempts reach a cap of three', () => {
    // The whole point. Under ql_agents this returned 0 forever.
    const attempts = [marked('one'), marked('two'), marked('three')];

    expect(countFixAttempts([], attempts)).toBe(3);
    expect(countFixAttempts([], attempts) >= 3).toBe(true);
  });
});
