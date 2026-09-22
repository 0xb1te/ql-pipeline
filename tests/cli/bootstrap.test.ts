import { describe, expect, it, vi } from 'vitest';
import { actionsRunUrl, resolveRouting } from '../../src/cli/bootstrap.js';
import type { GithubClient, PullRequestInfo } from '../../src/shared/github-client.js';
import type { PipelineConfig } from '../../src/shared/types.js';

function config(overrides: Partial<PipelineConfig['merge']> = {}): PipelineConfig {
  return {
    gates: { backend: { build: 'npm run build', test: 'npm test' } },
    merge: {
      targetBranch: 'main',
      targetBranchByArea: {},
      method: 'merge',
      deleteBranch: true,
      requiredChecks: ['build', 'test', 'ai-review'],
    requireHumanApproval: false,
      ...overrides,
    },
    fixer: { maxFixAttempts: 3, protectedPaths: [], fixAdvisory: true },
    agent: { provider: 'cursor', model: null, baseUrl: null, review: { model: null }, fix: { model: null } },
    areas: { paths: {} },
    standards: { enabled: false, root: '.standards', docs: {}, maxCharsPerArea: 90000 },
    preview: { enabled: true, ttlMinutes: 120, protect: true, mcp: { service: 'backend', port: 8080, path: '/mcp', readyTimeoutSeconds: 180 } },
  };
}

function pr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    owner: '0xb1te',
    repo: 'ql-pipeline',
    number: 7,
    title: 'feat(backend): add endpoint',
    headRef: 'task/007',
    headSha: 'abc123',
    baseRef: 'main',
    isFork: false,
    ...overrides,
  };
}

function client(commits: string[]): Pick<GithubClient, 'listCommitMessages'> {
  return { listCommitMessages: vi.fn().mockResolvedValue(commits) };
}

describe('resolveRouting', () => {
  it('proceeds for a routable PR targeting the configured branch', async () => {
    const result = await resolveRouting(client(['feat(backend): add endpoint']), pr(), config());

    expect(result.kind).toBe('proceed');
    if (result.kind === 'proceed') {
      expect(result.route.areas).toEqual(['backend']);
      expect(result.targetBranch).toBe('main');
    }
  });

  it('short-circuits an out-of-scope PR without spending an API call', async () => {
    const api = client(['feat(backend): add endpoint']);

    const result = await resolveRouting(api, pr({ baseRef: 'some/other-branch' }), config());

    expect(result.kind).toBe('not-governed');
    expect(api.listCommitMessages).not.toHaveBeenCalled();
  });

  it('reports an unroutable PR', async () => {
    const result = await resolveRouting(client(['wip']), pr({ title: 'wip' }), config());

    expect(result.kind).toBe('unroutable');
  });

  it('reports a target-branch conflict across areas', async () => {
    const conflicted = config({ targetBranchByArea: { mobile: 'release/mobile' } });

    const result = await resolveRouting(
      client(['feat(backend): api', 'feat(mobile): screen']),
      pr(),
      conflicted,
    );

    expect(result.kind).toBe('target-conflict');
  });

  it('declines a PR whose areas resolve to a branch it is not actually targeting', async () => {
    // The PR targets release/mobile (so it passes the cheap pre-check), but
    // its area resolves to main — the pipeline does not govern this pairing.
    const withOverride = config({ targetBranchByArea: { mobile: 'release/mobile' } });

    const result = await resolveRouting(
      client(['feat(backend): add endpoint']),
      pr({ baseRef: 'release/mobile' }),
      withOverride,
    );

    expect(result.kind).toBe('not-governed');
  });

  it('governs a PR that targets an area-specific branch when its area matches', async () => {
    const withOverride = config({ targetBranchByArea: { mobile: 'release/mobile' } });

    const result = await resolveRouting(
      client(['feat(mobile): add offline mode']),
      pr({ baseRef: 'release/mobile' }),
      withOverride,
    );

    expect(result.kind).toBe('proceed');
    if (result.kind === 'proceed') {
      expect(result.targetBranch).toBe('release/mobile');
    }
  });
});

describe('actionsRunUrl', () => {
  it('builds the run URL from the Actions environment', () => {
    const url = actionsRunUrl({
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: '0xb1te/ql-pipeline',
      GITHUB_RUN_ID: '42',
    });

    expect(url).toBe('https://github.com/0xb1te/ql-pipeline/actions/runs/42');
  });

  it('honours an Enterprise server rather than hard-coding github.com', () => {
    const url = actionsRunUrl({
      GITHUB_SERVER_URL: 'https://ghe.example.com',
      GITHUB_REPOSITORY: 'a/b',
      GITHUB_RUN_ID: '7',
    });

    expect(url).toBe('https://ghe.example.com/a/b/actions/runs/7');
  });

  it('returns null outside Actions rather than a half-built URL', () => {
    // A link to `undefined/actions/runs/undefined` is worse than no link: it reads as a broken
    // pipeline rather than as a summary posted from somewhere that has no run.
    expect(actionsRunUrl({})).toBeNull();
    expect(actionsRunUrl({ GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'a/b' })).toBeNull();
    expect(actionsRunUrl({ GITHUB_SERVER_URL: '', GITHUB_REPOSITORY: 'a/b', GITHUB_RUN_ID: '1' })).toBeNull();
  });
});
