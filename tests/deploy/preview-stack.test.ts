import { describe, expect, it } from 'vitest';
import {
  decidePreviewDeploy,
  findPreviewInListing,
  formatPreviewSummary,
  mcpEndpointFor,
  parsePreviewUpOutput,
  previewUpArgs,
  type PreviewDeployInput,
} from '../../src/deploy/preview-stack.js';
import type { TaskFolderLookup } from '../../src/verdict/task-artifacts.js';

const READY_FOLDER: TaskFolderLookup = {
  kind: 'folder',
  ref: { kind: 'features', number: '007' },
  path: 'docs/features/007-statistics-dashboard',
  files: ['index.md', 'plan.md', 'testing-plan.xlsx', 'seed.sql'],
};

function input(overrides: Partial<PreviewDeployInput> = {}): PreviewDeployInput {
  return { enabled: true, environment: 'valid', taskFolder: READY_FOLDER, isFork: false, ...overrides };
}

describe('decidePreviewDeploy', () => {
  it('deploys a green, previewable, seeded, non-fork pull request', () => {
    expect(decidePreviewDeploy(input()).deploy).toBe(true);
  });

  it('never deploys a fork, whatever else is true', () => {
    // A fork's workflow content is attacker-controlled and the preview host is a real machine.
    const decision = decidePreviewDeploy(input({ isFork: true }));
    expect(decision.deploy).toBe(false);
    expect(decision.reason).toContain('fork');
  });

  it('respects preview.enabled: false', () => {
    expect(decidePreviewDeploy(input({ enabled: false })).reason).toContain('preview.enabled');
  });

  it('does not deploy a repository with no product apps', () => {
    expect(decidePreviewDeploy(input({ environment: 'not-required' })).deploy).toBe(false);
  });

  it('does not deploy a repository whose devops folder fails the contract', () => {
    expect(decidePreviewDeploy(input({ environment: 'invalid' })).reason).toContain('contract');
  });

  it('does not deploy a branch that names no task folder, because there is no seed to boot from', () => {
    const decision = decidePreviewDeploy(
      input({ taskFolder: { kind: 'not-a-task-branch', headRef: 'dependabot/npm/lodash' } }),
    );
    expect(decision.deploy).toBe(false);
    expect(decision.reason).toContain('dependabot/npm/lodash');
    expect(decision.reason).toContain('seed.sql');
  });

  it('does not deploy when the task folder does not exist', () => {
    const decision = decidePreviewDeploy(
      input({ taskFolder: { kind: 'no-folder', ref: { kind: 'hotfixes', number: '003' } } }),
    );
    expect(decision.reason).toContain('docs/hotfixes/003-*/');
  });

  it('does not deploy a task folder that carries no seed.sql', () => {
    const decision = decidePreviewDeploy(
      input({ taskFolder: { ...READY_FOLDER, files: ['index.md', 'plan.md', 'testing-plan.xlsx'] } }),
    );
    expect(decision.deploy).toBe(false);
    expect(decision.reason).toContain('boot empty');
  });

  it('matches the seed case-insensitively, the way the artifact check does', () => {
    expect(decidePreviewDeploy(input({ taskFolder: { ...READY_FOLDER, files: ['Seed.SQL'] } })).deploy).toBe(true);
  });
});

describe('previewUpArgs', () => {
  it('builds the ql-proxy up vector, branch as an argument and never a shell string', () => {
    expect(
      previewUpArgs({
        branch: 'features/007-statistics-dashboard-a1b2c3',
        repository: '0xb1te/shop',
        pullRequest: 42,
        checkoutDir: '/work/shop/infrastructure/docker/environments/devops',
        ttlMinutes: 120,
        protect: true,
      }),
    ).toEqual([
      'up',
      '--branch',
      'features/007-statistics-dashboard-a1b2c3',
      '--repo',
      '0xb1te/shop',
      '--pr',
      '42',
      '--dir',
      '/work/shop/infrastructure/docker/environments/devops',
      '--ttl',
      '120',
      '--no-announce',
      '--protect',
    ]);
  });

  it('always switches announcing off and keeps --pr, because teardown resolves the stack by it', () => {
    const args = previewUpArgs({
      branch: 'b',
      repository: 'o/r',
      pullRequest: 9,
      checkoutDir: '/d',
      ttlMinutes: 30,
      protect: false,
    });
    expect(args).toContain('--no-announce');
    expect(args.slice(args.indexOf('--pr'), args.indexOf('--pr') + 2)).toEqual(['--pr', '9']);
  });

  it('omits --protect when the repository asked for an open preview', () => {
    const args = previewUpArgs({
      branch: 'b',
      repository: 'o/r',
      pullRequest: 1,
      checkoutDir: '/d',
      ttlMinutes: 30,
      protect: false,
    });
    expect(args).not.toContain('--protect');
  });
});

