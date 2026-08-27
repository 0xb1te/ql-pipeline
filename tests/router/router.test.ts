import { describe, expect, it } from 'vitest';
import { determineRoute } from '../../src/router/router.js';
import type { PipelineConfig } from '../../src/shared/types.js';

function testConfig(overrides: Partial<PipelineConfig['gates']> = {}): PipelineConfig {
  return {
    gates: {
      frontend: { build: 'npm run build:frontend', test: 'npm run test:frontend' },
      backend: { build: 'npm run build:backend', test: 'npm run test:backend' },
      ...overrides,
    },
    merge: { targetBranch: 'main', targetBranchByArea: {}, method: 'merge', deleteBranch: true, requiredChecks: ['build', 'test'], requireHumanApproval: false },
    fixer: { maxFixAttempts: 3, protectedPaths: ['rules/'] },
    areas: { paths: {} },
    standards: { enabled: false, root: '.standards', docs: {}, maxCharsPerArea: 90_000 },
  };
}

describe('determineRoute', () => {
  it('routes a single valid commit to its area', () => {
    const result = determineRoute(
      { commitMessages: ['feat(frontend): add dark-mode toggle'], prTitle: 'feat(frontend): add dark-mode toggle' },
      testConfig(),
    );

    expect(result).toEqual({
      ok: true,
      decision: {
        types: ['feat'],
        areas: ['frontend'],
        ruleFiles: ['_common.rules', 'frontend.rules'],
        gates: [{ area: 'frontend', build: 'npm run build:frontend', test: 'npm run test:frontend' }],
      },
    });
  });

  it('dedupes multiple commits in the same area', () => {
    const result = determineRoute(
      {
        commitMessages: ['feat(frontend): add x', 'fix(frontend): fix y'],
        prTitle: 'feat(frontend): add x',
      },
      testConfig(),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.areas).toEqual(['frontend']);
      expect(result.decision.types).toEqual(['feat', 'fix']);
    }
  });

  it('unions areas across commits touching multiple areas', () => {
    const result = determineRoute(
      {
        commitMessages: ['fix(backend): patch sql injection', 'feat(frontend): add toggle'],
        prTitle: 'chore: multiple areas',
      },
      testConfig(),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Canonical order (frontend before backend), regardless of commit order.
      expect(result.decision.areas).toEqual(['frontend', 'backend']);
      expect(result.decision.ruleFiles).toEqual(['_common.rules', 'frontend.rules', 'backend.rules']);
      expect(result.decision.gates.map((g) => g.area)).toEqual(['frontend', 'backend']);
    }
  });

  it('ignores commits that do not match the grammar as long as one commit does', () => {
    const result = determineRoute(
      { commitMessages: ['wip', 'feat(backend): add endpoint', 'oops typo fix'], prTitle: 'wip' },
      testConfig(),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.areas).toEqual(['backend']);
    }
  });

  it('falls back to the PR title when no commit parses', () => {
    const result = determineRoute(
      { commitMessages: ['wip', 'fixup'], prTitle: 'feat(mobile): add offline mode' },
      testConfig(),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.areas).toEqual(['mobile']);
      expect(result.decision.types).toEqual(['feat']);
    }
  });

  it('falls back to the PR title when the commit list is empty', () => {
    const result = determineRoute({ commitMessages: [], prTitle: 'fix(ios): crash on launch' }, testConfig());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.areas).toEqual(['ios']);
    }
  });

  it('is unroutable when neither commits nor the PR title parse', () => {
    const result = determineRoute({ commitMessages: ['wip', 'fixup'], prTitle: 'Fix stuff' }, testConfig());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/does not|doesn't/);
      expect(result.reason).toContain('Fix stuff');
    }
  });

  it('is unroutable when the commit list is empty and the title does not parse', () => {
    const result = determineRoute({ commitMessages: [], prTitle: 'Fix stuff' }, testConfig());

    expect(result.ok).toBe(false);
  });

  it('produces a gate entry with no build/test keys when the area has no configured gate', () => {
    const result = determineRoute(
      { commitMessages: ['docs(docs): update readme'], prTitle: 'docs(docs): update readme' },
      testConfig(),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.gates).toEqual([{ area: 'docs' }]);
    }
  });
});
