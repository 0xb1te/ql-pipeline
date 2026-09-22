import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  deployPreview,
  MCP_ENABLED_VAR,
  PROXY_CONFIG_VAR,
  PROXY_HOME_VAR,
  TASK_FOLDER_VAR,
  type DeployPreviewDeps,
} from '../../src/cli/deploy-preview-command.js';
import type { ArgvExecutor } from '../../src/shared/exec.js';
import type { PipelineConfig } from '../../src/shared/types.js';

const CONFIG: PipelineConfig = {
  gates: {},
  merge: { targetBranch: 'main', targetBranchByArea: {}, method: 'merge', deleteBranch: true, requiredChecks: ['build', 'test', 'ai-review'], requireHumanApproval: true },
  fixer: { maxFixAttempts: 3, protectedPaths: [], fixAdvisory: true },
  agent: { provider: 'cursor', model: null, baseUrl: null, review: { model: null }, fix: { model: null } },
  areas: { paths: { frontend: ['apps/*frontend*/**'], backend: ['apps/*backend*/**'] } },
  standards: { enabled: false, root: '.standards', docs: {}, maxCharsPerArea: 90_000 },
  preview: { enabled: true, ttlMinutes: 120, protect: true, mcp: { service: 'backend', port: 8080, path: '/mcp', readyTimeoutSeconds: 30 } },
};

const PR = {
  owner: '0xb1te',
  repo: 'shop',
  number: 42,
  title: 'feat(backend): statistics',
  headRef: 'features/007-statistics-dashboard-a1b2c3',
  headSha: 'abc',
  baseRef: 'main',
  isFork: false,
};

const VALID_COMPOSE = 'services:\n  edge:\n    image: nginx\n  backend:\n    image: app\n';
const URL = 'https://shop-temp-2609221412.rvproxy.com';
const LISTING = JSON.stringify([
  { slug: 'shop-temp-2609221412', project: 'pr-shop-temp-2609221412', url: URL, minutesRemaining: 118, expires: true, protected: false, live: true },
]);

/** A product repository with a valid devops folder and a seeded task folder. */
function repo(options: { seed?: boolean; devops?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'ql-deploy-'));
  mkdirSync(join(root, 'apps', 'shop-backend'), { recursive: true });
  if (options.devops !== false) {
    const devops = join(root, 'infrastructure', 'docker', 'environments', 'devops');
    mkdirSync(devops, { recursive: true });
    writeFileSync(join(devops, 'docker-compose.yml'), VALID_COMPOSE);
    writeFileSync(join(devops, 'env.example'), 'DATABASE_URL=x\n');
  }
  const task = join(root, 'docs', 'features', '007-statistics-dashboard');
  mkdirSync(task, { recursive: true });
  writeFileSync(join(task, 'testing-plan.xlsx'), '');
  if (options.seed !== false) writeFileSync(join(task, 'seed.sql'), '-- fixtures\n');
  return root;
}

