import { describe, expect, it } from 'vitest';

import { dedupeFindings, planReviewPasses, standardCost } from '../../src/reviewer/review-passes.js';
import type { ResolvedStandard } from '../../src/standards/standards-resolver.js';
import type { Finding } from '../../src/shared/types.js';

function doc(id: string, docPath: string, chars: number, area: 'frontend' | null = 'frontend'): ResolvedStandard {
  return {
    id,
    area,
    docPath,
    text: 'x'.repeat(chars),
    truncated: false,
    droppedSections: [],
    droppedChars: 0,
  };
}

const CHECKLIST = doc('review.standards', 'workflow/review/pr-bugfix/checklist.md', 1_400, null);

describe('planReviewPasses', () => {
  it('runs a single pass when everything fits — the common case is unchanged', () => {
    const standards = [CHECKLIST, doc('frontend.standards', 'frontend.md', 10_000)];

    const passes = planReviewPasses(standards, 100_000);

    expect(passes).toHaveLength(1);
    expect(passes[0]?.standards).toEqual(standards);
  });

  it('keeps two areas in ONE pass when they both fit', () => {
    // Paying for a second agent call here would buy nothing: the single-pass
    // prompt already carries both documents whole.
    const standards = [CHECKLIST, doc('frontend.standards', 'frontend.md', 10_000), doc('backend.standards', 'backend.md', 10_000)];

    expect(planReviewPasses(standards, 100_000)).toHaveLength(1);
  });

  it('splits into as many passes as the budget needs', () => {
    const standards = [
      CHECKLIST,
      doc('frontend.standards', 'frontend-1.md', 40_000),
      doc('frontend.standards', 'frontend-2.md', 40_000),
      doc('frontend.standards', 'frontend-3.md', 40_000),
    ];

    const passes = planReviewPasses(standards, 60_000);

    expect(passes).toHaveLength(3);
    expect(passes.map((p) => p.standards.map((s) => s.docPath))).toEqual([
      ['workflow/review/pr-bugfix/checklist.md', 'frontend-1.md'],
      ['workflow/review/pr-bugfix/checklist.md', 'frontend-2.md'],
      ['workflow/review/pr-bugfix/checklist.md', 'frontend-3.md'],
    ]);
  });

  it('packs greedily rather than one document per pass', () => {
    const standards = [
      CHECKLIST,
      doc('frontend.standards', 'frontend-1.md', 20_000),
      doc('frontend.standards', 'frontend-2.md', 20_000),
      doc('backend.standards', 'backend.md', 20_000),
    ];

    // Room for two documents per pass, so three documents take two passes.
    const passes = planReviewPasses(standards, 45_000);

    expect(passes).toHaveLength(2);
    expect(passes[0]?.standards).toHaveLength(3);
    expect(passes[1]?.standards).toHaveLength(2);
  });

  it('carries the shared checklist into every pass', () => {
    const standards = [
      CHECKLIST,
      doc('frontend.standards', 'frontend-1.md', 40_000),
      doc('frontend.standards', 'frontend-2.md', 40_000),
    ];

    const passes = planReviewPasses(standards, 60_000);

    // A pass judged without the review checklist would be judged against a
    // different standard than its siblings.
    for (const pass of passes) {
      expect(pass.standards[0]).toBe(CHECKLIST);
    }
  });

  it('gives an oversized document its own pass rather than dropping it', () => {
    const standards = [CHECKLIST, doc('frontend.standards', 'huge.md', 500_000), doc('backend.standards', 'backend.md', 1_000)];

    const passes = planReviewPasses(standards, 50_000);

    // Planning cannot rescue a document bigger than a whole prompt; it goes
    // alone and truncation reporting says what it lost.
    expect(passes).toHaveLength(2);
    expect(passes[0]?.standards.map((s) => s.docPath)).toContain('huge.md');
    expect(passes[1]?.standards.map((s) => s.docPath)).toContain('backend.md');
  });

  it('still returns one pass when there are no standards at all', () => {
    expect(planReviewPasses([], 50_000)).toEqual([{ standards: [] }]);
  });

  it('returns one pass when only the shared checklist applies', () => {
    const passes = planReviewPasses([CHECKLIST], 50_000);

    expect(passes).toHaveLength(1);
    expect(passes[0]?.standards).toEqual([CHECKLIST]);
  });

  it('charges each document what the prompt will actually carry', () => {
    const standard = doc('frontend.standards', 'frontend.md', 1_000);

    // Body plus the citation header the formatter prepends, not just the body.
    expect(standardCost(standard)).toBeGreaterThan(1_000);
  });
});

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: 'must',
    rule: 'frontend.standards#01-components',
    file: 'src/app.tsx',
    line: 42,
    problem: 'problem',
    suggestedFix: null,
    autoFixable: false,
    ...overrides,
  };
}

describe('dedupeFindings', () => {
  it('reports a defect once when two passes both see it', () => {
    const merged = dedupeFindings([finding(), finding()]);

    expect(merged).toHaveLength(1);
  });

  it('keeps two different rules broken on the same line', () => {
    // A key of file:line alone would silently swallow the second.
    const merged = dedupeFindings([finding(), finding({ rule: 'frontend.standards#15-auth' })]);

    expect(merged).toHaveLength(2);
  });

  it('keeps the same rule broken on different lines', () => {
    expect(dedupeFindings([finding(), finding({ line: 99 })])).toHaveLength(2);
  });

  it('keeps the same rule broken in different files', () => {
    expect(dedupeFindings([finding(), finding({ file: 'src/other.tsx' })])).toHaveLength(2);
  });

  it('preserves the first occurrence and its order', () => {
    const first = finding({ problem: 'first' });
    const second = finding({ file: 'src/b.tsx', problem: 'second' });

    expect(dedupeFindings([first, second, finding({ problem: 'duplicate' })])).toEqual([first, second]);
  });

  it('passes an empty list through', () => {
    expect(dedupeFindings([])).toEqual([]);
  });
});
