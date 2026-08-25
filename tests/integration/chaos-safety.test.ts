import { describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../../src/shared/config.js';
import { determineRoute } from '../../src/router/router.js';
import { touchesProtectedPaths } from '../../src/router/self-protection.js';
import { runGates } from '../../src/router/gate-runner.js';
import { runReview } from '../../src/reviewer/reviewer.js';
import { decidePipelineOutcome } from '../../src/verdict/verdict.js';
import type { CommandExecutor } from '../../src/shared/exec.js';
import type { CursorAgentRunner } from '../../src/reviewer/cursor-runner.js';
import type { Finding, PipelineConfig } from '../../src/shared/types.js';

/**
 * The Phase 5 exit criterion from
 * docs/001-first-task-base-project/plan.md §7: "Chaos-test malformed
 * commits, unfixable PRs, reviewer JSON garbage — all end in safe BLOCK
 * states." Each of these is already covered individually elsewhere in the
 * suite; this file exists to make the safety property explicit and
 * checkable in one place, rather than implicit across a dozen files.
 */

const CONFIG: PipelineConfig = {
  gates: { backend: { build: 'npm run build', test: 'npm test' } },
  merge: {
    targetBranch: 'main',
    targetBranchByArea: {},
    method: 'merge',
    deleteBranch: true,
    requiredChecks: ['build', 'test', 'ai-review'],
  },
  fixer: {
    maxFixAttempts: 3,
    protectedPaths: ['.github/workflows/', '.github/pipeline.config.yml', '.github/pipeline-rules/'],
  },
};

function cleanGitExecutor(): CommandExecutor {
  return vi.fn<CommandExecutor>().mockResolvedValue({ stdout: '', stderr: '' });
}

describe('chaos safety: malformed commits', () => {
  it('a PR with no conventional-commit-shaped commit or title is unroutable, never reaching gates/review', () => {
    const route = determineRoute({ commitMessages: ['wip', 'oops', 'asdf'], prTitle: 'fix stuff' }, CONFIG);

    expect(route.ok).toBe(false);
  });

  it('a completely empty PR (no commits, no usable title) is unroutable', () => {
    const route = determineRoute({ commitMessages: [], prTitle: '' }, CONFIG);

    expect(route.ok).toBe(false);
  });
});

describe('chaos safety: reviewer JSON garbage', () => {
  it('a response with no JSON object anywhere fails cleanly rather than being treated as PASS', async () => {
    const agentRunner = vi.fn<CursorAgentRunner>().mockResolvedValue({
      stdout: JSON.stringify({ type: 'result', is_error: false, result: "I couldn't complete this review." }),
      stderr: '',
      exitCode: 0,
    });

    const result = await runReview(
      { areas: ['backend'], ruleFiles: ['_common.rules'], rulesText: '', gateOutcomes: [], prDescription: '', diff: '' },
      'template',
      { cwd: '/repo', agentRunner, commandExecutor: cleanGitExecutor() },
    );

    expect(result.ok).toBe(false);
  });

  it('completely garbled, unparseable text fails cleanly even after the retry', async () => {
    const agentRunner = vi.fn<CursorAgentRunner>().mockResolvedValue({
      stdout: 'not even an envelope, just noise {{{',
      stderr: '',
      exitCode: 0,
    });

    const result = await runReview(
      { areas: ['backend'], ruleFiles: ['_common.rules'], rulesText: '', gateOutcomes: [], prDescription: '', diff: '' },
      'template',
      { cwd: '/repo', agentRunner, commandExecutor: cleanGitExecutor() },
    );

    expect(result.ok).toBe(false);
    expect(agentRunner).toHaveBeenCalledTimes(2); // retried once, then gave up
  });

  it('a reviewer that mutates its checkout despite read-only mode is never trusted, even with a clean-looking verdict', async () => {
    const agentRunner = vi.fn<CursorAgentRunner>().mockResolvedValue({
      stdout: JSON.stringify({ type: 'result', is_error: false, result: '{"verdict":"PASS","findings":[]}' }),
      stderr: '',
      exitCode: 0,
    });
    // Clean before the review, dirty after: the reviewer wrote to the tree.
    const dirtyExec = vi
      .fn<CommandExecutor>()
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: ' M src/sneaky.ts\n', stderr: '' });

    const result = await runReview(
      { areas: ['backend'], ruleFiles: ['_common.rules'], rulesText: '', gateOutcomes: [], prDescription: '', diff: '' },
      'template',
      { cwd: '/repo', agentRunner, commandExecutor: dirtyExec },
    );

    expect(result.ok).toBe(false);
  });
});

describe('chaos safety: unfixable PRs', () => {
  function finding(overrides: Partial<Finding> = {}): Finding {
    return {
      severity: 'security',
      rule: 'backend.rules#no-string-concat-sql',
      file: 'x.ts',
      line: 1,
      problem: 'p',
      suggestedFix: null,
      autoFixable: true,
      ...overrides,
    };
  }

  it('a not-auto-fixable finding blocks immediately, on the very first attempt', () => {
    const decision = decidePipelineOutcome({
      findings: [finding({ autoFixable: false })],
      attemptsSoFar: 0,
      maxFixAttempts: 3,
    });

    expect(decision.kind).toBe('BLOCK');
  });

  it('an auto-fixable finding still blocks once attempts are exhausted, rather than looping forever', () => {
    const decision = decidePipelineOutcome({
      findings: [finding({ autoFixable: true })],
      attemptsSoFar: 3,
      maxFixAttempts: 3,
    });

    expect(decision.kind).toBe('BLOCK');
  });

  it('a mix of fixable and unfixable findings blocks the whole PR rather than partially fixing it', () => {
    const decision = decidePipelineOutcome({
      findings: [finding({ autoFixable: true }), finding({ autoFixable: false, rule: 'other.rules#x' })],
      attemptsSoFar: 0,
      maxFixAttempts: 3,
    });

    expect(decision.kind).toBe('BLOCK');
  });
});

describe('chaos safety: self-protection and config', () => {
  it('a PR touching a protected workflow path is flagged regardless of anything else about it', () => {
    const touches = touchesProtectedPaths(
      ['src/index.ts', '.github/workflows/pr-pipeline.yml'],
      CONFIG.fixer.protectedPaths,
    );

    expect(touches).toBe(true);
  });

  it('a config file with invalid YAML fails to load rather than silently falling back to defaults', () => {
    expect(() => parseConfig('merge: [unterminated')).toThrow();
  });

  it('a config missing the required target_branch fails to load rather than guessing one', () => {
    expect(() => parseConfig('gates: {}')).toThrow(/merge/);
  });
});

describe('chaos safety: a crashing gate is a failure, not a silent pass', () => {
  it('an exec that throws produces a failed gate outcome, not a passed one', async () => {
    const crashingExec: CommandExecutor = vi.fn().mockRejectedValue(new Error('command not found'));

    const outcomes = await runGates([{ area: 'backend', build: 'nonexistent-tool' }], {
      cwd: '/repo',
      exec: crashingExec,
    });

    expect(outcomes[0]?.passed).toBe(false);
  });
});
