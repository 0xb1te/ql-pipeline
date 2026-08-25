import { describe, expect, it } from 'vitest';
import { formatAuditSummary, type AuditSummaryInput } from '../../src/shared/audit-summary.js';
import type { GateOutcome } from '../../src/shared/types.js';

function input(overrides: Partial<AuditSummaryInput> = {}): AuditSummaryInput {
  return {
    areas: ['frontend'],
    gateOutcomes: [],
    findingCount: 0,
    decision: { kind: 'MERGE', advisoryFindings: [] },
    attemptNumber: 1,
    maxFixAttempts: 3,
    targetBranch: 'main',
    reviewRan: true,
    ...overrides,
  };
}

describe('formatAuditSummary', () => {
  it('includes areas, target branch, findings count, and decision for a MERGE', () => {
    const summary = formatAuditSummary(input());

    expect(summary).toContain('**Areas:** frontend');
    expect(summary).toContain('**Target branch:** main');
    expect(summary).toContain('**Findings:** 0');
    expect(summary).toContain('**Decision:** MERGE (attempt 1 of 3)');
  });

  it('records whether the AI review actually ran', () => {
    expect(formatAuditSummary(input({ reviewRan: true }))).toContain('**AI review:** ran');
    expect(formatAuditSummary(input({ reviewRan: false }))).toContain('**AI review:** skipped');
  });

  it('omits the Gates section entirely when there are no gate outcomes', () => {
    expect(formatAuditSummary(input({ areas: ['docs'] }))).not.toContain('**Gates:**');
  });

  it('lists each gate outcome as passed or failed', () => {
    const gateOutcomes: GateOutcome[] = [
      { area: 'backend', gate: 'build', command: 'npm run build', passed: true, output: '' },
      { area: 'backend', gate: 'test', command: 'npm test', passed: false, output: 'boom' },
    ];

    const summary = formatAuditSummary(input({ areas: ['backend'], gateOutcomes, findingCount: 1 }));

    expect(summary).toContain('- backend/build: passed');
    expect(summary).toContain('- backend/test: failed');
  });

  it('includes the reason as a blockquote for BLOCK, and only for BLOCK', () => {
    const blocked = formatAuditSummary(
      input({ decision: { kind: 'BLOCK', reason: 'not auto-fixable', findings: [] }, attemptNumber: 3 }),
    );
    const fixed = formatAuditSummary(input({ decision: { kind: 'FIX', findings: [] } }));

    expect(blocked).toContain('> not auto-fixable');
    expect(fixed).not.toContain('>');
  });
});
