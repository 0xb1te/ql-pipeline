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
    const result = decidePipelineOutcome({ findings: [], attemptsSoFar: 0, maxFixAttempts: 3, fixAdvisory: true });

    expect(result).toEqual({ kind: 'MERGE', advisoryFindings: [] });
  });

  it('merges when only `should` findings are present, carrying them as advisory', () => {
    const shouldFinding = finding({ severity: 'should', autoFixable: false });

    const result = decidePipelineOutcome({ findings: [shouldFinding], attemptsSoFar: 0, maxFixAttempts: 3, fixAdvisory: true });

    expect(result).toEqual({ kind: 'MERGE', advisoryFindings: [shouldFinding] });
  });

  it('requests a fix for a single auto-fixable `must` finding with attempts remaining', () => {
    const mustFinding = finding({ severity: 'must', autoFixable: true });

    const result = decidePipelineOutcome({ findings: [mustFinding], attemptsSoFar: 0, maxFixAttempts: 3, fixAdvisory: true });

    expect(result).toEqual({ kind: 'FIX', findings: [mustFinding], advisoryFindings: [] });
  });

  it('requests a fix for a single auto-fixable `security` finding with attempts remaining', () => {
    const securityFinding = finding({ severity: 'security', autoFixable: true });

    const result = decidePipelineOutcome({ findings: [securityFinding], attemptsSoFar: 0, maxFixAttempts: 3, fixAdvisory: true });

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
      maxFixAttempts: 3, fixAdvisory: true,
    });

    expect(result).toEqual({ kind: 'FIX', findings: [mustFinding], advisoryFindings: [shouldFinding] });
  });

  it('blocks when a blocking finding is not auto-fixable, even on the very first attempt', () => {
    const notFixable = finding({ severity: 'must', autoFixable: false });

    const result = decidePipelineOutcome({ findings: [notFixable], attemptsSoFar: 0, maxFixAttempts: 3, fixAdvisory: true });

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
      maxFixAttempts: 3, fixAdvisory: true,
    });

    expect(result.kind).toBe('BLOCK');
    if (result.kind === 'BLOCK') {
      expect(result.findings).toEqual([fixable, notFixable]);
    }
  });

  it('blocks once attempts are exhausted, even though every finding is auto-fixable', () => {
    const mustFinding = finding({ severity: 'must', autoFixable: true });

    const result = decidePipelineOutcome({ findings: [mustFinding], attemptsSoFar: 3, maxFixAttempts: 3, fixAdvisory: true });

    expect(result.kind).toBe('BLOCK');
    if (result.kind === 'BLOCK') {
      expect(result.reason).toMatch(/max fix attempts/);
      expect(result.findings).toEqual([mustFinding]);
    }
  });

  it('still allows a fix attempt one short of the limit', () => {
    const mustFinding = finding({ severity: 'must', autoFixable: true });

    const result = decidePipelineOutcome({ findings: [mustFinding], attemptsSoFar: 2, maxFixAttempts: 3, fixAdvisory: true });

    expect(result).toEqual({ kind: 'FIX', findings: [mustFinding], advisoryFindings: [] });
  });

  it('blocks for being non-auto-fixable rather than attempts-exhausted when both are true', () => {
    const notFixable = finding({ severity: 'must', autoFixable: false });

    const result = decidePipelineOutcome({ findings: [notFixable], attemptsSoFar: 5, maxFixAttempts: 3, fixAdvisory: true });

    expect(result.kind).toBe('BLOCK');
    if (result.kind === 'BLOCK') {
      expect(result.reason).toMatch(/not auto-fixable/);
    }
  });

  it('blocks when attempts have gone past the limit, not just reached it', () => {
    const mustFinding = finding({ severity: 'must', autoFixable: true });

    const result = decidePipelineOutcome({ findings: [mustFinding], attemptsSoFar: 4, maxFixAttempts: 3, fixAdvisory: true });

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
      maxFixAttempts: 3, fixAdvisory: true,
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
      maxFixAttempts: 3, fixAdvisory: true,
    });
    const outOfAttempts = decidePipelineOutcome({
      findings: [blocking(), advisory()],
      attemptsSoFar: 3,
      maxFixAttempts: 3, fixAdvisory: true,
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
      maxFixAttempts: 3, fixAdvisory: true,
    });

    if (decision.kind !== 'FIX') throw new Error('expected FIX');
    expect(decision.findings.every((entry) => entry.severity !== 'should')).toBe(true);
  });

  it('still decides on the blocking set alone', () => {
    // Advisory findings must not turn a clean run into a blocked one.
    const decision = decidePipelineOutcome({
      findings: [advisory(), advisory()],
      attemptsSoFar: 0,
      maxFixAttempts: 3, fixAdvisory: true,
    });

    expect(decision.kind).toBe('MERGE');
  });
});

