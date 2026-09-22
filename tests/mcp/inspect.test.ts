import { describe, expect, it, vi } from 'vitest';
import { INSPECT_TOOLS, runInspectTool, type InspectDeps } from '../../src/mcp/inspect.js';
import type { ToolResult } from '../../src/mcp/tools.js';
import type { GithubClient, LabelledPullRequest } from '../../src/shared/github-client.js';
import type { Finding, GateOutcome, PipelineConfig } from '../../src/shared/types.js';

function config(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    gates: { frontend: { build: 'npm run build', test: 'npm test' } },
    merge: {
      targetBranch: 'main',
      targetBranchByArea: {},
      method: 'merge',
      deleteBranch: true,
      requiredChecks: ['build', 'test', 'ai-review'],
      requireHumanApproval: true,
    },
    fixer: { maxFixAttempts: 3, protectedPaths: [], fixAdvisory: true },
    agent: { provider: 'cursor', model: null, baseUrl: null, review: { model: null }, fix: { model: null } },
    areas: { paths: {} },
    standards: { enabled: false, root: '.standards', docs: {}, maxCharsPerArea: 1000 },
    preview: { enabled: true, ttlMinutes: 120, protect: true, mcp: { service: 'backend', port: 8080, path: '/mcp', readyTimeoutSeconds: 180 } },
    ...overrides,
  };
}

function outcome(overrides: Partial<GateOutcome> = {}): GateOutcome {
  return { area: 'frontend', gate: 'test', command: 'npm test', passed: true, output: '', ...overrides };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: 'must',
    rule: 'frontend/no-inline-style',
    file: 'src/App.tsx',
    line: 12,
    problem: 'inline style',
    suggestedFix: null,
    autoFixable: true,
    ...overrides,
  };
}

/** Every dep injected, so nothing here touches a disk, a network, or process.env. */
function deps(overrides: Partial<InspectDeps> = {}): InspectDeps {
  return {
    fileExists: () => true,
    loadPipelineConfig: () => config(),
    readReports: () => ({ ok: true, outcomes: [] }),
    env: {},
    ...overrides,
  };
}

