import { describe, expect, it } from 'vitest';
import { touchesProtectedPaths } from '../../src/router/self-protection.js';

const PROTECTED = ['.github/workflows/', '.github/pipeline.config.yml', '.github/pipeline-rules/'];

describe('touchesProtectedPaths', () => {
  it('is false when no changed file touches a protected path', () => {
    expect(touchesProtectedPaths(['src/api/users.ts', 'README.md'], PROTECTED)).toBe(false);
  });

  it('is true for an exact match on a non-directory protected path', () => {
    expect(touchesProtectedPaths(['.github/pipeline.config.yml'], PROTECTED)).toBe(true);
  });

  it('is true for a file inside a directory-protected path', () => {
    expect(touchesProtectedPaths(['.github/workflows/pr-pipeline.yml'], PROTECTED)).toBe(true);
  });

  it('does not treat a near-miss of an exact path as a match', () => {
    expect(touchesProtectedPaths(['.github/pipeline.config.yml.bak'], PROTECTED)).toBe(false);
  });

  it('is false for an empty changed-files list', () => {
    expect(touchesProtectedPaths([], PROTECTED)).toBe(false);
  });

  it('is false when there are no protected paths configured', () => {
    expect(touchesProtectedPaths(['.github/workflows/x.yml'], [])).toBe(false);
  });

  it('is true when only one of several changed files matches', () => {
    expect(touchesProtectedPaths(['src/index.ts', '.github/pipeline-rules/backend.rules'], PROTECTED)).toBe(true);
  });

  it('is true when the match is not the first protected path in the list', () => {
    expect(touchesProtectedPaths(['.github/pipeline.config.yml'], PROTECTED)).toBe(true);
  });
});
