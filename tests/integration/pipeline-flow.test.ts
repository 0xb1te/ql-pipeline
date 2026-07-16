import { describe, expect, it, vi } from 'vitest';
import { countFixAttempts } from '../../src/fixer/attempt-counter.js';
import { runFix } from '../../src/fixer/fixer.js';
import { runGates } from '../../src/router/gate-runner.js';
import { determineRoute } from '../../src/router/router.js';
import { executeMergeDecision } from '../../src/merger/merger.js';
import type { CursorAgentRunner } from '../../src/reviewer/cursor-runner.js';
import { runReview } from '../../src/reviewer/reviewer.js';
import type { GithubClient } from '../../src/shared/github-client.js';
import type { CommandExecutor } from '../../src/shared/exec.js';
import type { Finding, PipelineConfig } from '../../src/shared/types.js';
import { decidePipelineOutcome } from '../../src/verdict/verdict.js';

/**
 * Threads commit-parser -> router -> gate-runner -> reviewer -> verdict ->
 * merger (and, for UC2, the fixer) together end to end, exactly as main.ts
 * does. Every true I/O boundary (shelling out, invoking cursor-agent,
 * calling the GitHub API) is a fake; everything in between is the real
 * pipeline logic. This covers both exit criteria from
 * docs/001-first-task-base-project/plan.md §7:
 * - Phase 3: "UC1 (clean frontend PR auto-merges) working end-to-end."
 * - Phase 4: "UC2 works end-to-end: flawed PR gets fixed by the bot and
 *   merges; or after max_fix_attempts, block."
 */

const CONFIG: PipelineConfig = {
  gates: {
    frontend: { build: 'npm run build', test: 'npm test' },
  },
  merge: { targetBranch: 'main', method: 'merge', deleteBranch: true, requiredChecks: ['build', 'test', 'ai-review'] },
  fixer: { maxFixAttempts: 3, protectedPaths: ['rules/', 'prompts/', 'pipeline.config.yml', '.github/workflows/'] },
};

const PR = { owner: '0xb1te', repo: 'ql-pipeline', number: 7, headRef: 'task/007-dark-mode' };

const CLEAN_DIFF = [
  'diff --git a/src/components/ThemeToggle.tsx b/src/components/ThemeToggle.tsx',
  '+++ b/src/components/ThemeToggle.tsx',
  '@@ -0,0 +1,3 @@',
  '+export function ThemeToggle() {',
  '+  return null;',
  '+}',
].join('\n');

function envelope(result: string): string {
  return JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result });
}

function fakeGithubClient(): GithubClient {
  return {
    listCommitMessages: vi.fn().mockResolvedValue(['feat(frontend): add dark-mode toggle']),
    getPullRequestDetails: vi
      .fn()
      .mockResolvedValue({ description: 'Adds a dark-mode toggle component.', diff: CLEAN_DIFF }),
    addLabels: vi.fn().mockResolvedValue(undefined),
    approveWithComments: vi.fn().mockResolvedValue(undefined),
    requestChangesWithComments: vi.fn().mockResolvedValue(undefined),
    mergePullRequest: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
  };
}

function cleanGitExecutor(): CommandExecutor {
  return vi.fn<CommandExecutor>().mockResolvedValue({ stdout: '', stderr: '' });
}

describe('UC1: a clean frontend PR routes, gates, reviews clean, and auto-merges', () => {
  it('runs the full pipeline and ends in MERGE', async () => {
    const githubClient = fakeGithubClient();
    const commitMessages = await githubClient.listCommitMessages(PR);

    const route = determineRoute({ commitMessages, prTitle: 'feat(frontend): add dark-mode toggle' }, CONFIG);
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    expect(route.decision.areas).toEqual(['frontend']);

    const buildTestExecutor = vi.fn<CommandExecutor>().mockResolvedValue({ stdout: 'ok', stderr: '' });
    const gateOutcomes = await runGates(route.decision.gates, { cwd: '/repo', exec: buildTestExecutor });
    expect(gateOutcomes.every((outcome) => outcome.passed)).toBe(true);

    const reviewAgentRunner = vi
      .fn<CursorAgentRunner>()
      .mockResolvedValue({ stdout: envelope('{"verdict":"PASS","findings":[]}'), stderr: '', exitCode: 0 });

    const reviewResult = await runReview(
      {
        areas: route.decision.areas,
        ruleFiles: route.decision.ruleFiles,
        rulesText: '## MUST\n- no inline styles',
        gateOutcomes,
        prDescription: 'Adds a dark-mode toggle component.',
        diff: CLEAN_DIFF,
      },
      'Rules:\n{{RULES}}\nDiff:\n{{DIFF}}',
      { cwd: '/repo', agentRunner: reviewAgentRunner, commandExecutor: cleanGitExecutor() },
    );
    expect(reviewResult.ok).toBe(true);
    if (!reviewResult.ok) return;
    expect(reviewResult.outcome.findings).toEqual([]);

    const decision = decidePipelineOutcome({
      findings: reviewResult.outcome.findings,
      attemptsSoFar: 0,
      maxFixAttempts: CONFIG.fixer.maxFixAttempts,
    });
    expect(decision.kind).toBe('MERGE');
    if (decision.kind !== 'MERGE') return;

    await executeMergeDecision(githubClient, PR, decision.advisoryFindings, CONFIG.merge);

    expect(githubClient.approveWithComments).toHaveBeenCalledWith(PR, []);
    expect(githubClient.mergePullRequest).toHaveBeenCalledWith(PR, 'merge');
    expect(githubClient.deleteBranch).toHaveBeenCalledWith(PR);
  });
});

