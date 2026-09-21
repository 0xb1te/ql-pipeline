import { describe, expect, it, vi } from 'vitest';
import { McpUnreachableError, type McpClient } from '../../src/tester/mcp-client.js';
import type { TestCase } from '../../src/tester/test-plan.js';
import { formatTesterComment, runTestPlan, testerFindings } from '../../src/tester/tester.js';

const PLAN_PATH = 'docs/features/007-statistics-dashboard/testing-plan.xlsx';

function testCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    caseId: 'TASK007-1',
    featureArea: 'backend',
    precondition: 'seed.sql fixture "cat-6" exists',
    call: 'list_items',
    input: { categoryId: 'cat-6' },
    expected: 'Returns exactly the 6 seeded items',
    severity: 'blocker',
    row: 2,
    ...overrides,
  };
}

function client(impl: McpClient['callTool']): McpClient {
  return { listTools: () => Promise.resolve([]), callTool: impl };
}

describe('runTestPlan', () => {
  it('runs every case in order and collects as it goes', async () => {
    const seen: string[] = [];
    const run = await runTestPlan(
      client((name) => {
        seen.push(name);
        return Promise.resolve({ content: 'ok', isError: false });
      }),
      [testCase({ caseId: 'A', call: 'one' }), testCase({ caseId: 'B', call: 'two' })],
    );
    expect(seen).toEqual(['one', 'two']);
    expect(run.outcomes.every((o) => o.kind === 'pass')).toBe(true);
    expect(run.abandoned).toBeNull();
  });

  it('keeps going after a case fails — one broken tool must not cost the other results', async () => {
    const run = await runTestPlan(
      client((name) => {
        if (name === 'broken') return Promise.reject(new Error('boom'));
        return Promise.resolve({ content: 'ok', isError: false });
      }),
      [testCase({ caseId: 'A', call: 'broken' }), testCase({ caseId: 'B', call: 'fine' })],
    );
    expect(run.outcomes).toHaveLength(2);
    expect(run.outcomes[0]?.kind).toBe('fail');
    expect(run.outcomes[1]?.kind).toBe('pass');
  });

  it('treats a tool that reports isError as a failed case', async () => {
    const run = await runTestPlan(client(() => Promise.resolve({ content: 'nope', isError: true })), [testCase()]);
    expect(run.outcomes[0]?.kind).toBe('fail');
  });

  it('abandons the run when the server becomes unreachable, and says after how many', async () => {
    let calls = 0;
    const run = await runTestPlan(
      client(() => {
        calls += 1;
        if (calls > 1) return Promise.reject(new McpUnreachableError('connection refused'));
        return Promise.resolve({ content: 'ok', isError: false });
      }),
      [testCase({ caseId: 'A' }), testCase({ caseId: 'B' }), testCase({ caseId: 'C' })],
    );
    expect(run.outcomes).toHaveLength(1);
    expect(run.abandoned?.after).toBe(1);
  });
});

describe('testerFindings', () => {
  it('maps blocker to must and the advisory severities to should', () => {
    const run = {
      outcomes: [
        { kind: 'fail' as const, testCase: testCase({ caseId: 'A', severity: 'blocker' }), obtained: 'x', why: 'w' },
        { kind: 'fail' as const, testCase: testCase({ caseId: 'B', severity: 'major' }), obtained: 'x', why: 'w' },
        { kind: 'fail' as const, testCase: testCase({ caseId: 'C', severity: 'minor' }), obtained: 'x', why: 'w' },
      ],
      abandoned: null,
    };
    expect(testerFindings(run, PLAN_PATH).map((f) => f.severity)).toEqual(['must', 'should', 'should']);
  });

  it('reports nothing when everything passed', () => {
    const run = { outcomes: [{ kind: 'pass' as const, testCase: testCase(), obtained: 'ok' }], abandoned: null };
    expect(testerFindings(run, PLAN_PATH)).toEqual([]);
  });

  it('carries a reproduction — a failure without one is a complaint, not a finding', () => {
    const run = {
      outcomes: [{ kind: 'fail' as const, testCase: testCase(), obtained: 'got 3 items', why: 'the tool reported an error' }],
      abandoned: null,
    };
    const [finding] = testerFindings(run, PLAN_PATH);
    expect(finding?.problem).toContain('TASK007-1');
    expect(finding?.problem).toContain('list_items');
    expect(finding?.problem).toContain('{"categoryId":"cat-6"}');
    expect(finding?.problem).toContain('Returns exactly the 6 seeded items');
    expect(finding?.problem).toContain('got 3 items');
    expect(finding?.file).toBe(PLAN_PATH);
    expect(finding?.line).toBe(2);
  });

  it('turns an unreachable preview into a blocking finding, not a swallowed hiccup', () => {
    const findings = testerFindings({ outcomes: [], abandoned: { after: 0, reason: 'ECONNREFUSED' } }, PLAN_PATH);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('must');
    expect(findings[0]?.rule).toBe('tester#preview-unreachable');
  });
});

