import { describe, expect, it } from 'vitest';
import { decidePipelineOutcome } from '../../src/verdict/verdict.js';
import type { Finding } from '../../src/shared/types.js';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: 'must',
    rule: 'backend.rules#no-string-concat-sql',
    file: 'src/api/users.ts',
    line: 42,
    problem: 'string-concatenated SQL',
    suggestedFix: 'use a parameterized query',
    autoFixable: true,
    ...overrides,
  };
}

describe('decidePipelineOutcome', () => {
  it('merges when there are no findings at all', () => {
    const result = decidePipelineOutcome({ findings: [], attemptsSoFar: 0, maxFixAttempts: 3 });

    expect(result).toEqual({ kind: 'MERGE', advisoryFindings: [] });
  });

  it('merges when only `should` findings are present, carrying them as advisory', () => {
    const shouldFinding = finding({ severity: 'should', autoFixable: false });

    const result = decidePipelineOutcome({ findings: [shouldFinding], attemptsSoFar: 0, maxFixAttempts: 3 });

    expect(result).toEqual({ kind: 'MERGE', advisoryFindings: [shouldFinding] });
  });

  it('requests a fix for a single auto-fixable `must` finding with attempts remaining', () => {
    const mustFinding = finding({ severity: 'must', autoFixable: true });

    const result = decidePipelineOutcome({ findings: [mustFinding], attemptsSoFar: 0, maxFixAttempts: 3 });

    expect(result).toEqual({ kind: 'FIX', findings: [mustFinding], advisoryFindings: [] });
  });

  it('requests a fix for a single auto-fixable `security` finding with attempts remaining', () => {
    const securityFinding = finding({ severity: 'security', autoFixable: true });

    const result = decidePipelineOutcome({ findings: [securityFinding], attemptsSoFar: 0, maxFixAttempts: 3 });

    expect(result).toEqual({ kind: 'FIX', findings: [securityFinding], advisoryFindings: [] });
  });

  it('keeps `should` findings out of the FIX findings list, and no longer throws them away', () => {
    // It used to do both. `findings` is what the fixer is handed, so an advisory finding there
    // would spend an attempt on something that was never blocking - that part is unchanged. What
    // changed is where the advisory finding goes instead of nowhere: it was computed, counted in
    // the audit comment, and posted on no path but MERGE.
    const mustFinding = finding({ severity: 'must', autoFixable: true });
    const shouldFinding = finding({ severity: 'should', rule: 'frontend.rules#prefer-composition' });

    const result = decidePipelineOutcome({
      findings: [shouldFinding, mustFinding],
      attemptsSoFar: 0,
      maxFixAttempts: 3,
    });

    expect(result).toEqual({ kind: 'FIX', findings: [mustFinding], advisoryFindings: [shouldFinding] });
  });

  it('blocks when a blocking finding is not auto-fixable, even on the very first attempt', () => {
    const notFixable = finding({ severity: 'must', autoFixable: false });

    const result = decidePipelineOutcome({ findings: [notFixable], attemptsSoFar: 0, maxFixAttempts: 3 });

    expect(result.kind).toBe('BLOCK');
    if (result.kind === 'BLOCK') {
      expect(result.reason).toMatch(/not auto-fixable/);
      expect(result.findings).toEqual([notFixable]);
    }
  });

  it('blocks when any one of several blocking findings is not auto-fixable', () => {
    const fixable = finding({ severity: 'must', autoFixable: true });
    const notFixable = finding({ severity: 'security', autoFixable: false, rule: 'backend.rules#no-weak-crypto' });

    const result = decidePipelineOutcome({
      findings: [fixable, notFixable],
      attemptsSoFar: 0,
      maxFixAttempts: 3,
    });

    expect(result.kind).toBe('BLOCK');
    if (result.kind === 'BLOCK') {
      expect(result.findings).toEqual([fixable, notFixable]);
    }
  });

  it('blocks once attempts are exhausted, even though every finding is auto-fixable', () => {
    const mustFinding = finding({ severity: 'must', autoFixable: true });

    const result = decidePipelineOutcome({ findings: [mustFinding], attemptsSoFar: 3, maxFixAttempts: 3 });

    expect(result.kind).toBe('BLOCK');
    if (result.kind === 'BLOCK') {
      expect(result.reason).toMatch(/max fix attempts/);
      expect(result.findings).toEqual([mustFinding]);
    }
  });

  it('still allows a fix attempt one short of the limit', () => {
    const mustFinding = finding({ severity: 'must', autoFixable: true });

    const result = decidePipelineOutcome({ findings: [mustFinding], attemptsSoFar: 2, maxFixAttempts: 3 });

    expect(result).toEqual({ kind: 'FIX', findings: [mustFinding], advisoryFindings: [] });
  });

  it('blocks for being non-auto-fixable rather than attempts-exhausted when both are true', () => {
    const notFixable = finding({ severity: 'must', autoFixable: false });

    const result = decidePipelineOutcome({ findings: [notFixable], attemptsSoFar: 5, maxFixAttempts: 3 });

    expect(result.kind).toBe('BLOCK');
    if (result.kind === 'BLOCK') {
      expect(result.reason).toMatch(/not auto-fixable/);
    }
  });

  it('blocks when attempts have gone past the limit, not just reached it', () => {
    const mustFinding = finding({ severity: 'must', autoFixable: true });

    const result = decidePipelineOutcome({ findings: [mustFinding], attemptsSoFar: 4, maxFixAttempts: 3 });

    expect(result.kind).toBe('BLOCK');
  });
});