describe('UC2 (review portion): a flawed backend PR produces a FIX decision, not MERGE or a silent BLOCK', () => {
  it('routes the finding through to FIX when it is auto-fixable and attempts remain', async () => {
    const commitMessages = ['feat(backend): add payments endpoint'];
    const route = determineRoute({ commitMessages, prTitle: 'feat(backend): add payments endpoint' }, {
      ...CONFIG,
      gates: { backend: { build: 'npm run build', test: 'npm test' } },
    });
    expect(route.ok).toBe(true);
    if (!route.ok) return;

    const diff = [
      'diff --git a/src/api/payments.ts b/src/api/payments.ts',
      '+++ b/src/api/payments.ts',
      '@@ -0,0 +1,4 @@',
      '+export function getUser(userId: string) {',
      '+  const db = getConnection();',
      '+  return db.query("SELECT * FROM users WHERE id = " + userId);',
      '+}',
    ].join('\n');

    const flawedVerdict = {
      verdict: 'FAIL',
      findings: [
        {
          severity: 'security',
          rule: 'backend.rules#no-string-concat-sql',
          file: 'src/api/payments.ts',
          line: 3,
          problem: 'string-concatenated SQL allows injection',
          suggested_fix: 'use a parameterized query',
          auto_fixable: true,
        },
      ],
    };
    const reviewAgentRunner = vi
      .fn<CursorAgentRunner>()
      .mockResolvedValue({ stdout: envelope(JSON.stringify(flawedVerdict)), stderr: '', exitCode: 0 });

    const reviewResult = await runReview(
      {
        areas: route.decision.areas,
        ruleFiles: route.decision.ruleFiles,
        rulesText: '## SECURITY\n- no string-concatenated SQL',
        gateOutcomes: [],
        prDescription: 'Adds a payments endpoint.',
        diff,
      },
      'Rules:\n{{RULES}}\nDiff:\n{{DIFF}}',
      { cwd: '/repo', agentRunner: reviewAgentRunner, commandExecutor: cleanGitExecutor() },
    );
    expect(reviewResult.ok).toBe(true);
    if (!reviewResult.ok) return;
    expect(reviewResult.outcome.findings).toHaveLength(1);

    const decision = decidePipelineOutcome({
      findings: reviewResult.outcome.findings,
      attemptsSoFar: 0,
      maxFixAttempts: CONFIG.fixer.maxFixAttempts,
    });

    expect(decision.kind).toBe('FIX');
    if (decision.kind === 'FIX') {
      expect(decision.findings[0]?.rule).toBe('backend.rules#no-string-concat-sql');
    }
  });

  it('escalates to BLOCK once max fix attempts are exhausted, for the same finding', () => {
    const stillFailing: Finding[] = [
      {
        severity: 'security',
        rule: 'backend.rules#no-string-concat-sql',
        file: 'src/api/payments.ts',
        line: 4,
        problem: 'string-concatenated SQL allows injection',
        suggestedFix: 'use a parameterized query',
        autoFixable: true,
      },
    ];

    const decision = decidePipelineOutcome({
      findings: stillFailing,
      attemptsSoFar: CONFIG.fixer.maxFixAttempts,
      maxFixAttempts: CONFIG.fixer.maxFixAttempts,
    });

    expect(decision.kind).toBe('BLOCK');
  });
});

