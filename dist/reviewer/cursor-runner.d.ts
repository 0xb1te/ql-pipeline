import { type WorktreeState } from '../shared/worktree.js';
export interface CursorAgentInvocation {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
}
export type CursorAgentMode = 'ask' | 'agent';
export interface CursorAgentRunOptions {
    readonly cwd: string;
    readonly mode: CursorAgentMode;
}
export type CursorAgentRunner = (prompt: string, options: CursorAgentRunOptions) => Promise<CursorAgentInvocation>;
/**
 * Invokes the real `cursor-agent` CLI. The prompt (PR diff, complaint JSON,
 * etc. — all PR-derived, untrusted content) is passed as a single argv
 * element via `spawn`, never interpolated into a shell string, so shell
 * metacharacters in it are inert (RULES.md R5.4).
 *
 * `--mode ask` is read-only (used for review); its absence means the
 * default full agent mode, which can write/run commands, paired with
 * `--force` so a headless run never blocks on an interactive permission
 * prompt (used for fixing, Phase 4). `--trust` avoids a workspace-trust
 * prompt on a checkout `cursor-agent` has never seen before.
 */
export declare const runCursorAgent: CursorAgentRunner;
/**
 * The reviewer runs in read-only mode, but a mode flag is a prompt-level
 * instruction, not a guarantee — this checks the checkout was actually left
 * untouched, by comparing a snapshot taken before the agent ran against one
 * taken after. Either snapshot being unavailable (not a git repo, git
 * missing) counts as "modified": if read-only behaviour cannot be verified,
 * it is never assumed.
 */
export declare function reviewerMutatedCheckout(before: WorktreeState | null, after: WorktreeState | null): boolean;
