import { describe, expect, it } from 'vitest';
import {
  MAX_OUTPUT_CHARS,
  mergeGateReports,
  parseGateReport,
  serializeGateReport,
  truncateOutput,
  type GateReport,
} from '../../src/shared/gate-report.js';
import type { GateOutcome } from '../../src/shared/types.js';

function outcome(overrides: Partial<GateOutcome> = {}): GateOutcome {
  return {
    area: 'backend',
    gate: 'test',
    command: 'npm test',
    passed: false,
    output: '3 failing',
    ...overrides,
  };
}

describe('truncateOutput', () => {
  it('leaves short output untouched', () => {
    expect(truncateOutput('short', 100)).toBe('short');
  });

  it('keeps the tail, where compilers and test runners put the errors', () => {
    const long = `${'x'.repeat(50)}ERROR AT THE END`;

    const result = truncateOutput(long, 20);

    expect(result).toContain('ERROR AT THE END');
    expect(result).toContain('characters truncated');
  });

  it('defaults to the shared cap', () => {
    expect(truncateOutput('y'.repeat(MAX_OUTPUT_CHARS + 10)).length).toBeLessThan(MAX_OUTPUT_CHARS + 100);
  });
});

describe('serializeGateReport / parseGateReport', () => {
  it('round-trips a report', () => {
    const report: GateReport = { stage: 'test', outcomes: [outcome()] };

    const parsed = parseGateReport(serializeGateReport(report));

    expect(parsed).toEqual({ ok: true, report });
  });

  it('round-trips an empty report, which means "this stage ran and had nothing to do"', () => {
    const parsed = parseGateReport(serializeGateReport({ stage: 'build', outcomes: [] }));

    expect(parsed).toEqual({ ok: true, report: { stage: 'build', outcomes: [] } });
  });

  it('truncates oversized output on the way out', () => {
    const report: GateReport = { stage: 'test', outcomes: [outcome({ output: 'z'.repeat(MAX_OUTPUT_CHARS * 2) })] };

    const parsed = parseGateReport(serializeGateReport(report));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.report.outcomes[0]!.output).toContain('characters truncated');
    }
  });

  it('rejects malformed JSON rather than assuming the gates passed', () => {
    const parsed = parseGateReport('{not json');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toContain('not valid JSON');
    }
  });

  it('rejects a non-object report', () => {
    expect(parseGateReport('[]').ok).toBe(false);
  });

  it('rejects an unknown stage', () => {
    expect(parseGateReport('{"stage":"lint","outcomes":[]}').ok).toBe(false);
  });

  it('rejects a non-array outcomes field', () => {
    expect(parseGateReport('{"stage":"test","outcomes":"none"}').ok).toBe(false);
  });

  it('rejects an outcome whose gate disagrees with the report stage', () => {
    const mismatched = JSON.stringify({ stage: 'test', outcomes: [{ ...outcome(), gate: 'build' }] });

    const parsed = parseGateReport(mismatched);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toMatch(/must match the report stage/);
    }
  });

  it('rejects an outcome missing its passed flag', () => {
    const missing = JSON.stringify({
      stage: 'test',
      outcomes: [{ area: 'backend', gate: 'test', command: 'npm test', output: '' }],
    });

    expect(parseGateReport(missing).ok).toBe(false);
  });

  it('rejects an outcome that is not an object', () => {
    expect(parseGateReport('{"stage":"test","outcomes":["oops"]}').ok).toBe(false);
  });

  it('rejects an outcome with a missing area', () => {
    const bad = JSON.stringify({ stage: 'test', outcomes: [{ ...outcome(), area: '' }] });

    expect(parseGateReport(bad).ok).toBe(false);
  });

  it('rejects an outcome whose command is not a string', () => {
    const bad = JSON.stringify({ stage: 'test', outcomes: [{ ...outcome(), command: 42 }] });

    expect(parseGateReport(bad).ok).toBe(false);
  });

  it('rejects an outcome whose output is not a string', () => {
    const bad = JSON.stringify({ stage: 'test', outcomes: [{ ...outcome(), output: null }] });

    expect(parseGateReport(bad).ok).toBe(false);
  });
});

describe('mergeGateReports', () => {
  it('orders test outcomes before build outcomes, matching the check order', () => {
    const merged = mergeGateReports([
      { stage: 'build', outcomes: [outcome({ gate: 'build', command: 'npm run build' })] },
      { stage: 'test', outcomes: [outcome({ gate: 'test' })] },
    ]);

    expect(merged.map((o) => o.gate)).toEqual(['test', 'build']);
  });

  it('is empty when no stage reported', () => {
    expect(mergeGateReports([])).toEqual([]);
  });

  it('keeps every outcome from a stage that ran several areas', () => {
    const merged = mergeGateReports([
      {
        stage: 'test',
        outcomes: [outcome({ area: 'frontend' }), outcome({ area: 'backend' })],
      },
    ]);

    expect(merged.map((o) => o.area)).toEqual(['frontend', 'backend']);
  });
});
