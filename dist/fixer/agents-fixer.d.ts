import type { Area, Finding } from '../shared/types.js';
import type { FixOutcome } from './fixer.js';
export declare const AGENTS_URL_VAR = "QL_AGENTS_URL";
export declare const AGENTS_WORKTREE_BASE_VAR = "QL_AGENTS_WORKTREE_BASE";
export interface AgentsFixerCredentials {
    readonly agentsUrl: string;
    /**
     * Where ql-agents puts the worktree, on ql-agents' own filesystem.
     *
     * It has to be configured rather than defaulted because it is a path on a machine this
     * process never sees. A wrong guess fails the run after the dispatch has already been
     * announced, which is the one failure that would make the pickup comment a lie.
     */
    readonly worktreeBaseDir: string;
    readonly qlAuthUrl: string;
    readonly qlAuthClientId: string;
    readonly qlAuthClientSecret: string;
}
/**
 * Everything needed to reach ql-agents, or undefined when this fleet has not published one.
 *
 * Undefined is not an error, for the same reason it is not one in the sprint notifier: a fleet
 * can govern perfectly well with the in-process cursor fixer and never run ql-agents at all.
 * What makes it an error is *asking* for the `ql_agents` provider without it, and that judgement
 * belongs to the caller, which is the only thing that knows which provider was configured.
 *
 * It reuses the ql-auth credentials the standards hop already needs, so a fleet that has those
 * and publishes ql-agents only has to add `QL_AGENTS_URL`.
 */
export declare function agentsFixerCredentialsFromEnv(env?: NodeJS.ProcessEnv): AgentsFixerCredentials | undefined;
/**
 * The complaint, as the brief a coding agent is given.
 *
 * Protected paths are stated in the brief because with this provider they cannot be enforced the
 * way the cursor fixer enforces them. `runFix` reverts them in its own working tree before it
 * commits; ql-agents works in a worktree on its own host and pushes the branch itself, so there
 * is no moment where this process holds the diff. The backstop is R4 on the run that push
 * triggers — `touchesProtectedPaths` escalates the pull request to a human and refuses to
 * auto-merge it — so a violation is caught and blocked rather than silently merged. Saying so
 * here is what makes the weaker guarantee deliberate instead of accidental.
 */
export declare function buildAgentsBrief(findings: readonly Finding[], protectedPaths: readonly string[]): string;
export interface RunAgentsFixOptions {
    readonly credentials: AgentsFixerCredentials;
    readonly repoUrl: string;
    readonly branch: string;
    readonly taskId: string;
    readonly worktreeBaseDir: string;
    readonly protectedPaths: readonly string[];
    readonly attemptNumber: number;
    readonly model?: string;
    /** What people said on the pull request, already filtered of the pipeline's own comments. */
    readonly humanDirection?: string;
    /**
     * Called once, the moment ql-agents accepts the run and before it has done anything.
     *
     * This is the whole reason the dispatch is not simply awaited: the run id exists at `202`, and
     * a reader watching the pull request should learn that a named agent has the findings *then*,
     * not several minutes later when it finishes. Best-effort by contract — a reply that fails
     * must not abandon a run that is already executing.
     */
    readonly onDispatched?: (runId: string) => Promise<void>;
    /** How long to wait for the run to finish before giving up on it. */
    readonly timeoutMs?: number;
    readonly pollIntervalMs?: number;
    readonly fetchImpl?: typeof fetch;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly now?: () => number;
}
/**
 * Runs one fix attempt through ql-agents instead of spawning `cursor-agent` in this process.
 *
 * The provider indirection is the point. `runFix` is welded to the Cursor CLI: it spawns a
 * binary, diffs its own working tree and commits what it finds. Everything about that is Cursor,
 * and changing model vendor meant changing the fixer. ql-agents already owns "run a coding agent
 * against a branch" for the rest of the suite, so routing through it makes the vendor a
 * descriptor on the far side rather than a code path here.
 *
 * The shape of the work moves with it. ql-agents clones the repository into a worktree on its own
 * host and pushes the branch itself, so this function never holds a diff: it dispatches, reports
 * the run id, waits, and reads the verdict. That is also why protected paths are a brief and an
 * R4 backstop rather than a revert — see {@link buildAgentsBrief}.
 */
export declare function runAgentsFix(findings: readonly Finding[], area: Area, options: RunAgentsFixOptions): Promise<FixOutcome>;