describe('advisory findings on a blocking verdict', () => {
  function advisory(): Finding {
    return {
      severity: 'should',
      rule: 'task#provenance',
      file: '(task)',
      line: 1,
      problem: 'no ql-sprint task answers for this pull request',
      suggestedFix: null,
      autoFixable: false,
    };
  }

  function blocking(overrides: Partial<Finding> = {}): Finding {
    return {
      severity: 'must',
      rule: 'backend.rules#no-any',
      file: 'src/api.ts',
      line: 3,
      problem: 'an any leaks through the boundary',
      suggestedFix: 'name the type',
      autoFixable: true,
      ...overrides,
    };
  }

  it('carries them on FIX, where they used to be dropped', () => {
    // They were computed, counted in the audit comment and posted nowhere, so a pull request could
    // read `Findings: 5` above three readable ones. MERGE had carried them from the start.
    const decision = decidePipelineOutcome({
      findings: [blocking(), advisory()],
      attemptsSoFar: 0,
      maxFixAttempts: 3,
    });

    expect(decision.kind).toBe('FIX');
    if (decision.kind !== 'FIX') return;
    expect(decision.advisoryFindings).toHaveLength(1);
    expect(decision.findings).toHaveLength(1);
  });

  it('carries them on BLOCK too, for both reasons a run blocks', () => {
    const notFixable = decidePipelineOutcome({
      findings: [blocking({ autoFixable: false }), advisory()],
      attemptsSoFar: 0,
      maxFixAttempts: 3,
    });
    const outOfAttempts = decidePipelineOutcome({
      findings: [blocking(), advisory()],
      attemptsSoFar: 3,
      maxFixAttempts: 3,
    });

    expect(notFixable.kind).toBe('BLOCK');
    expect(outOfAttempts.kind).toBe('BLOCK');
    if (notFixable.kind === 'BLOCK') expect(notFixable.advisoryFindings).toHaveLength(1);
    if (outOfAttempts.kind === 'BLOCK') expect(outOfAttempts.advisoryFindings).toHaveLength(1);
  });

  it('never puts an advisory finding where the fixer will read it', () => {
    // `findings` is what runFix is handed. An advisory finding there would spend one of three
    // attempts on something that was never in the way of the merge.
    const decision = decidePipelineOutcome({
      findings: [blocking(), advisory(), advisory()],
      attemptsSoFar: 0,
      maxFixAttempts: 3,
    });

    if (decision.kind !== 'FIX') throw new Error('expected FIX');
    expect(decision.findings.every((entry) => entry.severity !== 'should')).toBe(true);
  });

  it('still decides on the blocking set alone', () => {
    // Advisory findings must not turn a clean run into a blocked one.
    const decision = decidePipelineOutcome({
      findings: [advisory(), advisory()],
      attemptsSoFar: 0,
      maxFixAttempts: 3,
    });

    expect(decision.kind).toBe('MERGE');
  });
});
