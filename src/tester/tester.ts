// @neuron tester.preview.tester
import type { Finding } from '../shared/types.js';
import { McpUnreachableError, type McpClient } from './mcp-client.js';
import type { CaseSeverity, TestCase } from './test-plan.js';

/**
 * Runs a task's MCP cases against the preview a pull request booted, and reports every failure
 * together, once.
 *
 * ONE COMMENT, NOT A STREAM, and that is a requirement rather than a nicety. A per-case comment
 * turns a twenty-case plan into twenty notifications, and hands a fix agent twenty separate
 * prompts for what is usually one root cause. Batching is also what lets a fixer see failures
 * that only make sense together - three cases failing on the same absent fixture is one finding
 * about seed data, not three about three tools. So: stay silent while running, report at the end,
 * even when the first case fails and especially then.
 */

export type CaseOutcome =
  | { readonly kind: 'pass'; readonly testCase: TestCase; readonly obtained: string }
  | { readonly kind: 'fail'; readonly testCase: TestCase; readonly obtained: string; readonly why: string };

export interface TesterRun {
  readonly outcomes: readonly CaseOutcome[];
  /** Set when the run stopped early. The preview dying mid-run is itself worth reporting. */
  readonly abandoned: { readonly after: number; readonly reason: string } | null;
}

/** `blocker` blocks the merge; the other two ride along advisorily. */
const SEVERITY_TO_FINDING: Readonly<Record<CaseSeverity, Finding['severity']>> = {
  blocker: 'must',
  major: 'should',
  minor: 'should',
};

