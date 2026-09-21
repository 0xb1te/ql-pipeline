import type { Finding } from '../shared/types.js';
import { type McpClient } from './mcp-client.js';
import type { TestCase } from './test-plan.js';
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
export type CaseOutcome = {
    readonly kind: 'pass';
    readonly testCase: TestCase;
    readonly obtained: string;
} | {
    readonly kind: 'fail';
    readonly testCase: TestCase;
    readonly obtained: string;
    readonly why: string;
};
export interface TesterRun {
    readonly outcomes: readonly CaseOutcome[];
    /** Set when the run stopped early. The preview dying mid-run is itself worth reporting. */
    readonly abandoned: {
        readonly after: number;
        readonly reason: string;
    } | null;
}
/**
 * Whether a case passed.
 *
 * Deliberately shallow: a tool that answered without an error flag, and whose rendered response
 * contains the expected text when the expectation looks like a literal. Anything cleverer - a
 * model judging whether the response "means" the expected thing - would make a test suite whose
 * verdict changes between runs, and a flaky blocker is worse than no blocker.
 */
export declare function judgeCase(testCase: TestCase, result: {
    content: unknown;
    isError: boolean;
}): CaseOutcome;
/**
 * Drives every case in order, collecting as it goes and staying silent throughout.
 *
 * A case that throws is a failed case, not a failed run - one broken tool must not cost the
 * other nineteen results. The exception is the MCP server becoming unreachable: that is not an
 * infrastructure hiccup to swallow but a finding about the feature, and once it is gone there is
 * nothing left to test, so the run is abandoned and says so.
 */
export declare function runTestPlan(client: McpClient, cases: readonly TestCase[]): Promise<TesterRun>;
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
export declare function testerFindings(run: TesterRun, planPath: string): readonly Finding[];
/**
 * The single comment, posted once, when everything has finished.
 *
 * Passing cases are counted rather than listed. A reader needs to know the plan ran and how much
 * of it held; twenty green lines push the failures off the screen, which is the opposite of what
 * a report is for.
 */
export declare function formatTesterComment(run: TesterRun, cases: readonly TestCase[], planPath: string): string;
