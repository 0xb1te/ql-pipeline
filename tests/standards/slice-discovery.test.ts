import { describe, expect, it, vi } from 'vitest';

import { resolveStandards, type StandardsReader } from '../../src/standards/standards-resolver.js';
import type { StandardsConfig } from '../../src/shared/types.js';

const ROOT = '/workspace';

function config(overrides: Partial<StandardsConfig> = {}): StandardsConfig {
  return { enabled: true, root: '.standards', docs: {}, maxCharsPerArea: 90_000, ...overrides };
}

/** A reader backed by an explicit set of doc paths, relative to the root. */
function readerFor(present: readonly string[]): StandardsReader & { exists: ReturnType<typeof vi.fn> } {
  const has = (absolute: string): boolean => present.some((p) => absolute.replace(/\\/g, '/').endsWith(p));
  const exists = vi.fn((absolute: string): Promise<boolean> => Promise.resolve(has(absolute)));
  return {
    exists,
    read: (absolute: string): Promise<string> => {
      if (!has(absolute)) {
        throw new Error(`unexpected read: ${absolute}`);
      }
      return Promise.resolve(`body of ${absolute.replace(/\\/g, '/').split('/').slice(-1)[0]}`);
    },
  };
}

const CHECKLIST = 'workflow/review/pr-bugfix/checklist.md';

describe('slice discovery', () => {
  it('uses the whole document when it exists — unchanged behaviour', async () => {
    const reader = readerFor([CHECKLIST, 'workflow/review/pr-bugfix/frontend.md']);

    const { standards, missing } = await resolveStandards(['frontend'], config(), ROOT, reader, 'pr-bugfix');

    expect(missing).toEqual([]);
    expect(standards.map((s) => s.docPath)).toEqual([CHECKLIST, 'workflow/review/pr-bugfix/frontend.md']);
  });

  it('never probes for slices when the whole document is present', async () => {
    const reader = readerFor([CHECKLIST, 'workflow/review/pr-bugfix/frontend.md']);

    await resolveStandards(['frontend'], config(), ROOT, reader, 'pr-bugfix');

    // An area that fits pays nothing for a mechanism it does not use.
    expect(reader.exists.mock.calls.filter(([p]) => String(p).includes('frontend-'))).toHaveLength(0);
  });

  it('falls back to numbered slices, in order', async () => {
    const reader = readerFor([
      CHECKLIST,
      'workflow/review/pr-bugfix/frontend-1.md',
      'workflow/review/pr-bugfix/frontend-2.md',
      'workflow/review/pr-bugfix/frontend-3.md',
    ]);

    const { standards, missing } = await resolveStandards(['frontend'], config(), ROOT, reader, 'pr-bugfix');

    expect(missing).toEqual([]);
    expect(standards.map((s) => s.docPath)).toEqual([
      CHECKLIST,
      'workflow/review/pr-bugfix/frontend-1.md',
      'workflow/review/pr-bugfix/frontend-2.md',
      'workflow/review/pr-bugfix/frontend-3.md',
    ]);
  });

  it('gives every slice the area id, so slicing is invisible to citations', async () => {
    const reader = readerFor([CHECKLIST, 'workflow/review/pr-bugfix/frontend-1.md', 'workflow/review/pr-bugfix/frontend-2.md']);

    const { standards } = await resolveStandards(['frontend'], config(), ROOT, reader, 'pr-bugfix');

    const areaIds = standards.filter((s) => s.area === 'frontend').map((s) => s.id);
    expect(areaIds).toEqual(['frontend.standards', 'frontend.standards']);
  });

  it('stops at the first gap rather than skipping past it', async () => {
    // A missing -2 with a stray -3 present is a publishing mistake. Silently
    // reviewing 1 and 3 would hide it; stopping surfaces it as a short pack.
    const reader = readerFor([CHECKLIST, 'workflow/review/pr-bugfix/frontend-1.md', 'workflow/review/pr-bugfix/frontend-3.md']);

    const { standards } = await resolveStandards(['frontend'], config(), ROOT, reader, 'pr-bugfix');

    expect(standards.map((s) => s.docPath)).toEqual([CHECKLIST, 'workflow/review/pr-bugfix/frontend-1.md']);
  });

  it('reports the area as missing when neither the document nor a slice exists', async () => {
    const reader = readerFor([CHECKLIST]);

    const { standards, missing } = await resolveStandards(['frontend'], config(), ROOT, reader, 'pr-bugfix');

    // The missing path is the canonical one, so `doctor` still recognises it.
    expect(missing).toEqual(['workflow/review/pr-bugfix/frontend.md']);
    expect(standards.map((s) => s.docPath)).toEqual([CHECKLIST]);
  });

  it('does not look for slices of the shared checklist', async () => {
    const reader = readerFor(['workflow/review/pr-bugfix/frontend.md']);

    const { missing } = await resolveStandards(['frontend'], config(), ROOT, reader, 'pr-bugfix');

    expect(missing).toEqual([CHECKLIST]);
    expect(reader.exists.mock.calls.filter(([p]) => String(p).includes('checklist-'))).toHaveLength(0);
  });

  it('slices each area independently', async () => {
    const reader = readerFor([
      CHECKLIST,
      'workflow/review/pr-bugfix/frontend-1.md',
      'workflow/review/pr-bugfix/frontend-2.md',
      'workflow/review/pr-bugfix/backend.md',
    ]);

    const { standards } = await resolveStandards(['frontend', 'backend'], config(), ROOT, reader, 'pr-bugfix');

    expect(standards.map((s) => s.docPath)).toEqual([
      CHECKLIST,
      'workflow/review/pr-bugfix/frontend-1.md',
      'workflow/review/pr-bugfix/frontend-2.md',
      'workflow/review/pr-bugfix/backend.md',
    ]);
  });
});
