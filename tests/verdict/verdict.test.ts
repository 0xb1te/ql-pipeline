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

    expect(result).toEqual({ kind: 'FIX', findings: [mustFinding] });
  });

  it('requests a fix for a single auto-fixable `security` finding with attempts remaining', () => {
    const securityFinding = finding({ severity: 'security', autoFixable: true });

    const result = decidePipelineOutcome({ findings: [securityFinding], attemptsSoFar: 0, maxFixAttempts: 3 });

    expect(result).toEqual({ kind: 'FIX', findings: [securityFinding] });
  });

  it('drops `should` findings from the FIX findings list, keeping only blocking ones', () => {
    const mustFinding = finding({ severity: 'must', autoFixable: true });
    const shouldFinding = finding({ severity: 'should', rule: 'frontend.rules#prefer-composition' });

    const result = decidePipelineOutcome({
      findings: [shouldFinding, mustFinding],
      attemptsSoFar: 0,
      maxFixAttempts: 3,
    });

    expect(result).toEqual({ kind: 'FIX', findings: [mustFinding] });
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

    expect(result).toEqual({ kind: 'FIX', findings: [mustFinding] });
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
