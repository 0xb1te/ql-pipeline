import { describe, expect, it } from 'vitest';
import { areasFromPaths, matchesGlob } from '../../src/router/area-paths.js';
import type { AreaPathsConfig } from '../../src/shared/types.js';

/** The house monorepo convention, as shipped by default. */
const HOUSE: AreaPathsConfig = {
  frontend: ['apps/*frontend*/**'],
  backend: ['apps/*backend*/**'],
};

describe('matchesGlob', () => {
  it('matches a file nested under an apps/*frontend* directory', () => {
    expect(matchesGlob('apps/web-frontend/src/components/Widget.tsx', 'apps/*frontend*/**')).toBe(true);
  });

  it('matches regardless of what surrounds the marker in the directory name', () => {
    for (const dir of ['apps/frontend', 'apps/web-frontend', 'apps/frontend-admin', 'apps/my-frontend-app']) {
      expect(matchesGlob(`${dir}/src/x.ts`, 'apps/*frontend*/**')).toBe(true);
    }
  });

  it('matches the directory entry itself, not only files under it', () => {
    expect(matchesGlob('apps/web-frontend', 'apps/*frontend*/**')).toBe(true);
  });

  it('does not let a single star cross a path separator', () => {
    expect(matchesGlob('apps/team/web-frontend/src/x.ts', 'apps/*frontend*/**')).toBe(false);
  });

  it('does not match a different area', () => {
    expect(matchesGlob('apps/api-backend/src/Service.java', 'apps/*frontend*/**')).toBe(false);
  });

  it('does not match code outside apps/', () => {
    expect(matchesGlob('libs/frontend-utils/src/x.ts', 'apps/*frontend*/**')).toBe(false);
  });

  it('supports ** crossing separators', () => {
    expect(matchesGlob('a/b/c/d.ts', 'a/**/d.ts')).toBe(true);
  });

  it('supports ? for exactly one character', () => {
    expect(matchesGlob('apps/a1/x.ts', 'apps/a?/x.ts')).toBe(true);
    expect(matchesGlob('apps/a12/x.ts', 'apps/a?/x.ts')).toBe(false);
  });

  it('treats regex metacharacters in a glob as literals', () => {
    expect(matchesGlob('apps/a.b/x.ts', 'apps/a.b/**')).toBe(true);
    expect(matchesGlob('apps/axb/x.ts', 'apps/a.b/**')).toBe(false);
  });
});

describe('areasFromPaths', () => {
  it('detects frontend from an apps/*frontend* path', () => {
    expect(areasFromPaths(['apps/web-frontend/src/App.tsx'], HOUSE)).toEqual(['frontend']);
  });

  it('detects backend from an apps/*backend* path', () => {
    expect(areasFromPaths(['apps/api-backend/src/main/java/App.java'], HOUSE)).toEqual(['backend']);
  });

  it('detects both areas from a PR spanning them, in canonical order', () => {
    const files = ['apps/api-backend/src/Service.java', 'apps/web-frontend/src/App.tsx'];

    expect(areasFromPaths(files, HOUSE)).toEqual(['frontend', 'backend']);
  });

  it('deduplicates when many files map to the same area', () => {
    const files = ['apps/web-frontend/a.ts', 'apps/web-frontend/b.ts', 'apps/other-frontend/c.ts'];

    expect(areasFromPaths(files, HOUSE)).toEqual(['frontend']);
  });

  it('finds nothing for files outside the configured conventions', () => {
    expect(areasFromPaths(['README.md', 'libs/shared/index.ts'], HOUSE)).toEqual([]);
  });

  it('finds nothing when no path mapping is configured', () => {
    expect(areasFromPaths(['apps/web-frontend/src/App.tsx'], {})).toEqual([]);
  });

  it('normalizes Windows-style separators before matching', () => {
    expect(areasFromPaths(['apps\\web-frontend\\src\\App.tsx'], HOUSE)).toEqual(['frontend']);
  });

  it('handles an empty changed-file list', () => {
    expect(areasFromPaths([], HOUSE)).toEqual([]);
  });

  it('supports a custom mapping for any area', () => {
    const custom: AreaPathsConfig = { infrastructure: ['infra/**', 'terraform/**'] };

    expect(areasFromPaths(['terraform/main.tf'], custom)).toEqual(['infrastructure']);
  });
});
