import { describe, expect, it, vi } from 'vitest';
import {
  agentsFixerCredentialsFromEnv,
  buildAgentsBrief,
  runAgentsFix,
  type AgentsFixerCredentials,
} from '../../src/fixer/agents-fixer.js';
import type { Finding } from '../../src/shared/types.js';

vi.mock('@0xb1te/ql-auth-client', () => ({
  QlAuthClient: class {
    issueToken(): Promise<{ access_token: string }> {
      return Promise.resolve({ access_token: 'token-abc' });
    }
  },
}));

const CREDENTIALS: AgentsFixerCredentials = {
  agentsUrl: 'https://agents.example.com',
  worktreeBaseDir: '/srv/worktrees',
  qlAuthUrl: 'https://auth.example.com',
  qlAuthClientId: 'id',
  qlAuthClientSecret: 'secret',
};

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: 'must',
    rule: 'review.standards#MUST',
    file: 'src/a.ts',
    line: 42,
    problem: 'the cast is wrong',
    suggestedFix: null,
    autoFixable: true,
    ...overrides,
  };
}

/** A fetch that answers the dispatch once, then every poll with `statuses` in order. */
function stubFetch(statuses: readonly string[], runId = 'run-7'): typeof fetch {
  let poll = 0;
  const impl = (input: unknown): Promise<Response> => {
    if (String(input).endsWith('/v1/runs')) {
      return Promise.resolve(new Response(JSON.stringify({ runId }), { status: 202 }));
    }
    const status = statuses[Math.min(poll, statuses.length - 1)];
    poll += 1;
    return Promise.resolve(new Response(JSON.stringify({ status }), { status: 200 }));
  };
  return impl;
}

/** A request body as the test wrote it: always a JSON string, never a stream. */
function sentBody(init: RequestInit | undefined): Record<string, unknown> {
  return typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
}

const NO_WAIT = {
  sleep: (): Promise<void> => Promise.resolve(),
  pollIntervalMs: 0,
};

describe('agentsFixerCredentialsFromEnv', () => {
  const full = {
    QL_AGENTS_URL: 'https://agents.example.com',
    QL_AGENTS_WORKTREE_BASE: '/srv/worktrees',
    QL_AUTH_URL: 'https://auth.example.com',
    QL_AUTH_CLIENT_ID: 'id',
    QL_AUTH_CLIENT_SECRET: 'secret',
  };

  it('reads all five variables', () => {
    expect(agentsFixerCredentialsFromEnv(full)).toEqual(CREDENTIALS);
  });

  it('is undefined when any one of them is missing, rather than half-configured', () => {
    // Undefined is not an error here. A fleet that fixes with the in-process cursor agent never
    // publishes ql-agents; only *asking* for the provider without it is a misconfiguration, and
    // that judgement belongs to the caller.
    for (const key of Object.keys(full)) {
      const partial: Record<string, string> = { ...full };
      delete partial[key];
      expect(agentsFixerCredentialsFromEnv(partial), `missing ${key}`).toBeUndefined();
    }
  });

  it('treats a blank variable as absent', () => {
    expect(agentsFixerCredentialsFromEnv({ ...full, QL_AGENTS_WORKTREE_BASE: '   ' })).toBeUndefined();
  });
});

describe('buildAgentsBrief', () => {
  it('names every finding with its rule, place and problem', () => {
    const brief = buildAgentsBrief([finding(), finding({ file: 'src/b.ts', line: 7 })], []);

    expect(brief).toContain('review.standards#MUST at src/a.ts:42');
    expect(brief).toContain('src/b.ts:7');
    expect(brief).toContain('the cast is wrong');
  });

  it('carries a suggested fix when the review offered one', () => {
    expect(buildAgentsBrief([finding({ suggestedFix: 'widen the type' })], [])).toContain('widen the type');
  });

  it('states the protected paths, because this provider cannot revert them', () => {
    // runFix reverts protected paths in its own working tree before committing. ql-agents works
    // on its own host and pushes the branch itself, so there is no moment where this process
    // holds the diff — the brief plus R4 on the next run is the whole guard.
    const brief = buildAgentsBrief([finding()], ['rules/', '.github/workflows/']);

    expect(brief).toContain('rules/');
    expect(brief).toContain('.github/workflows/');
    expect(brief).toMatch(/do not edit/i);
  });

  it('says nothing about protected paths when a repo declares none', () => {
    expect(buildAgentsBrief([finding()], [])).not.toMatch(/do not edit/i);
  });
});

