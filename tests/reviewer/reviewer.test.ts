import { describe, expect, it, vi } from 'vitest';
import { MAX_PROMPT_BYTES, buildReviewPrompt, runReview, type ReviewContext } from '../../src/reviewer/reviewer.js';
import type { CursorAgentInvocation, CursorAgentRunner } from '../../src/reviewer/cursor-runner.js';
import type { CommandExecutor } from '../../src/shared/exec.js';
import type { GateOutcome } from '../../src/shared/types.js';

const TEMPLATE = [
  'Areas: {{AREAS}}',
  'Rules:',
  '{{RULES}}',
  'Gates:',
  '{{GATE_RESULTS}}',
  'PR description: {{PR_DESCRIPTION}}',
  'Diff:',
  '{{DIFF}}',
].join('\n');

function context(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    areas: ['backend'],
    ruleFiles: ['_common.rules', 'backend.rules'],
    rulesText: '## MUST\n- no string-concat SQL',
    standardsText: '(no engineering standards are configured for the areas this PR touches)',
    gateOutcomes: [],
    prDescription: 'adds a payments endpoint',
    diff: 'diff --git a/x b/x\n+++ b/x\n@@ -0,0 +1,1 @@\n+const x = 1;\n',
    ...overrides,
  };
}

function cleanExecutor(): CommandExecutor {
  return vi.fn<CommandExecutor>().mockResolvedValue({ stdout: '', stderr: '' });
}

function envelope(result: string): string {
  return JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result });
}

function passResponse(): CursorAgentInvocation {
  return { stdout: envelope('{"verdict":"PASS","findings":[]}'), stderr: '', exitCode: 0 };
}

describe('buildReviewPrompt', () => {
  it('substitutes every placeholder', () => {
    const { prompt } = buildReviewPrompt(TEMPLATE, context());

    expect(prompt).toContain('Areas: backend');
    expect(prompt).toContain('no string-concat SQL');
    expect(prompt).toContain('PR description: adds a payments endpoint');
    expect(prompt).toContain('const x = 1;');
    expect(prompt).not.toContain('{{');
  });

  it('reports when no gates were configured', () => {
    const { prompt } = buildReviewPrompt(TEMPLATE, context({ gateOutcomes: [] }));

    expect(prompt).toContain('(no gates were configured for the matched areas)');
  });

  it('formats passing and failing gates, including failure output', () => {
    const gateOutcomes: GateOutcome[] = [
      { area: 'backend', gate: 'build', command: 'npm run build', passed: true, output: '' },
      { area: 'backend', gate: 'test', command: 'npm test', passed: false, output: '3 tests failed' },
    ];

    const { prompt } = buildReviewPrompt(TEMPLATE, context({ gateOutcomes }));

    expect(prompt).toContain('- backend/build: PASSED');
    expect(prompt).toContain('- backend/test: FAILED');
    expect(prompt).toContain('3 tests failed');
  });

  it('replaces every occurrence of a repeated placeholder', () => {
    const { prompt } = buildReviewPrompt('{{AREAS}} / {{AREAS}}', context({ areas: ['frontend'] }));

    expect(prompt).toBe('frontend / frontend');
  });
});

