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

describe('formatComplaintSummary with findings that have nowhere to point', () => {
  it('renders them in full, because this body is the only place they can appear', () => {
    // Unlike the approval path, a blocking review posts one message. A finding left out of the
    // inline comments and out of this body is a finding the PR never reports at all - which is
    // worse than the 422 that filtering it prevents.
    const gate = finding({
      severity: 'must',
      rule: 'gate#backend-test',
      file: '(gate)',
      problem: 'backend test gate failed for command `npm test`:\n3 failing',
      suggestedFix: null,
    });

    const body = formatComplaintSummary([gate, finding()], 1, 3, [gate]);

    expect(body).toContain('gate#backend-test');
    expect(body).toContain('3 failing');
    expect(body).toContain('About this pull request rather than a line in it');
  });

  it('counts every finding, not just the ones that fitted in a margin', () => {
    const gate = finding({ file: '(gate)' });
    const body = formatComplaintSummary([gate, finding(), finding()], 1, 3, [gate]);

    expect(body).toContain('found 3 issue(s)');
  });

  it('says nothing extra when every finding has a line, so the ordinary review is unchanged', () => {
    const body = formatComplaintSummary([finding()], 1, 3, []);

    expect(body).not.toContain('About this pull request rather than a line in it');
    expect(body).toBe(formatComplaintSummary([finding()], 1, 3));
  });

  it('still shows a suggested fix when the unanchored finding carries one', () => {
    const task = finding({ file: '(task)', suggestedFix: 'open a ql-sprint task and link it' });
    const body = formatComplaintSummary([task], 2, 3, [task]);

    expect(body).toContain('Suggested fix: open a ql-sprint task and link it');
    expect(body).toContain('Attempt 2 of 3');
  });
});