describe('runAgentsFix', () => {
  const options = {
    credentials: CREDENTIALS,
    repoUrl: 'https://github.com/0xb1te/ql-pipeline.git',
    branch: 'bugfixes/001-x',
    taskId: 'pr-42',
    worktreeBaseDir: '/srv/worktrees',
    protectedPaths: ['rules/'],
    attemptNumber: 1,
    ...NO_WAIT,
  };

  it('announces the run id before the run has finished', async () => {
    // The whole reason the dispatch is not simply awaited. The id exists at 202, and a reader
    // should learn an agent has the findings then, not minutes later when it is done.
    const seen: string[] = [];
    const order: string[] = [];

    await runAgentsFix([finding()], 'backend', {
      ...options,
      fetchImpl: stubFetch(['running', 'completed']),
      onDispatched: (runId) => {
        seen.push(runId);
        order.push('announced');
        return Promise.resolve();
      },
      sleep: () => {
        order.push('waited');
        return Promise.resolve();
      },
    });

    expect(seen).toEqual(['run-7']);
    expect(order[0]).toBe('announced');
  });

  it('reports a completed run as committed', async () => {
    const outcome = await runAgentsFix([finding()], 'backend', {
      ...options,
      fetchImpl: stubFetch(['completed']),
    });

    expect(outcome.kind).toBe('committed');
  });

  it('keeps polling while the run is queued or running', async () => {
    const outcome = await runAgentsFix([finding()], 'backend', {
      ...options,
      fetchImpl: stubFetch(['queued', 'running', 'running', 'completed']),
    });

    expect(outcome.kind).toBe('committed');
  });

  it('reports a failed or cancelled run as an agent error, naming the run', async () => {
    for (const status of ['failed', 'cancelled']) {
      const outcome = await runAgentsFix([finding()], 'backend', {
        ...options,
        fetchImpl: stubFetch([status]),
      });

      expect(outcome.kind).toBe('agent-error');
      if (outcome.kind === 'agent-error') {
        expect(outcome.reason).toContain('run-7');
        expect(outcome.reason).toContain(status);
      }
    }
  });

  it('sends implement mode, the branch and the model ql-pipeline resolved', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const impl = (input: unknown, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      calls.push({ url, body: sentBody(init) });
      if (url.endsWith('/v1/runs')) {
        return Promise.resolve(new Response(JSON.stringify({ runId: 'run-7' }), { status: 202 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ status: 'completed' }), { status: 200 }));
    };
    const fetchImpl = impl as unknown as typeof fetch;

    await runAgentsFix([finding()], 'backend', { ...options, fetchImpl, model: 'some-model' });

    const dispatch = calls[0]?.body ?? {};
    expect(dispatch['mode']).toBe('implement');
    expect(dispatch['branch']).toBe('bugfixes/001-x');
    expect(dispatch['model']).toBe('some-model');
    expect(dispatch['worktree']).toEqual({ baseDir: '/srv/worktrees', taskId: 'pr-42' });
  });

  it('omits the model entirely when none is configured', async () => {
    let dispatch: Record<string, unknown> = {};
    const impl = (input: unknown, init?: RequestInit): Promise<Response> => {
      if (String(input).endsWith('/v1/runs')) {
        dispatch = sentBody(init);
        return Promise.resolve(new Response(JSON.stringify({ runId: 'run-7' }), { status: 202 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ status: 'completed' }), { status: 200 }));
    };
    const fetchImpl = impl as unknown as typeof fetch;

    await runAgentsFix([finding()], 'backend', { ...options, fetchImpl });

    expect('model' in dispatch).toBe(false);
  });

  it('does not abandon a running agent because the pickup comment failed', async () => {
    // The run is already executing by then. Failing it over an unposted comment would be the
    // messenger undoing the message.
    const outcome = await runAgentsFix([finding()], 'backend', {
      ...options,
      fetchImpl: stubFetch(['completed']),
      onDispatched: () => Promise.reject(new Error('GitHub said no')),
    });

    expect(outcome.kind).toBe('committed');
  });

  it('reports a refused dispatch without ever announcing a pickup', async () => {
    const announced: string[] = [];
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'nope' }), { status: 400 })),
    ) as unknown as typeof fetch;

    const outcome = await runAgentsFix([finding()], 'backend', {
      ...options,
      fetchImpl,
      onDispatched: (id) => {
        announced.push(id);
        return Promise.resolve();
      },
    });

    expect(outcome.kind).toBe('agent-error');
    expect(announced).toEqual([]);
  });

  it('refuses an accepted dispatch that carried no run id', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 202 })),
    ) as unknown as typeof fetch;

    const outcome = await runAgentsFix([finding()], 'backend', { ...options, fetchImpl });

    expect(outcome.kind).toBe('agent-error');
    if (outcome.kind === 'agent-error') {
      expect(outcome.reason).toContain('no run id');
    }
  });

  it('gives up once the timeout passes rather than polling forever', async () => {
    let clock = 0;
    const outcome = await runAgentsFix([finding()], 'backend', {
      ...options,
      fetchImpl: stubFetch(['running']),
      timeoutMs: 1_000,
      now: () => {
        clock += 600;
        return clock;
      },
    });

    expect(outcome.kind).toBe('agent-error');
    if (outcome.kind === 'agent-error') {
      expect(outcome.reason).toContain('did not finish');
    }
  });
});
