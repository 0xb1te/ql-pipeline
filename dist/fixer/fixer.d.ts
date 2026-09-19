import { type CursorAgentRunner } from '../reviewer/cursor-runner.js';
import { type CommandExecutor } from '../shared/exec.js';
import type { Area, Finding } from '../shared/types.js';
export type FixOutcome = {
    readonly kind: 'committed';
    readonly commitMessage: string;
    readonly files: readonly string[];
} | {
    readonly kind: 'no-changes';
} | {
    readonly kind: 'agent-error';
    readonly reason: string;
};
export interface RunFixOptions {
    readonly cwd: string;
    readonly branch: string;
    readonly protectedPaths: readonly string[];
    readonly attemptNumber: number;
    readonly maxFixAttempts: number;
    /**
     * What people said on the PR, already filtered of the pipeline's own comments.
     *
     * The reviewer sees this too, but the fixer is the one that writes code - an instruction like
     * "use the existing helper" only changes anything if it reaches the agent doing the editing.
     */
    readonly humanDirection?: string;
    readonly model?: string;
    readonly agentRunner?: CursorAgentRunner;
    readonly commandExecutor?: CommandExecutor;
}
/**
 * Runs one fix attempt: invokes cursor-agent in its default, write-capable
 * mode (paired with `--force` so a headless run never blocks on an
 * interactive permission prompt), hard-reverts any edits to protected paths
 * regardless of what the agent did (RULES.md R4), and — only if that leaves
 * real changes behind — commits and pushes with pipeline-authored commit
 * hygiene. The agent never commits or pushes itself; it only produces a
 * working-tree diff for the pipeline to act on.
 */
export declare function runFix(findings: readonly Finding[], promptTemplate: string, area: Area, options: RunFixOptions): Promise<FixOutcome>;
