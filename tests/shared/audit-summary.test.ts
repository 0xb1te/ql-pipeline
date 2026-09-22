import { describe, expect, it } from 'vitest';
import { formatAuditSummary, type AuditSummaryInput } from '../../src/shared/audit-summary.js';
import type { Finding, GateOutcome } from '../../src/shared/types.js';

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
      input({ decision: { kind: 'BLOCK', reason: 'not auto-fixable', findings: [], advisoryFindings: [] }, attemptNumber: 3 }),
    );
    const fixed = formatAuditSummary(input({ decision: { kind: 'FIX', findings: [], advisoryFindings: [] } }));

    expect(blocked).toContain('> not auto-fixable');
    expect(fixed).not.toContain('>');
  });
});

describe('formatAuditSummary — standards coverage', () => {
  it('says nothing when the standards were sent whole', () => {
    // The common case stays quiet; a coverage line every run would be noise.
    expect(formatAuditSummary(input())).not.toContain('**Standards coverage:**');
  });

  it('reports what the per-area cap dropped, so `Findings: 0` is readable', () => {
    const summary = formatAuditSummary(
      input({
        standardsCoverage: [{ id: 'frontend.standards', keptSections: 34, droppedSections: 30, droppedChars: 52_112 }],
      }),
    );

    expect(summary).toContain('**Standards coverage:**');
    expect(summary).toContain('frontend.standards — 34 of 64 sections');
    expect(summary).toContain('30 dropped (52112 chars) by the per-area cap');
  });

  it('reports the prompt ceiling as a further cut on top of the cap', () => {
    const summary = formatAuditSummary(
      input({
        standardsCoverage: [{ id: 'frontend.standards', keptSections: 34, droppedSections: 30, droppedChars: 52_112 }],
        promptCoverage: { droppedSections: 6, droppedChars: 18_344, omitted: false },
      }),
    );

    expect(summary).toContain('the prompt ceiling cut a further 6 sections (18344 chars)');
  });

  it('is emphatic when the diff crowded the standards out completely', () => {
    const summary = formatAuditSummary(
      input({ promptCoverage: { droppedSections: 64, droppedChars: 132_112, omitted: true } }),
    );

    expect(summary).toContain('**no engineering standards were sent at all**');
  });

  it('puts coverage above the finding count, which is what it qualifies', () => {
    const summary = formatAuditSummary(
      input({ standardsCoverage: [{ id: 'frontend.standards', keptSections: 1, droppedSections: 1, droppedChars: 10 }] }),
    );

    expect(summary.indexOf('**Standards coverage:**')).toBeLessThan(summary.indexOf('**Findings:**'));
  });
});

describe('formatAuditSummary — a FIX verdict announces the attempt', () => {
  const RUN = 'https://github.com/0xb1te/ql-pipeline/actions/runs/42';

  const finding: Finding = {
    severity: 'must',
    rule: 'review.standards#MUST',
    file: 'src/a.ts',
    line: 1,
    problem: 'wrong',
    suggestedFix: null,
    autoFixable: true,
  };

  const fix = (overrides: Partial<AuditSummaryInput> = {}): AuditSummaryInput =>
    input({
      findingCount: 1,
      decision: { kind: 'FIX', findings: [finding], advisoryFindings: [] },
      ...overrides,
    });

  it('says a fix agent is running, instead of leaving it to be inferred from the verdict', () => {
    // `Decision: FIX` was already the only pre-fix signal on the pull request, because this
    // comment is posted before runFix is called. It never read as one.
    const summary = formatAuditSummary(fix({ runUrl: RUN }));

    expect(summary).toContain('**Decision:** FIX (attempt 1 of 3)');
    expect(summary).toMatch(/fix agent/i);
  });

  it('links the run, which is the only place the attempt can be watched', () => {
    expect(formatAuditSummary(fix({ runUrl: RUN }))).toContain(RUN);
  });

  it('warns that a push cancels the attempt in flight', () => {
    // Consumers set concurrency.cancel-in-progress, so pushing while a fix runs kills it
    // silently. Announcing an attempt without saying that would be a worse comment than none.
    expect(formatAuditSummary(fix({ runUrl: RUN }))).toMatch(/cancel/i);
  });

  it('still announces the attempt when there is no run to link', () => {
    const summary = formatAuditSummary(fix({ runUrl: null }));

    expect(summary).toMatch(/fix agent/i);
    expect(summary).not.toContain('actions/runs');
    expect(summary).not.toContain('undefined');
    expect(summary).not.toContain('null');
  });

  it('says nothing about a fix agent on MERGE or BLOCK', () => {
    expect(formatAuditSummary(input({ runUrl: RUN }))).not.toMatch(/fix agent/i);

    const blocked = input({
      runUrl: RUN,
      decision: { kind: 'BLOCK', reason: 'needs a human', findings: [finding], advisoryFindings: [] },
    });

    expect(formatAuditSummary(blocked)).not.toMatch(/fix agent/i);
  });
});
