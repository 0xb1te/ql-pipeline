import { describe, expect, it } from 'vitest';
import { gateFindings, isReviewRequired } from '../../src/verdict/required-checks.js';
import { decidePipelineOutcome } from '../../src/verdict/verdict.js';
import type { GateOutcome } from '../../src/shared/types.js';

const failedBuild: GateOutcome = {
  area: 'backend',
  gate: 'build',
  command: 'npm run build',
  passed: false,
  output: 'tsc error',
};
const failedTest: GateOutcome = {
  area: 'backend',
  gate: 'test',
  command: 'npm test',
  passed: false,
  output: '3 failing',
};
const passedBuild: GateOutcome = { ...failedBuild, passed: true, output: '' };

describe('isReviewRequired', () => {
  it('is true when ai-review is a required check', () => {
    expect(isReviewRequired(['build', 'test', 'ai-review'])).toBe(true);
  });

  it('is false when ai-review is not required, so the review is skipped rather than ignored', () => {
    expect(isReviewRequired(['build', 'test'])).toBe(false);
  });

  it('is false for an empty required-checks list', () => {
    expect(isReviewRequired([])).toBe(false);
  });
});

describe('gateFindings', () => {
  it('produces nothing when every gate passed', () => {
    expect(gateFindings([passedBuild], ['build', 'test'])).toEqual([]);
  });

  it('produces nothing at all when there were no gates', () => {
    expect(gateFindings([], ['build', 'test'])).toEqual([]);
  });

  it('marks a failed required gate as blocking', () => {
    const [finding] = gateFindings([failedBuild], ['build', 'test', 'ai-review']);

    expect(finding?.severity).toBe('must');
    expect(finding?.rule).toBe('gate#backend-build');
    expect(finding?.autoFixable).toBe(true);
  });

  it('downgrades a failed gate whose stage is not required to advisory', () => {
    const [finding] = gateFindings([failedBuild], ['test', 'ai-review']);

    expect(finding?.severity).toBe('should');
  });

  it('judges each stage independently when only one of them is required', () => {
    const findings = gateFindings([failedBuild, failedTest], ['test']);

    expect(findings.map((finding) => [finding.rule, finding.severity])).toEqual([
      ['gate#backend-build', 'should'],
      ['gate#backend-test', 'must'],
    ]);
  });

  it('includes the failing command and its output in the problem text', () => {
    const [finding] = gateFindings([failedBuild], ['build']);

    expect(finding?.problem).toContain('npm run build');
    expect(finding?.problem).toContain('tsc error');
  });
});

describe('required checks end to end through the verdict engine', () => {
  it('a failed required gate blocks the merge', () => {
    const decision = decidePipelineOutcome({
      findings: gateFindings([failedBuild], ['build', 'test', 'ai-review']),
      attemptsSoFar: 0,
      maxFixAttempts: 3,
    });

    expect(decision.kind).toBe('FIX');
  });

  it('a failed non-required gate rides along as advisory and still merges', () => {
    const decision = decidePipelineOutcome({
      findings: gateFindings([failedBuild], ['ai-review']),
      attemptsSoFar: 0,
      maxFixAttempts: 3,
    });

    expect(decision.kind).toBe('MERGE');
    if (decision.kind === 'MERGE') {
      expect(decision.advisoryFindings).toHaveLength(1);
    }
  });
});