describe('parsePreviewUpOutput', () => {
  it('reads the URL off the last URL-shaped line', () => {
    const out = 'creating the shared network preview-net\nhttps://shop-temp-2609221412.rvproxy.com\n';
    expect(parsePreviewUpOutput(out)).toEqual({ url: 'https://shop-temp-2609221412.rvproxy.com', token: null });
  });

  it('reads a token line when ql-proxy prints one', () => {
    const out = 'https://shop-temp-1.rvproxy.com\ntoken: 9f1c2d3e4a5b\n';
    expect(parsePreviewUpOutput(out)).toEqual({ url: 'https://shop-temp-1.rvproxy.com', token: '9f1c2d3e4a5b' });
    expect(parsePreviewUpOutput('https://x.example\nSecret: abc').token).toBe('abc');
  });

  it('is null on both when nothing URL-shaped was printed', () => {
    expect(parsePreviewUpOutput('--branch and --repo are both required\n')).toEqual({ url: null, token: null });
  });
});

describe('findPreviewInListing', () => {
  const LISTING = JSON.stringify([
    { slug: 'other', project: 'pr-other', url: 'https://other.rvproxy.com', minutesRemaining: 5, expires: true, kind: 'compose', live: true, registered: true, protected: false },
    { slug: 'shop-temp-1', project: 'pr-shop-temp-1', url: 'https://shop-temp-1.rvproxy.com', minutesRemaining: 118, expires: true, kind: 'compose', live: true, registered: true, protected: false },
  ]);

  it('finds the row whose URL matches, ignoring a trailing slash', () => {
    const row = findPreviewInListing(LISTING, 'https://shop-temp-1.rvproxy.com/');
    expect(row?.project).toBe('pr-shop-temp-1');
    expect(row?.minutesRemaining).toBe(118);
    expect(row?.expires).toBe(true);
    expect(row?.protected).toBe(false);
  });

  it('is null when the URL is not listed, when the JSON is not a list, and when it is not JSON', () => {
    expect(findPreviewInListing(LISTING, 'https://nope.rvproxy.com')).toBeNull();
    expect(findPreviewInListing('{"previews": []}', 'https://shop-temp-1.rvproxy.com')).toBeNull();
    expect(findPreviewInListing('nothing is routed', 'https://shop-temp-1.rvproxy.com')).toBeNull();
  });

  it('reads a never-expiring row as having no minutes remaining', () => {
    const listing = JSON.stringify([{ slug: 's', project: 'p', url: 'https://s.x', minutesRemaining: null, expires: false }]);
    expect(findPreviewInListing(listing, 'https://s.x')?.minutesRemaining).toBeNull();
  });
});

describe('mcpEndpointFor', () => {
  it('builds the internal address from the first IPv4 on any network', () => {
    expect(mcpEndpointFor('172.19.0.4 172.20.0.3 \n', 8080, '/mcp')).toBe('http://172.19.0.4:8080/mcp');
  });

  it('is null when the container has no address', () => {
    expect(mcpEndpointFor(' \n', 8080, '/mcp')).toBeNull();
    expect(mcpEndpointFor('<no value>', 8080, '/mcp')).toBeNull();
  });
});

describe('formatPreviewSummary', () => {
  const base = {
    url: 'https://shop-temp-1.rvproxy.com',
    project: 'pr-shop-temp-1',
    token: null,
    protected: false,
    minutesRemaining: 118,
    expiresAt: '2026-09-22T16:05:00.000Z',
    mcp: { endpoint: 'http://172.19.0.4:8080/mcp', ready: true, waitedSeconds: 12 },
  };

  it('prints the URL, the token and the expiry together when the host handed a token over', () => {
    const body = formatPreviewSummary({ ...base, token: 'abc123', protected: true });
    expect(body).toContain('**URL:** https://shop-temp-1.rvproxy.com');
    expect(body).toContain('`abc123`');
    expect(body).toContain('asks for it once');
    expect(body).toContain('118 minutes, until 16:05 UTC');
    expect(body).toContain('closing this pull request tears it down');
  });

  it('says plainly when the host does not gate previews yet, rather than implying a lock', () => {
    const body = formatPreviewSummary(base);
    expect(body).toContain('does not gate previews with a token yet');
    expect(body).toContain('Cloudflare Access is the only lock');
    expect(body).not.toContain('Access token');
  });

  it('says the host locked it but handed no token over, which is a different state again', () => {
    const body = formatPreviewSummary({ ...base, protected: true });
    expect(body).toContain('did not hand its token');
    expect(body).toContain('pr-shop-temp-1');
  });

  it('reports the MCP state without ever printing a public route to it', () => {
    expect(formatPreviewSummary(base)).toContain('answering on the preview host\'s container network after 12s');
    expect(formatPreviewSummary(base)).not.toContain('172.19.0.4');
    expect(formatPreviewSummary({ ...base, mcp: { ...base.mcp, ready: false, waitedSeconds: 180 } })).toContain(
      'not answering after 180s',
    );
    expect(formatPreviewSummary({ ...base, mcp: { endpoint: null, ready: false, waitedSeconds: 0 } })).toContain(
      'could not be located',
    );
  });

  it('copes with a preview whose expiry is unknown', () => {
    const body = formatPreviewSummary({ ...base, minutesRemaining: null, expiresAt: null });
    expect(body).toContain('disappears on its own when its lifetime ends');
  });
});