/** Parses a tool result's JSON body. Every success path returns one. */
function body(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

async function call(name: string, args: unknown, overrides: Partial<InspectDeps> = {}): Promise<ToolResult> {
  const result = await runInspectTool(name, args, deps(overrides));
  if (result === null) {
    throw new Error(`expected ${name} to be an inspection tool`);
  }
  return result;
}

describe('INSPECT_TOOLS', () => {
  it('declares an object input schema for every tool', () => {
    for (const tool of INSPECT_TOOLS) {
      expect(tool.inputSchema['type']).toBe('object');
      expect(tool.inputSchema['additionalProperties']).toBe(false);
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('says read-only in every description, because that is the whole promise', () => {
    for (const tool of INSPECT_TOOLS) {
      expect(tool.description).toContain('Read-only');
    }
  });
});

describe('runInspectTool', () => {
  it('answers null for a tool it does not own, so the caller can fall through to its own dispatch', async () => {
    await expect(runInspectTool('ql_pipeline_doctor', {}, deps())).resolves.toBeNull();
    await expect(runInspectTool('nonsense', {}, deps())).resolves.toBeNull();
  });
});

describe('ql_pipeline_route', () => {
  it('reports the areas, rule files and gates a PR routes to', async () => {
    const result = await call('ql_pipeline_route', {
      root: '/repo',
      commitMessages: ['feat(frontend): add a toggle'],
    });

    expect(result.isError).toBe(false);
    const payload = body(result.content[0]?.text ?? '');
    expect(payload['routable']).toBe(true);
    expect(payload['areas']).toEqual(['frontend']);
    expect(payload['types']).toEqual(['feat']);
    expect(payload['ruleFiles']).toEqual(['_common.rules', 'frontend.rules']);
    expect(payload['gates']).toEqual([{ area: 'frontend', build: 'npm run build', test: 'npm test' }]);
    expect(payload['targetBranch']).toBe('main');
  });

  it('falls back to the PR title exactly as the pipeline does', async () => {
    const result = await call('ql_pipeline_route', {
      commitMessages: ['wip'],
      prTitle: 'fix(backend): correct the rounding',
    });

    expect(body(result.content[0]?.text ?? '')['areas']).toEqual(['backend']);
  });

  it('reports an unroutable PR as an answer, not as a tool failure', async () => {
    const result = await call('ql_pipeline_route', { commitMessages: ['wip'], prTitle: 'no header here' });

    // isError would tell an agent the tool broke. Unroutable is a verdict the pipeline reaches.
    expect(result.isError).toBe(false);
    const payload = body(result.content[0]?.text ?? '');
    expect(payload['routable']).toBe(false);
    expect(String(payload['reason'])).toContain('no commit on this PR matches');
  });

  it('asks for something to route when given neither commits nor a title', async () => {
    const result = await call('ql_pipeline_route', {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('nothing to route');
  });

  it('reports a repo with no pipeline config instead of throwing', async () => {
    const result = await call('ql_pipeline_route', { commitMessages: ['feat(frontend): x'] }, { fileExists: () => false });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('no pipeline config found');
  });

  it('turns a malformed config into an error result rather than a transport error', async () => {
    const result = await call(
      'ql_pipeline_route',
      { commitMessages: ['feat(frontend): x'] },
      {
        loadPipelineConfig: () => {
          throw new Error('invalid pipeline config in "<config>": merge.target_branch is required');
        },
      },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('merge.target_branch is required');
  });

  it('honours an explicit configPath over the probed defaults', async () => {
    const loadPipelineConfig = vi.fn((_path: string) => config());
    await call('ql_pipeline_route', { root: '/repo', configPath: 'custom.yml', commitMessages: ['feat(frontend): x'] }, {
      loadPipelineConfig,
    });

    expect(loadPipelineConfig).toHaveBeenCalledTimes(1);
    expect(String(loadPipelineConfig.mock.calls[0]?.[0])).toContain('custom.yml');
  });
});

describe('ql_pipeline_gate_reports', () => {
  it('reports what the gate jobs left behind', async () => {
    const result = await call(
      'ql_pipeline_gate_reports',
      { root: '/repo' },
      { readReports: () => ({ ok: true, outcomes: [outcome({ passed: false, output: '3 failing' })] }) },
    );

    expect(result.isError).toBe(false);
    const payload = body(result.content[0]?.text ?? '');
    expect(payload['outcomes']).toEqual([
      { area: 'frontend', gate: 'test', command: 'npm test', passed: false, output: '3 failing' },
    ]);
  });

  it('says so plainly when no reports exist, rather than returning a bare empty list', async () => {
    const result = await call('ql_pipeline_gate_reports', {});

    expect(result.isError).toBe(false);
    expect(String(body(result.content[0]?.text ?? '')['note'])).toContain('no gate reports found');
  });

  it('passes the pipeline\'s own fail-closed answer through for an unreadable report', async () => {
    const result = await call(
      'ql_pipeline_gate_reports',
      {},
      { readReports: () => ({ ok: false, reason: 'could not read gate report "test.json": not JSON' }) },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('could not read gate report');
  });
});

describe('ql_pipeline_verdict', () => {
  it('reaches MERGE when the gates passed and nothing blocks', async () => {
    const result = await call(
      'ql_pipeline_verdict',
      {},
      { readReports: () => ({ ok: true, outcomes: [outcome()] }) },
    );

    const payload = body(result.content[0]?.text ?? '');
    expect(payload['verdict']).toBe('MERGE');
    expect(payload['blockingFindings']).toEqual([]);
    expect(payload['aiReviewRequired']).toBe(true);
    expect(String(payload['note'])).toContain('Nothing was merged');
  });

  it('turns a failed required gate into a blocking finding and a FIX', async () => {
    const result = await call(
      'ql_pipeline_verdict',
      {},
      { readReports: () => ({ ok: true, outcomes: [outcome({ passed: false, output: 'boom' })] }) },
    );

    const payload = body(result.content[0]?.text ?? '');
    expect(payload['verdict']).toBe('FIX');
    expect(payload['findingsFromGates']).toBe(1);
    expect(Array.isArray(payload['blockingFindings']) && payload['blockingFindings'].length).toBe(1);
  });

  it('BLOCKs on a finding no agent can fix', async () => {
    const result = await call('ql_pipeline_verdict', { findings: [finding({ autoFixable: false })] });

    const payload = body(result.content[0]?.text ?? '');
    expect(payload['verdict']).toBe('BLOCK');
    expect(payload['reason']).toBe('one or more findings require a human (not auto-fixable)');
  });

  it('counts prior fix attempts from the commit messages, the way the pipeline counts them', async () => {
    const result = await call('ql_pipeline_verdict', {
      findings: [finding(), finding(), finding()],
      commitMessages: ['fix(frontend): a [bot]', 'fix(frontend): b [bot]', 'fix(frontend): c [bot]'],
    });

    const payload = body(result.content[0]?.text ?? '');
    expect(payload['attemptsSoFar']).toBe(3);
    expect(payload['verdict']).toBe('BLOCK');
    expect(payload['reason']).toBe('max fix attempts (3) reached');
  });

  it('keeps advisory findings separate from blocking ones', async () => {
    const result = await call('ql_pipeline_verdict', {
      findings: [finding({ severity: 'should' }), finding({ severity: 'security' })],
    });

    const payload = body(result.content[0]?.text ?? '');
    expect(Array.isArray(payload['advisoryFindings']) && payload['advisoryFindings'].length).toBe(1);
    expect(Array.isArray(payload['blockingFindings']) && payload['blockingFindings'].length).toBe(1);
  });

  it('refuses a finding whose severity did not survive the trip, rather than guessing one', async () => {
    const result = await call('ql_pipeline_verdict', { findings: [{ severity: 'critical', autoFixable: true }] });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('findings[0].severity must be one of');
  });

  it('refuses a finding with no autoFixable, which would silently change the verdict', async () => {
    const result = await call('ql_pipeline_verdict', { findings: [{ severity: 'must' }] });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('findings[0].autoFixable must be a boolean');
  });

  it('refuses findings that are not an array', async () => {
    const result = await call('ql_pipeline_verdict', { findings: 'lots' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('"findings" must be an array');
  });
});

/** A whole client of spies, so "it only reads" can be asserted rather than claimed. */
function spyClient(pulls: readonly LabelledPullRequest[] = []): GithubClient {
  return {
    listCommitMessages: vi.fn().mockResolvedValue([]),
    listChangedFiles: vi.fn().mockResolvedValue([]),
    getPullRequestDetails: vi.fn().mockResolvedValue({ description: '', diff: '' }),
    addLabels: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    postComment: vi.fn().mockResolvedValue(undefined),
    approveWithComments: vi.fn().mockResolvedValue(undefined),
    requestChangesWithComments: vi.fn().mockResolvedValue([]),
    commentReviewWithThreads: vi.fn().mockResolvedValue([]),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
    listComments: vi.fn().mockResolvedValue([]),
    mergePullRequest: vi.fn().mockResolvedValue(undefined),
    getHeadSha: vi.fn().mockResolvedValue('sha'),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    commentReview: vi.fn().mockResolvedValue(undefined),
    listReviewThreads: vi.fn().mockResolvedValue([]),
    resolveReviewThread: vi.fn().mockResolvedValue(undefined),
    listPullRequestsByLabel: vi.fn().mockResolvedValue(pulls),
  };
}

function pull(overrides: Partial<LabelledPullRequest> = {}): LabelledPullRequest {
  return {
    number: 31,
    title: 'feat(infrastructure): something',
    url: 'https://github.com/0xb1te/ql-pipeline/pull/31',
    isDraft: false,
    labels: ['needs-human'],
    updatedAt: '2026-09-20T10:00:00Z',
    ...overrides,
  };
}

describe('ql_pipeline_human_queue', () => {
  it('reads both queues by default', async () => {
    const client = spyClient([pull()]);
    const result = await call(
      'ql_pipeline_human_queue',
      { owner: '0xb1te', repo: 'ql-pipeline' },
      { env: { GITHUB_TOKEN: 'token' }, createClient: () => client },
    );

    expect(result.isError).toBe(false);
    const payload = body(result.content[0]?.text ?? '');
    const queues = payload['queues'] as { label: string; count: number }[];
    expect(queues.map((entry) => entry.label)).toEqual(['needs-human', 'ready-to-merge']);
    expect(client.listPullRequestsByLabel).toHaveBeenCalledWith({ owner: '0xb1te', repo: 'ql-pipeline' }, 'needs-human');
    expect(client.listPullRequestsByLabel).toHaveBeenCalledWith(
      { owner: '0xb1te', repo: 'ql-pipeline' },
      'ready-to-merge',
    );
  });

  it('reads one queue when asked for one', async () => {
    const client = spyClient([]);
    const result = await call(
      'ql_pipeline_human_queue',
      { owner: '0xb1te', repo: 'ql-pipeline', queue: 'ready-to-merge' },
      { env: { GITHUB_TOKEN: 'token' }, createClient: () => client },
    );

    const queues = body(result.content[0]?.text ?? '')['queues'] as { label: string }[];
    expect(queues.map((entry) => entry.label)).toEqual(['ready-to-merge']);
    expect(client.listPullRequestsByLabel).toHaveBeenCalledTimes(1);
  });

  // The promise this whole module makes. A regression here is the one that matters.
  it('writes nothing: no label, comment, approval, push or merge', async () => {
    const client = spyClient([pull()]);
    await call(
      'ql_pipeline_human_queue',
      { owner: '0xb1te', repo: 'ql-pipeline' },
      { env: { GITHUB_TOKEN: 'token' }, createClient: () => client },
    );

    expect(client.addLabels).not.toHaveBeenCalled();
    expect(client.removeLabel).not.toHaveBeenCalled();
    expect(client.postComment).not.toHaveBeenCalled();
    expect(client.approveWithComments).not.toHaveBeenCalled();
    expect(client.requestChangesWithComments).not.toHaveBeenCalled();
    expect(client.commentReview).not.toHaveBeenCalled();
    expect(client.mergePullRequest).not.toHaveBeenCalled();
    expect(client.deleteBranch).not.toHaveBeenCalled();
    expect(client.resolveReviewThread).not.toHaveBeenCalled();
  });

  it('asks for a token instead of failing at the transport layer', async () => {
    const result = await call('ql_pipeline_human_queue', { owner: '0xb1te', repo: 'ql-pipeline' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('GITHUB_TOKEN');
  });

  it('requires owner and repo', async () => {
    const result = await call('ql_pipeline_human_queue', { owner: '0xb1te' }, { env: { GITHUB_TOKEN: 'token' } });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('"owner" and "repo" are both required');
  });

  it('rejects a queue name it does not know', async () => {
    const result = await call(
      'ql_pipeline_human_queue',
      { owner: '0xb1te', repo: 'ql-pipeline', queue: 'everything' },
      { env: { GITHUB_TOKEN: 'token' }, createClient: () => spyClient() },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('"queue" must be one of');
  });

  it('reports a GitHub failure as an error result, not an exception', async () => {
    const client = spyClient();
    client.listPullRequestsByLabel = vi.fn().mockRejectedValue(new Error('Bad credentials'));

    const result = await call(
      'ql_pipeline_human_queue',
      { owner: '0xb1te', repo: 'ql-pipeline' },
      { env: { GITHUB_TOKEN: 'token' }, createClient: () => client },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Bad credentials');
  });
});
