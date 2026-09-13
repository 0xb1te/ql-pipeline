import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  allReviewDocumentPaths,
  formatStandardsForPrompt,
  resolveStandards,
  reviewPackEntries,
  standardsIds,
  truncateAtSection,
  type StandardsReader,
} from '../../src/standards/standards-resolver.js';
import type { StandardsConfig } from '../../src/shared/types.js';

const ROOT = '/workspace';

function config(overrides: Partial<StandardsConfig> = {}): StandardsConfig {
  return {
    enabled: true,
    root: '.standards',
    docs: {},
    maxCharsPerArea: 90_000,
    ...overrides,
  };
}

function reader(files: Record<string, string>): StandardsReader {
  return {
    exists: vi.fn((path: string) => Promise.resolve(path in files)),
    read: vi.fn((path: string) => Promise.resolve(files[path] ?? '')),
  };
}

const at = (docPath: string): string => join(ROOT, '.standards', docPath);

describe('reviewPackEntries', () => {
  it('always includes the type checklist plus one file per area', () => {
    expect(reviewPackEntries('pr-feature', ['frontend', 'backend'])).toEqual([
      { id: 'review.standards', area: null, docPath: 'workflow/review/pr-feature/checklist.md' },
      { id: 'frontend.standards', area: 'frontend', docPath: 'workflow/review/pr-feature/frontend.md' },
      { id: 'backend.standards', area: 'backend', docPath: 'workflow/review/pr-feature/backend.md' },
    ]);
  });

  it('lists every pack file a local checkout must carry', () => {
    expect(allReviewDocumentPaths()).toContain('workflow/review/pr-fix/checklist.md');
    expect(allReviewDocumentPaths()).toContain('workflow/review/pr-bugfix/docs.md');
  });
});

describe('resolveStandards', () => {
  it('loads the convention pack, not standards.docs', async () => {
    const files = reader({
      [at('workflow/review/pr-feature/checklist.md')]: '# Type rules',
      [at('workflow/review/pr-feature/frontend.md')]: '# Frontend checklist',
    });

    const { standards } = await resolveStandards(['frontend'], config(), ROOT, files, 'pr-feature');

    expect(standardsIds(standards)).toEqual(['review.standards', 'frontend.standards']);
    expect(standards[0]?.text).toContain('# Type rules');
    expect(standards[1]?.text).toContain('# Frontend checklist');
  });

  it('uses the kind to pick pr-fix vs pr-feature', async () => {
    const files = reader({
      [at('workflow/review/pr-fix/checklist.md')]: 'HOTFIX RULES',
      [at('workflow/review/pr-fix/backend.md')]: 'BE',
    });

    const { standards } = await resolveStandards(['backend'], config(), ROOT, files, 'pr-fix');

    expect(standards[0]?.docPath).toBe('workflow/review/pr-fix/checklist.md');
    expect(standards[0]?.text).toContain('HOTFIX RULES');
  });

  it('reports a pack file that is not present, rather than silently skipping it', async () => {
    const files = reader({});

    const { standards, missing } = await resolveStandards(['frontend'], config(), ROOT, files, 'pr-feature');

    expect(standards).toEqual([]);
    expect(missing).toEqual([
      'workflow/review/pr-feature/checklist.md',
      'workflow/review/pr-feature/frontend.md',
    ]);
  });

  it('still applies the documents it does find when only some are missing', async () => {
    const files = reader({ [at('workflow/review/pr-bugfix/checklist.md')]: 'TYPE' });

    const { standards, missing } = await resolveStandards(['backend'], config(), ROOT, files, 'pr-bugfix');

    expect(standards).toHaveLength(1);
    expect(missing).toEqual(['workflow/review/pr-bugfix/backend.md']);
  });

  it('loads nothing at all when standards are disabled', async () => {
    const files = reader({ [at('workflow/review/pr-feature/frontend.md')]: 'FE' });

    expect(await resolveStandards(['frontend'], config({ enabled: false }), ROOT, files)).toEqual({
      standards: [],
      missing: [],
    });
    expect(files.exists).not.toHaveBeenCalled();
  });

  it('marks a document truncated when it exceeds the per-area budget', async () => {
    const huge = `## 01 — First\n${'x'.repeat(500)}\n## 02 — Second\n${'y'.repeat(500)}`;
    const files = reader({
      [at('workflow/review/pr-feature/checklist.md')]: 'ok',
      [at('workflow/review/pr-feature/frontend.md')]: huge,
    });

    const { standards } = await resolveStandards(
      ['frontend'],
      config({ maxCharsPerArea: 400 }),
      ROOT,
      files,
      'pr-feature',
    );

    expect(standards.find((item) => item.id === 'frontend.standards')?.truncated).toBe(true);
  });
});

describe('truncateAtSection', () => {
  it('leaves text within budget untouched', () => {
    expect(truncateAtSection('short', 100)).toEqual({ text: 'short', truncated: false });
  });

  it('cuts on a section boundary so no rule is left half-quoted', () => {
    const text = `## 01 — First\nalpha\n## 02 — Second\nbeta`;

    const result = truncateAtSection(text, text.indexOf('## 02') + 10);

    expect(result.truncated).toBe(true);
    expect(result.text).toContain('## 01 — First');
    expect(result.text).not.toContain('## 02 — Second');
  });

  it('falls back to a hard cut when there is no section boundary to cut on', () => {
    const result = truncateAtSection('a'.repeat(100), 10);

    expect(result.truncated).toBe(true);
    expect(result.text).toContain('truncated');
  });
});

describe('formatStandardsForPrompt', () => {
  it('says so plainly when no standards apply', () => {
    expect(formatStandardsForPrompt([])).toContain('no engineering standards are configured');
  });

  it('tells the reviewer exactly how to cite each document', async () => {
    const files = reader({
      [at('workflow/review/pr-feature/checklist.md')]: 'TYPE',
      [at('workflow/review/pr-feature/frontend.md')]: 'FE RULES',
    });
    const { standards } = await resolveStandards(['frontend'], config(), ROOT, files, 'pr-feature');

    const text = formatStandardsForPrompt(standards);

    expect(text).toContain('frontend.standards');
    expect(text).toContain('`frontend.standards#<section>`');
    expect(text).toContain('FE RULES');
    expect(text).toContain('review.standards');
  });
});
