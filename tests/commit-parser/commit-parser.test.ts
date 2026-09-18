import { describe, expect, it } from 'vitest';
import { parseCommitHeader, parseCommits } from '../../src/commit-parser/commit-parser.js';
import { AREAS } from '../../src/shared/types.js';

describe('parseCommitHeader', () => {
  it('parses a valid header', () => {
    const result = parseCommitHeader('feat(frontend): add dark-mode toggle');

    expect(result).toEqual({
      type: 'feat',
      area: 'frontend',
      description: 'add dark-mode toggle',
      raw: 'feat(frontend): add dark-mode toggle',
    });
  });

  it('accepts every documented commit type', () => {
    const types = ['feat', 'fix', 'refactor', 'perf', 'chore', 'docs', 'test', 'ci', 'build', 'revert'];
    for (const type of types) {
      expect(parseCommitHeader(`${type}(backend): something`)?.type).toBe(type);
    }
  });

  it('accepts every documented area', () => {
    const areas = ['frontend', 'backend', 'mobile', 'ios', 'android', 'infrastructure', 'tooling', 'docs'];
    for (const area of areas) {
      expect(parseCommitHeader(`fix(${area}): something`)?.area).toBe(area);
    }
  });

  it('keeps the area list level with AREAS, so a new area cannot be added without a review pack', () => {
    // AREAS drives allReviewDocumentPaths, and doctor reports a missing
    // workflow/review/<kind>/<area>.md against every consumer. Hardcoding the list above
    // would let one drift ahead of the other silently.
    expect([...AREAS].sort()).toEqual(
      ['frontend', 'backend', 'mobile', 'ios', 'android', 'infrastructure', 'tooling', 'docs'].sort(),
    );
  });

  it('rejects an unrecognized type', () => {
    expect(parseCommitHeader('feature(frontend): add x')).toBeNull();
  });

  it('rejects an unrecognized area', () => {
    expect(parseCommitHeader('feat(desktop): add x')).toBeNull();
  });

  it('rejects a header with no scope at all', () => {
    expect(parseCommitHeader('feat: add x')).toBeNull();
  });

  it('rejects a header missing the colon', () => {
    expect(parseCommitHeader('feat(frontend) add x')).toBeNull();
  });

  it('rejects a header with no space after the colon', () => {
    expect(parseCommitHeader('feat(frontend):add x')).toBeNull();
  });

  it('rejects a header with an empty description', () => {
    expect(parseCommitHeader('feat(frontend): ')).toBeNull();
  });

  it('rejects uppercase type/area (grammar is strictly lowercase)', () => {
    expect(parseCommitHeader('Feat(Frontend): add x')).toBeNull();
  });

  it('rejects an empty message', () => {
    expect(parseCommitHeader('')).toBeNull();
  });

  it('rejects leading whitespace before the type', () => {
    expect(parseCommitHeader(' feat(frontend): add x')).toBeNull();
  });

  it('only considers the first line; body/footer content is ignored', () => {
    const message = 'feat(backend): add payments endpoint\n\nBody text here.\n\nCloses #123';
    const result = parseCommitHeader(message);

    expect(result?.description).toBe('add payments endpoint');
    expect(result?.raw).toBe(message);
  });

  it('strips a trailing carriage return from CRLF line endings', () => {
    const result = parseCommitHeader('feat(frontend): add x\r\nsome body');

    expect(result).toEqual({
      type: 'feat',
      area: 'frontend',
      description: 'add x',
      raw: 'feat(frontend): add x\r\nsome body',
    });
  });

  it('allows additional colons inside the description', () => {
    const result = parseCommitHeader('fix(backend): handle edge case: null payload');

    expect(result?.description).toBe('handle edge case: null payload');
  });
});

describe('parseCommits', () => {
  it('separates parsed commits from unparsed ones', () => {
    const result = parseCommits([
      'feat(frontend): add dark-mode toggle',
      'wip',
      'fix(backend): patch sql injection',
    ]);

    expect(result.parsed).toHaveLength(2);
    expect(result.parsed[0]?.area).toBe('frontend');
    expect(result.parsed[1]?.area).toBe('backend');
    expect(result.unparsed).toEqual(['wip']);
  });

  it('returns an empty parsed list when nothing matches', () => {
    const result = parseCommits(['wip', 'oops']);

    expect(result.parsed).toEqual([]);
    expect(result.unparsed).toEqual(['wip', 'oops']);
  });

  it('returns an empty unparsed list when everything matches', () => {
    const result = parseCommits(['feat(frontend): a', 'fix(backend): b']);

    expect(result.unparsed).toEqual([]);
    expect(result.parsed).toHaveLength(2);
  });

  it('handles an empty commit list', () => {
    const result = parseCommits([]);

    expect(result).toEqual({ parsed: [], unparsed: [] });
  });
});