describe('formatTesterComment', () => {
  const failing = {
    outcomes: [
      { kind: 'fail' as const, testCase: testCase({ caseId: 'A' }), obtained: 'got 3', why: 'w' },
      { kind: 'fail' as const, testCase: testCase({ caseId: 'B', severity: 'minor' as const }), obtained: 'got 0', why: 'w' },
      { kind: 'pass' as const, testCase: testCase({ caseId: 'C' }), obtained: 'ok' },
    ],
    abandoned: null,
  };

  it('is ONE comment carrying every failure together', () => {
    const comment = formatTesterComment(failing, [testCase({ caseId: 'A' }), testCase({ caseId: 'B' }), testCase({ caseId: 'C' })], PLAN_PATH);
    expect(comment).toContain('`A`');
    expect(comment).toContain('`B`');
    expect(comment).toContain('2 of 3 case(s) failed');
    expect(comment).toContain('1 blocker');
  });

  it('counts the passes rather than listing them', () => {
    const comment = formatTesterComment(failing, [testCase(), testCase(), testCase()], PLAN_PATH);
    expect(comment).toContain('1 passed');
    expect(comment).not.toContain('`C`');
  });

  it('says so plainly when everything passed', () => {
    const run = { outcomes: [{ kind: 'pass' as const, testCase: testCase(), obtained: 'ok' }], abandoned: null };
    expect(formatTesterComment(run, [testCase()], PLAN_PATH)).toContain('All 1 case(s)');
  });

  it('reports the cases that never ran when the preview died mid-run', () => {
    const run = {
      outcomes: [{ kind: 'fail' as const, testCase: testCase(), obtained: 'x', why: 'w' }],
      abandoned: { after: 1, reason: 'ECONNREFUSED' },
    };
    const comment = formatTesterComment(run, [testCase(), testCase(), testCase()], PLAN_PATH);
    expect(comment).toContain('2 never ran');
    expect(comment).toContain('ECONNREFUSED');
  });

  it('escapes a pipe so one bad response cannot break the table', () => {
    const run = {
      outcomes: [{ kind: 'fail' as const, testCase: testCase(), obtained: 'a | b', why: 'w' }],
      abandoned: null,
    };
    expect(formatTesterComment(run, [testCase()], PLAN_PATH)).toContain('a \\| b');
  });
});

describe('the one-comment rule', () => {
  it('posts nothing until the whole plan has finished', async () => {
    // The requirement, stated as a test: a per-case comment turns a twenty-case plan into
    // twenty notifications and hands a fixer twenty prompts for one root cause.
    const post = vi.fn();
    const cases = [testCase({ caseId: 'A' }), testCase({ caseId: 'B' })];
    const run = await runTestPlan(client(() => Promise.resolve({ content: 'x', isError: true })), cases);
    expect(post).not.toHaveBeenCalled();
    post(formatTesterComment(run, cases, PLAN_PATH));
    expect(post).toHaveBeenCalledTimes(1);
  });
});
