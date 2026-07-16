import { describe, expect, it } from 'vitest';
import { buildFixerPrompt, formatComplaintSummary, formatFindingsForPrompt } from '../../src/fixer/complaint.js';
import type { Finding } from '../../src/shared/types.js';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: 'security',
    rule: 'backend.rules#no-string-concat-sql',
    file: 'src/api/payments.ts',
    line: 12,
    problem: 'string-concatenated SQL allows injection',
    suggestedFix: 'use a parameterized query',
    autoFixable: true,
    ...overrides,
  };
}

describe('formatFindingsForPrompt', () => {
  it('formats a single finding with its suggested fix', () => {
    const text = formatFindingsForPrompt([finding()]);

    expect(text).toContain('1. [security] backend.rules#no-string-concat-sql');
    expect(text).toContain('File: src/api/payments.ts:12');
    expect(text).toContain('Problem: string-concatenated SQL allows injection');
    expect(text).toContain('Suggested fix: use a parameterized query');
  });

  it('shows a placeholder when there is no suggested fix', () => {
    const text = formatFindingsForPrompt([finding({ suggestedFix: null })]);

    expect(text).toContain('Suggested fix: (no suggested fix provided)');
  });

  it('numbers multiple findings in order', () => {
    const text = formatFindingsForPrompt([finding({ rule: 'r1' }), finding({ rule: 'r2' })]);

    expect(text).toContain('1. [security] r1');
    expect(text).toContain('2. [security] r2');
  });

  it('returns an empty string for no findings', () => {
    expect(formatFindingsForPrompt([])).toBe('');
  });
});

describe('buildFixerPrompt', () => {
  const TEMPLATE = 'Attempt {{ATTEMPT_NUMBER}} of {{MAX_ATTEMPTS}}.\n\n{{COMPLAINT}}';

  it('substitutes every placeholder', () => {
    const prompt = buildFixerPrompt(TEMPLATE, [finding()], 2, 3);

    expect(prompt).toContain('Attempt 2 of 3.');
    expect(prompt).toContain('backend.rules#no-string-concat-sql');
    expect(prompt).not.toContain('{{');
  });

  it('replaces every occurrence of a repeated placeholder', () => {
    const prompt = buildFixerPrompt('{{ATTEMPT_NUMBER}}/{{ATTEMPT_NUMBER}}', [], 1, 3);

    expect(prompt).toBe('1/1');
  });
});

describe('formatComplaintSummary', () => {
  it('mentions the finding count', () => {
    const summary = formatComplaintSummary([finding(), finding()], 1, 3);

    expect(summary).toContain('found 2 issue(s)');
  });

  it('says a fix attempt will follow when attempts remain', () => {
    const summary = formatComplaintSummary([finding()], 1, 3);

    expect(summary).toContain('Attempt 1 of 3');
    expect(summary).toContain('automated fix attempt will follow');
  });

  it('says a human is needed once attempts are exhausted', () => {
    const summary = formatComplaintSummary([finding()], 3, 3);

    expect(summary).toContain('Attempt 3 of 3');
    expect(summary).toContain('Max fix attempts (3) reached');
    expect(summary).toContain('needs a human');
  });
});
