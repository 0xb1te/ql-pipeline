import type { PullRequestInfo } from '../shared/github-client.js';
import type { Logger } from '../shared/logger.js';
import { type AgentProvider, type Finding, type GateOutcome } from '../shared/types.js';
import { readSprintTasks, type SprintTaskList } from '../notifier/sprint-tasks.js';
/** Auto-fix still requires cursor-agent. An OpenAI-compatible review cannot write a fix commit. */
export declare function shouldSkipCursorFixer(provider: AgentProvider): boolean;
/**
 * Collects the reports the gate jobs left behind. A report that is present
 * but unreadable is fatal: the pipeline would otherwise merge a PR while
 * genuinely not knowing whether its tests passed.
 */
export declare function readGateReports(reportsDir: string, reader?: {
    exists: (p: string) => boolean;
    list: (p: string) => string[];
    read: (p: string) => string;
}): {
    ok: true;
    outcomes: GateOutcome[];
} | {
    ok: false;
    reason: string;
};
/**
 * Asks ql-sprint whether this pull request is a task anybody planned, and turns "no" into one
 * advisory finding.
 *
 * Three silences, and only one of them is a finding:
 *
 * - No ql-sprint configured at all: nothing, not even a log line. A repository governed by a fleet
 *   that runs no orchestrator has no sprint board to be missing from, exactly as it has no
 *   Telegram to be notified in.
 * - ql-sprint configured but unreachable, or answering something unreadable: a warning, and no
 *   finding. Absence of evidence is not evidence - a network that was down must never be reported
 *   on a pull request as "nobody asked for this".
 * - ql-sprint answered, and knows nothing about this pull request: the finding.
 *
 * `should` severity throughout, so it rides along on a MERGE as an advisory comment and can never
 * refuse a pull request - see verdict.decision.taskProvenance#decideTaskProvenance for why that is
 * the only defensible severity for it.
 */
export declare function taskProvenanceFindings(pr: Pick<PullRequestInfo, 'number' | 'headRef'>, logger: Pick<Logger, 'info' | 'warn'>, env?: NodeJS.ProcessEnv, readTasks?: (credentials: Parameters<typeof readSprintTasks>[0], env?: NodeJS.ProcessEnv) => Promise<SprintTaskList>): Promise<Finding[]>;
/**
 * The pipeline check: everything after the gates. Runs even when a gate
 * job failed, because a broken build is a finding the fix agent can repair
 * — halting the chain on a red gate would throw that away.
 */
export declare function runGovern(reportsDir: string): Promise<void>;