interface Call {
  readonly file: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

/** An executor that answers ql-proxy and docker the way the host does, and records every call. */
function executor(overrides: Partial<Record<'up' | 'list' | 'ps' | 'inspect', string | Error>> = {}): {
  exec: ArgvExecutor;
  calls: Call[];
} {
  const calls: Call[] = [];
  const answers = {
    up: `creating the shared network preview-net\n${URL}\n`,
    list: LISTING,
    ps: 'abcdef123456\n',
    inspect: '172.19.0.4 \n',
    ...overrides,
  };
  const exec: ArgvExecutor = (file, args, options) => {
    calls.push({ file, args, ...(options.env === undefined ? {} : { env: options.env }) });
    const key = file === 'docker' ? (args[0] === 'compose' ? 'ps' : 'inspect') : args[1] === 'up' ? 'up' : 'list';
    const answer = answers[key];
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve({ stdout: answer, stderr: '' });
  };
  return { exec, calls };
}

interface TestContext {
  readonly ctx: Parameters<typeof deployPreview>[0];
  readonly client: { postComment: ReturnType<typeof vi.fn> };
  readonly logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
}

function context(root: string, overrides: { isFork?: boolean; enabled?: boolean } = {}): TestContext {
  const client = { postComment: vi.fn(() => Promise.resolve()) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    ctx: {
      config: { ...CONFIG, preview: { ...CONFIG.preview, enabled: overrides.enabled ?? true } },
      pr: { ...PR, isFork: overrides.isFork ?? false },
      client: client as never,
      logger,
      consumerRoot: root,
    },
    client,
    logger,
  };
}

function deps(exec: ArgvExecutor, overrides: Partial<DeployPreviewDeps> = {}): DeployPreviewDeps {
  let clock = 1_000_000;
  return {
    exec,
    env: { [PROXY_HOME_VAR]: '/opt/ql-proxy', [PROXY_CONFIG_VAR]: '/opt/ql-proxy/ql-proxy.yml', GH_TOKEN: 'ghp_never_forwarded' },
    probeMcp: vi.fn(() => Promise.resolve(true)),
    sleep: vi.fn((ms: number) => {
      clock += ms;
      return Promise.resolve();
    }),
    now: () => clock,
    ...overrides,
  };
}

describe('deployPreview', () => {
  it('brings the devops folder up through ql-proxy, seeded from the task folder, and reports where it is', async () => {
    const root = repo();
    const { ctx, client } = context(root);
    const { exec, calls } = executor();

    const outcome = await deployPreview(ctx, deps(exec));

    expect(outcome).toEqual({ kind: 'deployed', url: URL, project: 'pr-shop-temp-2609221412', mcpUrl: 'http://172.19.0.4:8080/mcp', mcpReady: true });

    const up = calls[0]!;
    expect(up.file).toBe('node');
    expect(up.args[0]).toBe(join('/opt/ql-proxy', 'dist', 'cli', 'entry', 'main.js'));
    expect(up.args.slice(1)).toEqual([
      'up', '--branch', PR.headRef, '--repo', '0xb1te/shop', '--pr', '42',
      '--dir', join(root, 'infrastructure', 'docker', 'environments', 'devops'),
      '--ttl', '120', '--no-announce', '--protect',
    ]);
    // The seed mount and the MCP switch reach compose through ql-proxy's environment, and
    // nothing else does: ql-proxy is told not to announce, so no GitHub token is forwarded
    // even when the job's own environment holds one.
    expect(up.env).toEqual({
      [TASK_FOLDER_VAR]: 'features/007-statistics-dashboard',
      [MCP_ENABLED_VAR]: 'true',
      [PROXY_CONFIG_VAR]: '/opt/ql-proxy/ql-proxy.yml',
    });
    expect(up.env).not.toHaveProperty('GH_TOKEN');

    expect(calls.map((call) => `${call.file} ${call.args.slice(call.file === 'node' ? 1 : 0).join(' ')}`)).toEqual([
      `node ${up.args.slice(1).join(' ')}`,
      'node list --json',
      'docker compose -p pr-shop-temp-2609221412 ps -q backend',
      'docker inspect -f {{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}} abcdef123456',
    ]);

    expect(client.postComment).toHaveBeenCalledTimes(1);
    const body = (client.postComment.mock.calls[0] as unknown as [unknown, string])[1];
    expect(body).toContain(URL);
    expect(body).toContain('118 minutes');
    expect(body).toContain('does not gate previews with a token yet');
    expect(body).not.toContain('172.19.0.4');
  });

  it('skips, silently on the PR, when the decision says not to deploy', async () => {
    const { ctx, client } = context(repo(), { isFork: true });
    const { exec, calls } = executor();

    const outcome = await deployPreview(ctx, deps(exec));

    expect(outcome.kind).toBe('skipped');
    expect(calls).toHaveLength(0);
    expect(client.postComment).not.toHaveBeenCalled();
  });

  it('skips a task folder with no seed rather than booting an empty database', async () => {
    const { ctx } = context(repo({ seed: false }));
    const outcome = await deployPreview(ctx, deps(executor().exec));
    expect(outcome.kind).toBe('skipped');
    if (outcome.kind === 'skipped') expect(outcome.reason).toContain('boot empty');
  });

  it('skips a repository whose devops folder is missing, whatever the job condition said', async () => {
    const { ctx } = context(repo({ devops: false }));
    const outcome = await deployPreview(ctx, deps(executor().exec));
    expect(outcome.kind).toBe('skipped');
  });

  it('fails, naming the variable, when it does not know where ql-proxy is', async () => {
    const { ctx } = context(repo());
    const outcome = await deployPreview(ctx, deps(executor().exec, { env: {} }));
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.reason).toContain(PROXY_HOME_VAR);
  });

  it('fails with ql-proxy\'s own words when up refuses', async () => {
    const { ctx, client } = context(repo());
    const refusal = Object.assign(new Error('Command failed'), { stderr: 'a lifetime of 0 minutes needs ttl.maxMinutes: 0' });
    const outcome = await deployPreview(ctx, deps(executor({ up: refusal }).exec));

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.reason).toContain('ttl.maxMinutes');
    expect(client.postComment).not.toHaveBeenCalled();
  });

  it('fails when up printed no URL, quoting what it did print', async () => {
    const { ctx } = context(repo());
    const outcome = await deployPreview(ctx, deps(executor({ up: 'nothing is routed\n' }).exec));
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.reason).toContain('nothing is routed');
  });

  it('waits for the MCP server, bounded by the configured timeout, and reports it either way', async () => {
    const { ctx, client } = context(repo());
    const probe = vi.fn(() => Promise.resolve(false));
    const d = deps(executor().exec, { probeMcp: probe });

    const outcome = await deployPreview(ctx, d);

    expect(outcome).toMatchObject({ kind: 'deployed', mcpUrl: 'http://172.19.0.4:8080/mcp', mcpReady: false });
    // 30s timeout, 5s polls: the first probe at t=0, then one per sleep until the deadline.
    expect(probe.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(probe.mock.calls.length).toBeLessThanOrEqual(8);
    const body = (client.postComment.mock.calls[0] as unknown as [unknown, string])[1];
    expect(body).toContain('not answering');
  });

  it('still reports the preview when the MCP container cannot be found, so the tester can say so', async () => {
    const { ctx, logger } = context(repo());
    const outcome = await deployPreview(ctx, deps(executor({ ps: '\n' }).exec));

    expect(outcome).toMatchObject({ kind: 'deployed', url: URL, mcpUrl: null, mcpReady: false });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no container for service backend'));
  });

  it('prints the token beside the URL when ql-proxy handed one over', async () => {
    const { ctx, client } = context(repo());
    const locked = LISTING.replace('"protected":false', '"protected":true');
    await deployPreview(ctx, deps(executor({ up: `${URL}\ntoken: 9f1c2d3e\n`, list: locked }).exec));

    const body = (client.postComment.mock.calls[0] as unknown as [unknown, string])[1];
    expect(body).toContain('`9f1c2d3e`');
    expect(body).toContain('asks for it once');
  });
});
