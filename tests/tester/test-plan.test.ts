import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTestPlan, TestPlanError } from '../../src/tester/test-plan.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const templateBytes = (): Buffer => readFileSync(join(FIXTURES, 'template-plan.xlsx'));
/** The ql-docs task folder for the contract itself: MCP Cases present, deliberately empty. */
const emptyPlanBytes = (): Buffer => readFileSync(join(FIXTURES, 'complete-plan.xlsx'));

describe('parseTestPlan', () => {
  it('reads every case out of a real openpyxl workbook', () => {
    const cases = parseTestPlan(templateBytes());
    expect(cases).toHaveLength(4);
    expect(cases.map((c) => c.caseId)).toEqual(['TASK000-1', 'TASK000-2', 'TASK000-3', 'TASK000-4']);
  });

  it('parses the Input cell as JSON', () => {
    const [first] = parseTestPlan(templateBytes());
    expect(first?.input).toEqual({ categoryId: 'cat-empty' });
  });

  it('carries the row number, so a finding can say where to go and fix it', () => {
    const [first] = parseTestPlan(templateBytes());
    expect(first?.row).toBe(2);
  });

  it('reads severity, including the advisory ones', () => {
    const cases = parseTestPlan(templateBytes());
    expect(cases.map((c) => c.severity)).toEqual(['blocker', 'blocker', 'major', 'minor']);
  });

  it('accepts a sheet with no data rows — that is a task saying it has no MCP surface', () => {
    // Deliberately not an error: ql-docs makes absent and empty mean different things, and
    // reading them the same way would force a lie into one of the two.
    expect(parseTestPlan(emptyPlanBytes())).toEqual([]);
  });

  it('throws on a file that is not a workbook rather than reporting zero cases', () => {
    expect(() => parseTestPlan(Buffer.from('nope'))).toThrow(TestPlanError);
  });
});
