import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  formatStandardsForPrompt,
  resolveStandards,
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
    docs: {
      frontend: ['workflow/stage-5-frontend/checklist.md'],
      backend: ['workflow/stage-4-backend/backend/checklist.md', 'workflow/stage-4-backend/sql/checklist.md'],
    },
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

describe('resolveStandards', () => {
  it('loads the configured document for a matched area', async () => {
    const files = reader({ [at('workflow/stage-5-frontend/checklist.md')]: '# Frontend checklist' });

    const { standards } = await resolveStandards(['frontend'], config(), ROOT, files);

    expect(standards).toHaveLength(1);
    expect(standards[0]).toMatchObject({ id: 'frontend.standards', area: 'frontend', truncated: false });
    expect(standards[0]?.text).toContain('# Frontend checklist');
  });

  it('concatenates several documents for one area, labelling each source', async () => {
    const files = reader({
      [at('workflow/stage-4-backend/backend/checklist.md')]: 'BACKEND RULES',
      [at('workflow/stage-4-backend/sql/checklist.md')]: 'SQL RULES',
    });

    const { standards } = await resolveStandards(['backend'], config(), ROOT, files);

    expect(standards[0]?.text).toContain('BACKEND RULES');
    expect(standards[0]?.text).toContain('SQL RULES');
    expect(standards[0]?.text).toContain('workflow/stage-4-backend/sql/checklist.md');
  });

  it('returns one entry per area for a PR spanning several', async () => {
    const files = reader({
      [at('workflow/stage-5-frontend/checklist.md')]: 'FE',
      [at('workflow/stage-4-backend/backend/checklist.md')]: 'BE',
      [at('workflow/stage-4-backend/sql/checklist.md')]: 'SQL',
    });

    const { standards } = await resolveStandards(['frontend', 'backend'], config(), ROOT, files);

    expect(standardsIds(standards)).toEqual(['frontend.standards', 'backend.standards']);
  });

  it('reports a configured document that is not checked out, rather than silently skipping it', async () => {
    const files = reader({});

    const { standards, missing } = await resolveStandards(['frontend'], config(), ROOT, files);

    expect(standards).toEqual([]);
    expect(missing).toEqual(['workflow/stage-5-frontend/checklist.md']);
  });

  it('still applies the documents it does find when only some are missing', async () => {
    const files = reader({ [at('workflow/stage-4-backend/backend/checklist.md')]: 'BE' });

    const { standards, missing } = await resolveStandards(['backend'], config(), ROOT, files);

    expect(standards).toHaveLength(1);
    expect(missing).toEqual(['workflow/stage-4-backend/sql/checklist.md']);
  });

  it('loads nothing at all when standards are disabled', async () => {
    const files = reader({ [at('workflow/stage-5-frontend/checklist.md')]: 'FE' });

    expect(await resolveStandards(['frontend'], config({ enabled: false }), ROOT, files)).toEqual({
      standards: [],
      missing: [],
    });
    expect(files.exists).not.toHaveBeenCalled();
  });

  it('skips an area that has no documents configured', async () => {
    const files = reader({});

    const { standards, missing } = await resolveStandards(['docs'], config(), ROOT, files);

    expect(standards).toEqual([]);
    expect(missing).toEqual([]);
  });

  it('marks a document truncated when it exceeds the per-area budget', async () => {
    const huge = `## 01 — First\n${'x'.repeat(500)}\n## 02 — Second\n${'y'.repeat(500)}`;
    const files = reader({ [at('workflow/stage-5-frontend/checklist.md')]: huge });

    const { standards } = await resolveStandards(['frontend'], config({ maxCharsPerArea: 400 }), ROOT, files);

    expect(standards[0]?.truncated).toBe(true);
    expect(standards[0]?.text).toContain('truncated');
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
    const files = reader({ [at('workflow/stage-5-frontend/checklist.md')]: 'FE RULES' });
    const { standards } = await resolveStandards(['frontend'], config(), ROOT, files);

    const text = formatStandardsForPrompt(standards);

    expect(text).toContain('frontend.standards');
    expect(text).toContain('`frontend.standards#<section>`');
    expect(text).toContain('FE RULES');
  });
});
