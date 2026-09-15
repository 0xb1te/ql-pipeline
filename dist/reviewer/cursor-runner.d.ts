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
    /** Cursor CLI `--model` slug. Omitted: the CLI's own default for this API key. */
    readonly model?: string;
}
/**
 * Pure argv for `cursor-agent`. Extracted so tests can assert `--model`
 * without spawning.
 *
 * The prompt is deliberately NOT here — it goes in on stdin. See
 * {@link runCursorAgent}.
 */
export declare function cursorAgentArgs(options: CursorAgentRunOptions): string[];
export type CursorAgentRunner = (prompt: string, options: CursorAgentRunOptions) => Promise<CursorAgentInvocation>;
/**
 * Invokes the real `cursor-agent` CLI. The prompt (PR diff, complaint JSON,
 * etc. — all PR-derived, untrusted content) is written to the child's stdin,
 * never interpolated into a shell string, so shell metacharacters in it are
 * inert (RULES.md R5.4).
 *
 * It used to be a single argv element, which is where this failed: Linux
 * refuses any one argument over MAX_ARG_STRLEN (131072 bytes) with
 * `spawn E2BIG`, and a single ql-docs review pack is already larger than
 * that. stdin has no such ceiling, so the prompt can be as large as the model
 * will accept. `cursor-agent` takes its prompt from stdin when none is given
 * positionally.
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