describe('buildReviewPrompt size ceiling', () => {
  const TEMPLATE = 'areas {{AREAS}} rules {{RULES}} standards {{STANDARDS}} gates {{GATE_RESULTS}} desc {{PR_DESCRIPTION}} diff {{DIFF}}';

  function ceilingContext(standardsText: string, diff = 'diff body'): ReviewContext {
    return {
      areas: ['frontend'],
      ruleFiles: ['_common.rules'],
      rulesText: 'rules body',
      standardsText,
      gateOutcomes: [],
      prDescription: 'desc',
      diff,
    };
  }

  function sections(count: number, filler: string): string {
    return Array.from({ length: count }, (_, i) => `## ${i} - section ${filler.repeat(400)}`).join(' ');
  }

  it('leaves a prompt that already fits untouched', () => {
    const { prompt } = buildReviewPrompt(TEMPLATE, ceilingContext('## 01 - small standards'));

    expect(prompt).toContain('small standards');
    expect(prompt).not.toContain('truncated to fit');
  });

  it('keeps the prompt spawnable when one area alone exceeds the limit', () => {
    // A real pack file is ~132KB, over Linux MAX_ARG_STRLEN by itself.
    const { prompt } = buildReviewPrompt(TEMPLATE, ceilingContext(sections(400, 'x')));

    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(MAX_PROMPT_BYTES);
    expect(prompt).toContain('truncated to fit');
  });

  it('bounds the TOTAL, not each area: two areas cannot each spend the cap', () => {
    // The actual bug. max_chars_per_area is per area, so a PR touching two
    // areas carried twice it and still blew past the argv limit.
    const twoAreas = `${sections(220, 'y')} ${sections(220, 'y')}`;
    const { prompt } = buildReviewPrompt(TEMPLATE, ceilingContext(twoAreas));

    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(MAX_PROMPT_BYTES);
  });

  it('never trims the diff or the rules to make room', () => {
    const { prompt } = buildReviewPrompt(TEMPLATE, ceilingContext(sections(400, 'z'), 'UNIQUE_DIFF_MARKER'));

    expect(prompt).toContain('UNIQUE_DIFF_MARKER');
    expect(prompt).toContain('rules body');
  });
});

