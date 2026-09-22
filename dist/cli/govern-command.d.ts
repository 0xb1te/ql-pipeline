import type { PullRequestInfo, ReviewComment } from '../shared/github-client.js';
import type { Logger } from '../shared/logger.js';
import { type AgentProvider, type Finding, type GateOutcome, type RequiredCheck } from '../shared/types.js';
import { readSprintTasks, type SprintTaskList } from '../notifier/sprint-tasks.js';
import type { AreaPathsConfig } from '../shared/types.js';
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
 * What the R4 escalation says, and anything structural a human should see while they are here.
 *
 * The escalation returns before the review, the gates and the verdict ever run, so whatever this
 * comment omits is not reported anywhere else on that pull request. A task folder missing its test
 * plan was, until this carried it, silently unchecked on exactly the pull requests that get the
 * most human attention.
 *
 * Kept pure and separate from `escalateToHuman` so the composition is testable without a GitHub
 * client, the same way complaintReview is.
 */
export declare function protectedPathsComment(artifactFindings: readonly Finding[]): string;
/**
 * Whether a product repository carries the preview environment ql-docs mandates, as one finding.
 *
 * Structural, before the AI is consulted, for exactly the reason R4 is: whether a folder exists
 * and its compose file names an `edge` service is not a judgement, and a reviewer is the wrong
 * enforcement mechanism for a rule that cannot be argued with. Unlike the task-artifact check it
 * is a hard gate rather than an advisory finding - see previewEnvironmentRefusal for why - so the
 * caller fails the run on it rather than folding it into the verdict.
 */
export declare function previewEnvironmentFindings(consumerRoot: string, areaPaths: AreaPathsConfig, logger: Pick<Logger, 'info'>): readonly Finding[];
/**
 * What the pull request is told when its repository has no valid preview environment.
 *
 * A hard failure and not a `must` finding, deliberately. A finding rides into the verdict, which
 * is reached only after the gates are read and the AI review has run - so a repository that
 * cannot be previewed would still spend a review, and could be argued back from BLOCK to MERGE by
 * an attempt cap or a config. Nothing downstream of this can work without the folder: the deploy
 * job has nothing to bring up and the tester nothing to reach. Refusing here, before anything
 * is spent, is the honest shape.
 *
 * It is not an escalation either. The `needs-human` path exists for questions a person has to
 * adjudicate; a missing folder is fixed by its author, so the pull request simply fails and says
 * what is missing, exactly as an unroutable one does.
 */
export declare function previewEnvironmentRefusal(findings: readonly Finding[]): string;
/**
 * Whether the task folder this branch names carries the two artifacts an automated tester needs,
 * as one finding.
 *
 * Structural, and computed before the AI review is even considered, for the reason R4 is: whether
 * a file exists is not a judgement, and making a reviewer the enforcement mechanism for one turns
 * an unarguable check into a negotiable opinion.
 *
 * Unlike the protected-paths check above it does not escalate to a human. A missing test plan is
 * not something a person adjudicates - the author adds the file - so it rides the ordinary finding
 * path, where `must` blocks the merge and the message says what to copy from where.
 */
export declare function taskArtifactFindings(pr: Pick<PullRequestInfo, 'headRef'>, consumerRoot: string, requiredChecks: readonly RequiredCheck[], logger: Pick<Logger, 'info'>): readonly Finding[];
/** The job output the workflow reads to decide whether the `preview` job runs at all. */
export declare const DEPLOY_PREVIEW_OUTPUT = "deploy-preview";
/**
 * The whole request-changes review: the body, and the comments GitHub will actually accept.
 *
 * One function rather than two calls, because the two have to agree and once did not. A `must`
 * finding on a pseudo-path - which is what every failed *required* gate is - was sent to
 * `requestChangesWithComments` unfiltered and 422'd the run that existed to explain it. The filter
 * had been written, for the approval path, and the blocking path simply did not use it.
 *
 * Returning both together means the findings left out of `comments` are reported in `summary` by
 * construction, rather than by a caller remembering to pass them.
 */
export declare function complaintReview(findings: readonly Finding[], attemptNumber: number, maxFixAttempts: number, advisoryFindings?: readonly Finding[]): {
    readonly summary: string;
    readonly comments: readonly ReviewComment[];
};
/**
 * The pipeline check: everything after the gates. Runs even when a gate
 * job failed, because a broken build is a finding the fix agent can repair
 * — halting the chain on a red gate would throw that away.
 */
export declare function runGovern(reportsDir: string): Promise<void>;
