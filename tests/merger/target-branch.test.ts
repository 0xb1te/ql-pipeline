import { describe, expect, it } from 'vitest';
import { couldGovernPullRequest, governsPullRequest, resolveTargetBranch } from '../../src/merger/target-branch.js';
import type { MergeConfig } from '../../src/shared/types.js';

function merge(overrides: Partial<MergeConfig> = {}): MergeConfig {
  return {
    targetBranch: 'main',
    targetBranchByArea: {},
    method: 'merge',
    deleteBranch: true,
    requiredChecks: ['build', 'test', 'ai-review'],
    requireHumanApproval: false,
    ...overrides,
  };
}

describe('resolveTargetBranch', () => {
  it('uses the default target branch when no area overrides apply', () => {
    expect(resolveTargetBranch(['frontend', 'backend'], merge())).toEqual({ ok: true, targetBranch: 'main' });
  });

  it('falls back to the default target branch when no areas matched at all', () => {
    expect(resolveTargetBranch([], merge())).toEqual({ ok: true, targetBranch: 'main' });
  });

  it('applies a per-area override', () => {
    const config = merge({ targetBranchByArea: { mobile: 'release/mobile' } });

    expect(resolveTargetBranch(['mobile'], config)).toEqual({ ok: true, targetBranch: 'release/mobile' });
  });

  it('accepts several areas that all share one overridden target', () => {
    const config = merge({ targetBranchByArea: { ios: 'release/mobile', android: 'release/mobile' } });

    expect(resolveTargetBranch(['ios', 'android'], config)).toEqual({ ok: true, targetBranch: 'release/mobile' });
  });

  it('refuses to guess when areas resolve to different target branches', () => {
    const config = merge({ targetBranchByArea: { mobile: 'release/mobile' } });

    const result = resolveTargetBranch(['mobile', 'backend'], config);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('more than one configured target branch');
      expect(result.reason).toContain('release/mobile');
      expect(result.reason).toContain('main');
    }
  });

  it('names the offending areas alongside each branch in the conflict message', () => {
    const config = merge({ targetBranchByArea: { ios: 'release/ios' } });

    const result = resolveTargetBranch(['ios', 'backend'], config);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('ios → release/ios');
      expect(result.reason).toContain('backend → main');
    }
  });
});

describe('couldGovernPullRequest', () => {
  it('is true for a PR targeting the default target branch', () => {
    expect(couldGovernPullRequest('main', merge())).toBe(true);
  });

  it('is true for a PR targeting a branch only reachable via an area override', () => {
    const config = merge({ targetBranchByArea: { mobile: 'release/mobile' } });

    expect(couldGovernPullRequest('release/mobile', config)).toBe(true);
  });

  it('is false for a PR targeting a branch no configuration could ever select', () => {
    const config = merge({ targetBranchByArea: { mobile: 'release/mobile' } });

    expect(couldGovernPullRequest('some/feature-branch', config)).toBe(false);
  });
});

describe('governsPullRequest', () => {
  it('governs a PR that targets the configured branch', () => {
    expect(governsPullRequest('main', 'main')).toBe(true);
  });

  it('leaves a PR aimed at another branch alone', () => {
    expect(governsPullRequest('develop', 'main')).toBe(false);
  });

  it('does not treat a branch whose name merely contains the target as a match', () => {
    expect(governsPullRequest('main-experiment', 'main')).toBe(false);
  });
});