describe('runReview', () => {
  it('returns a clean PASS with no findings', async () => {
    const agentRunner = vi.fn<CursorAgentRunner>().mockResolvedValue(passResponse());
    const exec = cleanExecutor();

    const result = await runReview(context(), TEMPLATE, { cwd: '/repo', agentRunner, commandExecutor: exec });

    expect(result).toEqual({
      ok: true,
      outcome: { findings: [], discarded: [] },
      // Carried on every outcome: a review whose standards were cut is
      // exactly the case a caller needs to be able to see.
      standardsTruncation: { truncated: false, standardsOmitted: false, droppedSections: [], droppedChars: 0 },
    });
    expect(agentRunner).toHaveBeenCalledTimes(1);
    expect(agentRunner).toHaveBeenCalledWith(expect.any(String), { cwd: '/repo', mode: 'ask' });
  });

  it('forwards a configured Cursor model to the agent runner', async () => {
    const agentRunner = vi.fn<CursorAgentRunner>().mockResolvedValue(passResponse());

    await runReview(context(), TEMPLATE, {
      cwd: '/repo',
      model: 'cursor-grok-4.6-xhigh-fast',
      agentRunner,
      commandExecutor: cleanExecutor(),
    });

    expect(agentRunner).toHaveBeenCalledWith(expect.any(String), {
      cwd: '/repo',
      mode: 'ask',
      model: 'cursor-grok-4.6-xhigh-fast',
    });
  });

  it('partitions grounded and ungrounded findings using the diff', async () => {
    const diff = 'diff --git a/x b/x\n+++ b/x\n@@ -1,1 +1,1 @@\n+bad line\n';
    const verdict = {
      verdict: 'FAIL',
      findings: [
        {
          severity: 'must',
          rule: 'backend.rules#no-string-concat-sql',
          file: 'x',
          line: 1,
          problem: 'bad',
          suggested_fix: null,
          auto_fixable: true,
        },
        {
          severity: 'must',
          rule: 'backend.rules#no-string-concat-sql',
          file: 'nonexistent.ts',
          line: 1,
          problem: 'ungrounded',
          suggested_fix: null,
          auto_fixable: true,
        },
      ],
    };
    const agentRunner = vi
      .fn<CursorAgentRunner>()
      .mockResolvedValue({ stdout: envelope(JSON.stringify(verdict)), stderr: '', exitCode: 0 });

    const result = await runReview(context({ diff }), TEMPLATE, {
      cwd: '/repo',
      agentRunner,
      commandExecutor: cleanExecutor(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome.findings).toHaveLength(1);
      expect(result.outcome.findings[0]?.file).toBe('x');
      expect(result.outcome.discarded).toHaveLength(1);
    }
  });

  it('retries once when the first response fails to parse, and succeeds if the retry parses', async () => {
    const agentRunner = vi
      .fn<CursorAgentRunner>()
      .mockResolvedValueOnce({ stdout: 'not json', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce(passResponse());

    const result = await runReview(context(), TEMPLATE, {
      cwd: '/repo',
      agentRunner,
      commandExecutor: cleanExecutor(),
    });

    expect(result).toEqual({
      ok: true,
      outcome: { findings: [], discarded: [] },
      // Carried on every outcome: a review whose standards were cut is
      // exactly the case a caller needs to be able to see.
      standardsTruncation: { truncated: false, standardsOmitted: false, droppedSections: [], droppedChars: 0 },
    });
    expect(agentRunner).toHaveBeenCalledTimes(2);
  });

  it('does not retry when the first response already parses', async () => {
    const agentRunner = vi.fn<CursorAgentRunner>().mockResolvedValue(passResponse());

    await runReview(context(), TEMPLATE, { cwd: '/repo', agentRunner, commandExecutor: cleanExecutor() });

    expect(agentRunner).toHaveBeenCalledTimes(1);
  });

  it('fails after both attempts are unparseable', async () => {
    const agentRunner = vi.fn<CursorAgentRunner>().mockResolvedValue({ stdout: 'still not json', stderr: '', exitCode: 0 });

    const result = await runReview(context(), TEMPLATE, {
      cwd: '/repo',
      agentRunner,
      commandExecutor: cleanExecutor(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/even after a retry/);
    }
    expect(agentRunner).toHaveBeenCalledTimes(2);
  });

  it('treats a non-zero cursor-agent exit code as a failed attempt (subject to retry)', async () => {
    const agentRunner = vi
      .fn<CursorAgentRunner>()
      .mockResolvedValue({ stdout: '', stderr: 'boom', exitCode: 1 });

    const result = await runReview(context(), TEMPLATE, {
      cwd: '/repo',
      agentRunner,
      commandExecutor: cleanExecutor(),
    });

    expect(result.ok).toBe(false);
    expect(agentRunner).toHaveBeenCalledTimes(2);
  });

  it('blocks when the checkout was mutated, even though the response parsed fine', async () => {
    const agentRunner = vi.fn<CursorAgentRunner>().mockResolvedValue(passResponse());
    // Clean before the review, dirty after it — i.e. the reviewer wrote.
    const mutatingExec = vi
      .fn<CommandExecutor>()
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: ' M src/evil.ts\n', stderr: '' });

    const result = await runReview(context(), TEMPLATE, { cwd: '/repo', agentRunner, commandExecutor: mutatingExec });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/modified during a read-only review/);
    }
  });

  it('tolerates build artifacts the gates left behind, since they predate the review', async () => {
    const agentRunner = vi.fn<CursorAgentRunner>().mockResolvedValue(passResponse());
    // Already dirty before the review, and unchanged by it.
    const artifactsExec = vi
      .fn<CommandExecutor>()
      .mockResolvedValue({ stdout: '?? dist/\n?? node_modules/\n', stderr: '' });

    const result = await runReview(context(), TEMPLATE, { cwd: '/repo', agentRunner, commandExecutor: artifactsExec });

    expect(result.ok).toBe(true);
  });

  it('blocks when the working tree cannot be inspected, rather than assuming it was untouched', async () => {
    const agentRunner = vi.fn<CursorAgentRunner>().mockResolvedValue(passResponse());
    const brokenExec = vi.fn<CommandExecutor>().mockRejectedValue(new Error('not a git repository'));

    const result = await runReview(context(), TEMPLATE, { cwd: '/repo', agentRunner, commandExecutor: brokenExec });

    expect(result.ok).toBe(false);
  });
});
