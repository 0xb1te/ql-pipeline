import { describe, expect, it } from 'vitest';
import { buildDiffLineIndex, groundFindings } from '../../src/reviewer/diff-grounding.js';
import type { Finding } from '../../src/shared/types.js';

const SAMPLE_DIFF = [
  'diff --git a/src/api/users.ts b/src/api/users.ts',
  'index abc1234..def5678 100644',
  '--- a/src/api/users.ts',
  '+++ b/src/api/users.ts',
  '@@ -10,6 +10,7 @@ export function getUser(id: string) {',
  ' line 10 context',
  ' line 11 context',
  '-line 12 removed',
  '+line 12 replaced',
  '+line 13 added',
  ' line 14 context',
  ' line 15 context',
  'diff --git a/src/api/deleted.ts b/src/api/deleted.ts',
  'deleted file mode 100644',
  'index 1111111..0000000',
  '--- a/src/api/deleted.ts',
  '+++ /dev/null',
  '@@ -1,3 +0,0 @@',
  '-gone line 1',
  '-gone line 2',
  '-gone line 3',
].join('\n');

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: 'must',
    rule: 'backend.rules#no-string-concat-sql',
    file: 'src/api/users.ts',
    line: 12,
    problem: 'x',
    suggestedFix: null,
    autoFixable: true,
    ...overrides,
  };
}

describe('buildDiffLineIndex', () => {
  it('indexes context and added lines using the new-file line numbers', () => {
    const index = buildDiffLineIndex(SAMPLE_DIFF);

    for (const line of [10, 11, 12, 13, 14, 15]) {
      expect(index.hasLine('src/api/users.ts', line)).toBe(true);
    }
  });

  it('does not index a line number the new file never had', () => {
    const index = buildDiffLineIndex(SAMPLE_DIFF);

    expect(index.hasLine('src/api/users.ts', 9)).toBe(false);
    expect(index.hasLine('src/api/users.ts', 16)).toBe(false);
  });

  it('recognizes every file touched by the diff', () => {
    const index = buildDiffLineIndex(SAMPLE_DIFF);

    expect(index.hasFile('src/api/users.ts')).toBe(true);
  });

  it('does not recognize a file the diff never mentions', () => {
    const index = buildDiffLineIndex(SAMPLE_DIFF);

    expect(index.hasFile('src/api/other.ts')).toBe(false);
    expect(index.hasLine('src/api/other.ts', 1)).toBe(false);
  });

  it('does not index a deleted file (new side is /dev/null)', () => {
    const index = buildDiffLineIndex(SAMPLE_DIFF);

    expect(index.hasFile('src/api/deleted.ts')).toBe(false);
  });

  it('returns an empty index for an empty diff', () => {
    const index = buildDiffLineIndex('');

    expect(index.hasFile('anything.ts')).toBe(false);
    expect(index.hasLine('anything.ts', 1)).toBe(false);
  });

  it('resets the line cursor per hunk within the same file', () => {
    const diff = [
      '+++ b/a.ts',
      '@@ -1,2 +1,2 @@',
      ' first hunk line 1',
      ' first hunk line 2',
      '@@ -50,2 +50,2 @@',
      ' second hunk line 50',
      ' second hunk line 51',
    ].join('\n');

    const index = buildDiffLineIndex(diff);

    expect(index.hasLine('a.ts', 1)).toBe(true);
    expect(index.hasLine('a.ts', 2)).toBe(true);
    expect(index.hasLine('a.ts', 50)).toBe(true);
    expect(index.hasLine('a.ts', 51)).toBe(true);
    expect(index.hasLine('a.ts', 3)).toBe(false);
  });
});

describe('groundFindings', () => {
  const index = buildDiffLineIndex(SAMPLE_DIFF);
  const loadedRuleFiles = ['_common.rules', 'backend.rules'];

  it('keeps a finding whose file, line, and rule are all grounded', () => {
    const result = groundFindings([finding()], index, loadedRuleFiles);

    expect(result.grounded).toEqual([finding()]);
    expect(result.discarded).toEqual([]);
  });

  it('discards a finding citing a file not in the diff', () => {
    const bad = finding({ file: 'src/api/nonexistent.ts' });

    const result = groundFindings([bad], index, loadedRuleFiles);

    expect(result.grounded).toEqual([]);
    expect(result.discarded).toHaveLength(1);
    expect(result.discarded[0]?.reason).toMatch(/does not appear in the diff/);
  });

  it('discards a finding citing a line not in the diff', () => {
    const bad = finding({ line: 999 });

    const result = groundFindings([bad], index, loadedRuleFiles);

    expect(result.grounded).toEqual([]);
    expect(result.discarded[0]?.reason).toMatch(/line 999/);
  });

  it('discards a finding citing a rule from a file that was not loaded', () => {
    const bad = finding({ rule: 'frontend.rules#no-any' });

    const result = groundFindings([bad], index, loadedRuleFiles);

    expect(result.grounded).toEqual([]);
    expect(result.discarded[0]?.reason).toMatch(/not from a rule file loaded/);
  });

  it('matches rules from _common.rules despite the leading underscore', () => {
    const commonFinding = finding({ rule: '_common.rules#no-secrets' });

    const result = groundFindings([commonFinding], index, loadedRuleFiles);

    expect(result.grounded).toEqual([commonFinding]);
  });

  it('rejects a rule string that only shares a prefix, not the full "file.rules#" boundary', () => {
    const bad = finding({ rule: 'backend.rulesx#foo' });

    const result = groundFindings([bad], index, loadedRuleFiles);

    expect(result.grounded).toEqual([]);
  });

  it('discards every finding when no rule files were loaded', () => {
    const result = groundFindings([finding()], index, []);

    expect(result.grounded).toEqual([]);
    expect(result.discarded).toHaveLength(1);
  });

  it('partitions a mixed batch of grounded and ungrounded findings', () => {
    const good = finding();
    const badFile = finding({ file: 'nope.ts' });
    const badRule = finding({ rule: 'mobile.rules#no-secrets' });

    const result = groundFindings([good, badFile, badRule], index, loadedRuleFiles);

    expect(result.grounded).toEqual([good]);
    expect(result.discarded).toHaveLength(2);
  });

  it('handles an empty findings list', () => {
    const result = groundFindings([], index, loadedRuleFiles);

    expect(result).toEqual({ grounded: [], discarded: [] });
  });
});