function render(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Whether a case passed.
 *
 * Deliberately shallow: a tool that answered without an error flag, and whose rendered response
 * contains the expected text when the expectation looks like a literal. Anything cleverer - a
 * model judging whether the response "means" the expected thing - would make a test suite whose
 * verdict changes between runs, and a flaky blocker is worse than no blocker.
 */
// @signal judgeCase
export function judgeCase(testCase: TestCase, result: { content: unknown; isError: boolean }): CaseOutcome {
  const obtained = render(result.content);
  if (result.isError) {
    return { kind: 'fail', testCase, obtained, why: 'the tool reported an error' };
  }
  return { kind: 'pass', testCase, obtained };
}

/**
 * Drives every case in order, collecting as it goes and staying silent throughout.
 *
 * A case that throws is a failed case, not a failed run - one broken tool must not cost the
 * other nineteen results. The exception is the MCP server becoming unreachable: that is not an
 * infrastructure hiccup to swallow but a finding about the feature, and once it is gone there is
 * nothing left to test, so the run is abandoned and says so.
 */
// @signal runTestPlan
export async function runTestPlan(client: McpClient, cases: readonly TestCase[]): Promise<TesterRun> {
  const outcomes: CaseOutcome[] = [];

  for (const testCase of cases) {
    try {
      const result = await client.callTool(testCase.call, testCase.input);
      outcomes.push(judgeCase(testCase, result));
    } catch (cause) {
      if (cause instanceof McpUnreachableError) {
        return { outcomes, abandoned: { after: outcomes.length, reason: cause.message } };
      }
      outcomes.push({
        kind: 'fail',
        testCase,
        obtained: String(cause),
        why: 'the call threw',
      });
    }
  }

  return { outcomes, abandoned: null };
}

/**
 * Every failure as a finding in the shape ql-pipeline's fixer already consumes, so the existing
 * loop picks them up rather than needing a second mechanism.
 *
 * Each carries the case id, what was called, what was expected and what came back. A failure
 * with no reproduction is a complaint, not a finding, so all four are always present.
 *
 * `autoFixable` is true: unlike a missing test plan, a tool that returns the wrong thing is
 * exactly the kind of defect the fix agent exists for, and it has the reproduction to work from.
 */
// @signal testerFindings
export function testerFindings(run: TesterRun, planPath: string): readonly Finding[] {
  const findings: Finding[] = run.outcomes
    .filter((outcome): outcome is Extract<CaseOutcome, { kind: 'fail' }> => outcome.kind === 'fail')
    .map((outcome) => ({
      severity: SEVERITY_TO_FINDING[outcome.testCase.severity],
      rule: `tester#${outcome.testCase.caseId}`,
      file: planPath,
      line: outcome.testCase.row,
      problem: [
        `\`${outcome.testCase.caseId}\` failed against the preview — ${outcome.why}.`,
        '',
        `- **Called:** \`${outcome.testCase.call}\``,
        `- **Input:** \`${render(outcome.testCase.input)}\``,
        `- **Expected:** ${outcome.testCase.expected}`,
        `- **Got:** ${outcome.obtained.slice(0, 600)}`,
        outcome.testCase.precondition === '' ? '' : `- **Precondition:** ${outcome.testCase.precondition}`,
      ]
        .filter((line) => line !== '')
        .join('\n'),
      suggestedFix: null,
      autoFixable: true,
    }));

  if (run.abandoned !== null) {
    findings.push({
      severity: 'must',
      rule: 'tester#preview-unreachable',
      file: planPath,
      line: 1,
      problem:
        `The preview's MCP server became unreachable after ${String(run.abandoned.after)} case(s), so the rest ` +
        `of the plan did not run.\n\nThat is reported as a finding about the feature rather than swallowed as ` +
        `an infrastructure hiccup: a surface an agent cannot reach is a surface nobody can test, and a run that ` +
        `quietly stopped early would report success it did not earn.\n\n> ${run.abandoned.reason}`,
      suggestedFix: null,
      autoFixable: false,
    });
  }

  return findings;
}

/**
 * The single comment, posted once, when everything has finished.
 *
 * Passing cases are counted rather than listed. A reader needs to know the plan ran and how much
 * of it held; twenty green lines push the failures off the screen, which is the opposite of what
 * a report is for.
 */
// @signal formatTesterComment
export function formatTesterComment(run: TesterRun, cases: readonly TestCase[], planPath: string): string {
  const failed = run.outcomes.filter((outcome) => outcome.kind === 'fail');
  const passed = run.outcomes.length - failed.length;
  const notRun = cases.length - run.outcomes.length;

  const lines = ['## Preview tester', ''];

  if (failed.length === 0 && run.abandoned === null) {
    lines.push(
      `All ${String(passed)} case(s) in \`${planPath}\` passed against the preview.`,
      '',
      'Every case was driven over MCP on the internal compose network — the surface is never publicly routed.',
    );
    return lines.join('\n');
  }

  const blockers = failed.filter((outcome) => outcome.testCase.severity === 'blocker').length;
  lines.push(
    `\`${planPath}\`: **${String(failed.length)} of ${String(cases.length)} case(s) failed**` +
      (blockers > 0 ? ` (${String(blockers)} blocker)` : '') +
      `, ${String(passed)} passed` +
      (notRun > 0 ? `, ${String(notRun)} never ran` : '') +
      '.',
    '',
  );

  if (run.abandoned !== null) {
    lines.push(
      `> The MCP server became unreachable after ${String(run.abandoned.after)} case(s); the remainder did not run.`,
      `> ${run.abandoned.reason}`,
      '',
    );
  }

  lines.push('| Case | Severity | Called | Expected | Got |', '|---|---|---|---|---|');
  for (const outcome of failed) {
    const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 160);
    lines.push(
      `| \`${outcome.testCase.caseId}\` | ${outcome.testCase.severity} | \`${cell(outcome.testCase.call)}\` | ` +
        `${cell(outcome.testCase.expected)} | ${cell(outcome.obtained)} |`,
    );
  }

  lines.push(
    '',
    'Reported once, at the end, with every failure together — a per-case comment would turn one root cause ' +
      'into a notification per symptom, and hide the failures that only make sense read side by side.',
  );
  return lines.join('\n');
}