describe('UC2 full loop: a flawed PR gets fixed by the bot and merges on re-review', () => {
  const diff = [
    'diff --git a/src/api/payments.ts b/src/api/payments.ts',
    '+++ b/src/api/payments.ts',
    '@@ -0,0 +1,4 @@',
    '+export function getUser(userId: string) {',
    '+  const db = getConnection();',
    '+  return db.query("SELECT * FROM users WHERE id = " + userId);',
    '+}',
  ].join('\n');

  const flawedVerdict = JSON.stringify({
    verdict: 'FAIL',
    findings: [
      {
        severity: 'security',
        rule: 'backend.rules#no-string-concat-sql',
        file: 'src/api/payments.ts',
        line: 3,
        problem: 'string-concatenated SQL allows injection',
        suggested_fix: 'use a parameterized query',
        auto_fixable: true,
      },
    ],
  });

  it('attempt 1: reviews the flaw, fixes it, commits, and pushes', async () => {
    const firstPassCommits = ['feat(backend): add payments endpoint'];
    const attemptsSoFar = countFixAttempts(firstPassCommits);
    expect(attemptsSoFar).toBe(0);

    const reviewAgentRunner = vi
      .fn<CursorAgentRunner>()
      .mockResolvedValue({ stdout: envelope(flawedVerdict), stderr: '', exitCode: 0 });

    const reviewResult = await runReview(
      {
        areas: ['backend'],
        ruleFiles: ['_common.rules', 'backend.rules'],
        rulesText: '## SECURITY\n- no string-concatenated SQL',
        gateOutcomes: [],
        prDescription: 'Adds a payments endpoint.',
        diff,
      },
      'Rules:\n{{RULES}}\nDiff:\n{{DIFF}}',
      { cwd: '/repo', agentRunner: reviewAgentRunner, commandExecutor: cleanGitExecutor() },
    );
    expect(reviewResult.ok).toBe(true);
    if (!reviewResult.ok) return;

    const decision = decidePipelineOutcome({
      findings: reviewResult.outcome.findings,
      attemptsSoFar,
      maxFixAttempts: CONFIG.fixer.maxFixAttempts,
    });
    expect(decision.kind).toBe('FIX');
    if (decision.kind !== 'FIX') return;

    // The fake exec reports the tree as dirty after the (fake) agent
    // "fixed" the SQL injection, simulating a real edit having landed.
    const fixExec = vi.fn<CommandExecutor>().mockResolvedValue({ stdout: ' M src/api/payments.ts\n', stderr: '' });
    const fixAgentRunner = vi.fn<CursorAgentRunner>().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    const fixOutcome = await runFix(decision.findings, 'fix {{ATTEMPT_NUMBER}}/{{MAX_ATTEMPTS}}: {{COMPLAINT}}', 'backend', {
      cwd: '/repo',
      branch: 'task/009-payments',
      protectedPaths: CONFIG.fixer.protectedPaths,
      attemptNumber: attemptsSoFar + 1,
      maxFixAttempts: CONFIG.fixer.maxFixAttempts,
      agentRunner: fixAgentRunner,
      commandExecutor: fixExec,
    });

    expect(fixOutcome).toEqual({
      kind: 'committed',
      commitMessage: 'fix(backend): resolve pipeline complaint (attempt 1) [bot]',
    });
    expect(fixAgentRunner).toHaveBeenCalledWith(expect.any(String), { cwd: '/repo', mode: 'agent' });
  });

  it('attempt 2 (after the push re-triggers the pipeline): re-review is clean, so it merges', async () => {
    // The push from attempt 1 added this commit; the pipeline re-runs and
    // fetches the PR's commits fresh, now including it.
    const secondPassCommits = [
      'feat(backend): add payments endpoint',
      'fix(backend): resolve pipeline complaint (attempt 1) [bot]',
    ];
    const attemptsSoFar = countFixAttempts(secondPassCommits);
    expect(attemptsSoFar).toBe(1);

    const reviewAgentRunner = vi
      .fn<CursorAgentRunner>()
      .mockResolvedValue({ stdout: envelope('{"verdict":"PASS","findings":[]}'), stderr: '', exitCode: 0 });

    const reviewResult = await runReview(
      {
        areas: ['backend'],
        ruleFiles: ['_common.rules', 'backend.rules'],
        rulesText: '## SECURITY\n- no string-concatenated SQL',
        gateOutcomes: [],
        prDescription: 'Adds a payments endpoint.',
        diff: diff.replace('" + userId', '", [userId]'), // now parameterized
      },
      'Rules:\n{{RULES}}\nDiff:\n{{DIFF}}',
      { cwd: '/repo', agentRunner: reviewAgentRunner, commandExecutor: cleanGitExecutor() },
    );
    expect(reviewResult.ok).toBe(true);
    if (!reviewResult.ok) return;

    const decision = decidePipelineOutcome({
      findings: reviewResult.outcome.findings,
      attemptsSoFar,
      maxFixAttempts: CONFIG.fixer.maxFixAttempts,
    });
    expect(decision.kind).toBe('MERGE');
    if (decision.kind !== 'MERGE') return;

    const client = fakeGithubClient();
    await executeMergeDecision(client, PR, decision.advisoryFindings, CONFIG.merge);

    expect(client.mergePullRequest).toHaveBeenCalledWith(PR, 'merge');
  });
});
