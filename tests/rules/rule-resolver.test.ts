import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  formatRulesForPrompt,
  resolveRuleFiles,
  ruleFileIds,
  type RuleFileReader,
} from '../../src/rules/rule-resolver.js';

const PATHS = { pipelineRoot: '/ql-pipeline', consumerRoot: '/consumer' };

/** A reader over a virtual filesystem, so no real files are touched. */
function reader(files: Record<string, string>): RuleFileReader {
  return {
    exists: vi.fn((path: string) => path in files),
    read: vi.fn((path: string) => {
      const content = files[path];
      if (content === undefined) {
        throw new Error(`no such file: ${path}`);
      }
      return content;
    }),
  };
}

const shipped = (name: string): string => join('/ql-pipeline', 'rules', name);
const consumer = (name: string): string => join('/consumer', '.github', 'pipeline-rules', name);

describe('resolveRuleFiles', () => {
  it('always includes _common.rules from the shipped rules, first', () => {
    const files = reader({
      [shipped('_common.rules')]: 'common rules',
      [shipped('backend.rules')]: 'shipped backend',
    });

    const resolved = resolveRuleFiles(['backend'], PATHS, files);

    expect(resolved[0]).toMatchObject({ id: '_common.rules', source: 'shipped', area: null });
  });

  it('falls back to the shipped rules for an area the consumer does not override', () => {
    const files = reader({
      [shipped('_common.rules')]: 'common rules',
      [shipped('backend.rules')]: 'shipped backend',
    });

    const resolved = resolveRuleFiles(['backend'], PATHS, files);

    expect(resolved[1]).toMatchObject({
      id: 'backend.rules',
      source: 'shipped',
      area: 'backend',
      text: 'shipped backend',
    });
  });

  it("prefers the consumer's override when one exists, replacing the shipped rules entirely", () => {
    const files = reader({
      [shipped('_common.rules')]: 'common rules',
      [shipped('backend.rules')]: 'shipped backend',
      [consumer('backend.rules')]: 'consumer backend',
    });

    const resolved = resolveRuleFiles(['backend'], PATHS, files);

    expect(resolved[1]).toMatchObject({ id: 'backend.rules', source: 'consumer', text: 'consumer backend' });
    expect(resolved).toHaveLength(2);
    expect(files.read).not.toHaveBeenCalledWith(shipped('backend.rules'));
  });

  it('resolves each area independently, mixing overridden and shipped rule sets', () => {
    const files = reader({
      [shipped('_common.rules')]: 'common rules',
      [shipped('frontend.rules')]: 'shipped frontend',
      [shipped('backend.rules')]: 'shipped backend',
      [consumer('backend.rules')]: 'consumer backend',
    });

    const resolved = resolveRuleFiles(['frontend', 'backend'], PATHS, files);

    expect(resolved.map((file) => [file.id, file.source])).toEqual([
      ['_common.rules', 'shipped'],
      ['frontend.rules', 'shipped'],
      ['backend.rules', 'consumer'],
    ]);
  });

  it('never lets a consumer override _common.rules, even if they place one', () => {
    const files = reader({
      [shipped('_common.rules')]: 'shipped common',
      [consumer('_common.rules')]: 'consumer common (should be ignored)',
      [shipped('docs.rules')]: 'shipped docs',
    });

    const resolved = resolveRuleFiles(['docs'], PATHS, files);

    expect(resolved[0]?.text).toBe('shipped common');
    expect(resolved[0]?.source).toBe('shipped');
  });

  it('returns only _common.rules when no areas matched', () => {
    const files = reader({ [shipped('_common.rules')]: 'common rules' });

    expect(resolveRuleFiles([], PATHS, files)).toHaveLength(1);
  });
});

describe('ruleFileIds', () => {
  it('lists the rule-file identities the reviewer is allowed to cite', () => {
    const files = reader({
      [shipped('_common.rules')]: 'c',
      [shipped('backend.rules')]: 'b',
    });

    expect(ruleFileIds(resolveRuleFiles(['backend'], PATHS, files))).toEqual(['_common.rules', 'backend.rules']);
  });
});

describe('formatRulesForPrompt', () => {
  it('labels each block with its rule-file id and where it came from', () => {
    const files = reader({
      [shipped('_common.rules')]: 'common body',
      [shipped('backend.rules')]: 'shipped backend body',
      [consumer('backend.rules')]: 'consumer backend body',
    });

    const text = formatRulesForPrompt(resolveRuleFiles(['backend'], PATHS, files));

    expect(text).toContain('----- _common.rules (shipped) -----');
    expect(text).toContain('common body');
    expect(text).toContain('----- backend.rules (consumer) -----');
    expect(text).toContain('consumer backend body');
    expect(text).not.toContain('shipped backend body');
  });
});
