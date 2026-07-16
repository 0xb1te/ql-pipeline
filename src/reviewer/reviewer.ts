import { defaultCommandExecutor, type CommandExecutor } from '../shared/exec.js';
import type { Area, Finding, GateOutcome, ReviewVerdict } from '../shared/types.js';
import { runCursorAgent, isWorkingTreeClean, type CursorAgentRunner } from './cursor-runner.js';
import { buildDiffLineIndex, groundFindings } from './diff-grounding.js';
import { parseReviewVerdict, type ParseResult } from './response-parser.js';

export interface ReviewContext {
  readonly areas: readonly Area[];
  readonly ruleFiles: readonly string[];
  readonly rulesText: string;
  readonly gateOutcomes: readonly GateOutcome[];
  readonly prDescription: string;
  readonly diff: string;
}

/** Substitutes the placeholders documented in prompts/reviewer.md. */
export function buildReviewPrompt(template: string, context: ReviewContext): string {
  return template
    .replaceAll('{{AREAS}}', context.areas.join(', '))
    .replaceAll('{{RULES}}', context.rulesText)
    .replaceAll('{{GATE_RESULTS}}', formatGateResults(context.gateOutcomes))
    .replaceAll('{{PR_DESCRIPTION}}', context.prDescription)
    .replaceAll('{{DIFF}}', context.diff);
}

function formatGateResults(outcomes: readonly GateOutcome[]): string {
  if (outcomes.length === 0) {
    return '(no gates were configured for the matched areas)';
  }
  return outcomes
    .map((outcome) => {
      const status = outcome.passed ? 'PASSED' : 'FAILED';
      const detail = outcome.passed ? '' : `\n  ${outcome.output}`;
      return `- ${outcome.area}/${outcome.gate}: ${status}${detail}`;
    })
    .join('\n');
}

export interface ReviewOutcome {
  readonly findings: readonly Finding[];
  readonly discarded: readonly { readonly finding: Finding; readonly reason: string }[];
}

export type ReviewResult = { readonly ok: true; readonly outcome: ReviewOutcome } | { readonly ok: false; readonly reason: string };

export interface RunReviewOptions {
  readonly cwd: string;
  readonly agentRunner?: CursorAgentRunner;
  readonly commandExecutor?: CommandExecutor;
}

/**
 * Runs the AI reviewer against a PR: builds the prompt, invokes cursor-agent
 * in read-only (`ask`) mode, verifies the checkout wasn't mutated despite
 * that, parses the strict JSON verdict (retrying the invocation once if
 * parsing fails — real responses observed in testing sometimes wrap the
 * JSON in conversational text; a second attempt is worth it before giving
 * up), and applies the grounding requirement to the resulting findings.
 */
export async function runReview(context: ReviewContext, promptTemplate: string, options: RunReviewOptions): Promise<ReviewResult> {
  const agentRunner = options.agentRunner ?? runCursorAgent;
  const commandExecutor = options.commandExecutor ?? defaultCommandExecutor;
  const prompt = buildReviewPrompt(promptTemplate, context);

  let attempt = await invokeAndParse(agentRunner, prompt, options.cwd);
  if (!attempt.ok) {
    attempt = await invokeAndParse(agentRunner, prompt, options.cwd);
  }

  const clean = await isWorkingTreeClean(options.cwd, commandExecutor);
  if (!clean) {
    return {
      ok: false,
      reason: 'the reviewer checkout was modified during a read-only review invocation; treating this run as BLOCK',
    };
  }

  if (!attempt.ok) {
    return { ok: false, reason: `reviewer response was unusable even after a retry: ${attempt.reason}` };
  }

  const diffIndex = buildDiffLineIndex(context.diff);
  const { grounded, discarded } = groundFindings(attempt.value.findings, diffIndex, context.ruleFiles);

  return { ok: true, outcome: { findings: grounded, discarded } };
}

async function invokeAndParse(
  agentRunner: CursorAgentRunner,
  prompt: string,
  cwd: string,
): Promise<ParseResult<ReviewVerdict>> {
  const invocation = await agentRunner(prompt, { cwd, mode: 'ask' });
  if (invocation.exitCode !== 0) {
    return { ok: false, reason: `cursor-agent exited with code ${invocation.exitCode}: ${invocation.stderr}` };
  }
  return parseReviewVerdict(invocation.stdout);
}
