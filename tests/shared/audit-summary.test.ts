import { describe, expect, it } from 'vitest';
import { formatAuditSummary } from '../../src/shared/audit-summary.js';
import type { GateOutcome } from '../../src/shared/types.js';

describe('formatAuditSummary', () => {
  it('includes areas, findings count, and decision for a MERGE', () => {
    const summary = formatAuditSummary({
      areas: ['frontend'],
      gateOutcomes: [],
      findingCount: 0,
      decision: { kind: 'MERGE', advisoryFindings: [] },
      attemptNumber: 1,
      maxFixAttempts: 3,
    });

    expect(summary).toContain('**Areas:** frontend');
    expect(summary).toContain('**Findings:** 0');
    expect(summary).toContain('**Decision:** MERGE (attempt 1 of 3)');
  });

  it('omits the Gates section entirely when there are no gate outcomes', () => {
    const summary = formatAuditSummary({
      areas: ['docs'],
      gateOutcomes: [],
      findingCount: 0,
      decision: { kind: 'MERGE', advisoryFindings: [] },
      attemptNumber: 1,
      maxFixAttempts: 3,
    });

    expect(summary).not.toContain('**Gates:**');
  });

  it('lists each gate outcome as passed or failed', () => {
    const gateOutcomes: GateOutcome[] = [
      { area: 'backend', gate: 'build', command: 'npm run build', passed: true, output: '' },
      { area: 'backend', gate: 'test', command: 'npm test', passed: false, output: 'boom' },
    ];

    const summary = formatAuditSummary({
      areas: ['backend'],
      gateOutcomes,
      findingCount: 1,
      decision: { kind: 'FIX', findings: [] },
      attemptNumber: 1,
      maxFixAttempts: 3,
    });

    expect(summary).toContain('- backend/build: passed');
    expect(summary).toContain('- backend/test: failed');
  });

  it('includes the reason as a blockquote for BLOCK, and only for BLOCK', () => {
    const blocked = formatAuditSummary({
      areas: ['backend'],
      gateOutcomes: [],
      findingCount: 1,
      decision: { kind: 'BLOCK', reason: 'not auto-fixable', findings: [] },
      attemptNumber: 3,
      maxFixAttempts: 3,
    });
    const fixed = formatAuditSummary({
      areas: ['backend'],
      gateOutcomes: [],
      findingCount: 1,
      decision: { kind: 'FIX', findings: [] },
      attemptNumber: 1,
      maxFixAttempts: 3,
    });

    expect(blocked).toContain('> not auto-fixable');
    expect(fixed).not.toContain('>');
  });
});