describe('advisory findings get an agent too', () => {
  const fixableAdvisory = (overrides: Partial<Finding> = {}): Finding =>
    finding({ severity: 'should', autoFixable: true, ...overrides });

  it('requests a fix when nothing blocks but an auto-fixable advisory finding stands', () => {
    // The behaviour this replaced: runGovern returns above recordComplaint and runFix on a
    // MERGE, so a `should` finding was reported into a thread that then belonged to nobody.
    const decision = decidePipelineOutcome({
      findings: [fixableAdvisory()],
      attemptsSoFar: 0,
      maxFixAttempts: 3,
      fixAdvisory: true,
    });

    expect(decision.kind).toBe('FIX');
    if (decision.kind === 'FIX') {
      expect(decision.findings).toHaveLength(1);
      // They are the complaint now, not advisory riding along. Leaving them in both lists is
      // how they would get posted twice.
      expect(decision.advisoryFindings).toEqual([]);
    }
  });

  it('merges instead when the repository turned it off', () => {
    const decision = decidePipelineOutcome({
      findings: [fixableAdvisory()],
      attemptsSoFar: 0,
      maxFixAttempts: 3,
      fixAdvisory: false,
    });

    expect(decision.kind).toBe('MERGE');
    expect(decision.advisoryFindings).toHaveLength(1);
  });

  it('merges rather than blocks once the attempts are spent', () => {
    // The guard that matters most. A `should` finding never blocked a pull request and must not
    // start now - when there is nothing left to try, it goes back to being a comment.
    const decision = decidePipelineOutcome({
      findings: [fixableAdvisory()],
      attemptsSoFar: 3,
      maxFixAttempts: 3,
      fixAdvisory: true,
    });

    expect(decision.kind).toBe('MERGE');
    expect(decision.advisoryFindings).toHaveLength(1);
  });

  it('merges rather than blocks when an advisory finding is not auto-fixable', () => {
    // Spending an attempt on something no agent can fix changes nothing, and BLOCK over a nit
    // would be worse than the silence this replaced.
    const decision = decidePipelineOutcome({
      findings: [fixableAdvisory({ autoFixable: false })],
      attemptsSoFar: 0,
      maxFixAttempts: 3,
      fixAdvisory: true,
    });

    expect(decision.kind).toBe('MERGE');
  });

  it('declines the whole set when any one of them is not auto-fixable', () => {
    const decision = decidePipelineOutcome({
      findings: [fixableAdvisory(), fixableAdvisory({ autoFixable: false })],
      attemptsSoFar: 0,
      maxFixAttempts: 3,
      fixAdvisory: true,
    });

    expect(decision.kind).toBe('MERGE');
    expect(decision.advisoryFindings).toHaveLength(2);
  });

  it('still merges a pull request with no findings at all', () => {
    const decision = decidePipelineOutcome({
      findings: [],
      attemptsSoFar: 0,
      maxFixAttempts: 3,
      fixAdvisory: true,
    });

    expect(decision.kind).toBe('MERGE');
  });

  it('leaves the blocking path untouched - a must finding still decides alone', () => {
    const decision = decidePipelineOutcome({
      findings: [finding({ severity: 'must', autoFixable: true }), fixableAdvisory()],
      attemptsSoFar: 0,
      maxFixAttempts: 3,
      fixAdvisory: true,
    });

    expect(decision.kind).toBe('FIX');
    if (decision.kind === 'FIX') {
      expect(decision.findings.every((entry) => entry.severity === 'must')).toBe(true);
      expect(decision.advisoryFindings).toHaveLength(1);
    }
  });

  it('leaves a failed non-required gate alone, because that is a configured choice', () => {
    // A gate the repository left out of required_checks is advisory because somebody said so -
    // "report this, do not act on it". An advisory finding from the review is advisory because
    // the reviewer judged it minor. Only the second is an invitation to send an agent.
    const gateFinding = finding({
      severity: 'should',
      autoFixable: true,
      rule: 'gate#backend-test',
      file: '(gate)',
    });

    const decision = decidePipelineOutcome({
      findings: [gateFinding],
      attemptsSoFar: 0,
      maxFixAttempts: 3,
      fixAdvisory: true,
    });

    expect(decision.kind).toBe('MERGE');
    expect(decision.advisoryFindings).toHaveLength(1);
  });

  it('declines the whole set when a gate finding is mixed in with review nits', () => {
    // Dispatching the reviewable half alone would report the gate nowhere: the advisory list is
    // emptied on a FIX, and the merge path is the only thing that posts it.
    const decision = decidePipelineOutcome({
      findings: [
        finding({ severity: 'should', autoFixable: true, rule: 'gate#backend-build' }),
        finding({ severity: 'should', autoFixable: true, rule: 'docs.rules#tone' }),
      ],
      attemptsSoFar: 0,
      maxFixAttempts: 3,
      fixAdvisory: true,
    });

    expect(decision.kind).toBe('MERGE');
    expect(decision.advisoryFindings).toHaveLength(2);
  });

  it('still allows an advisory fix one short of the limit', () => {
    const decision = decidePipelineOutcome({
      findings: [fixableAdvisory()],
      attemptsSoFar: 2,
      maxFixAttempts: 3,
      fixAdvisory: true,
    });

    expect(decision.kind).toBe('FIX');
  });
});
