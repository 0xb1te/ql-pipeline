// @neuron review.reviewer.cursorRunner
import { spawn } from 'node:child_process';
import { worktreeChanged } from '../shared/worktree.js';
/**
 * Pure argv for `cursor-agent`. Extracted so tests can assert `--model`
 * without spawning.
 *
 * The prompt is deliberately NOT here — it goes in on stdin. See
 * {@link runCursorAgent}.
 */
// @signal cursorAgentArgs
export function cursorAgentArgs(options) {
    const args = ['--print', '--output-format', 'json', '--trust', '--workspace', options.cwd];
    if (options.model !== undefined && options.model !== '') {
        args.push('--model', options.model);
    }
    if (options.mode === 'ask') {
        args.push('--mode', 'ask');
    }
    else {
        args.push('--force');
    }
    return args;
}
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
// @signal runCursorAgent
export const runCursorAgent = (prompt, options) => {
    return new Promise((resolve, reject) => {
        const args = cursorAgentArgs(options);
        const child = spawn('cursor-agent', args, { cwd: options.cwd, shell: false });
        // The agent reads until EOF, so the stream has to be closed or the run
        // hangs. An EPIPE here means the child exited before reading it all —
        // its exit code is the useful signal, not a crash in this process.
        child.stdin.on('error', () => undefined);
        child.stdin.end(prompt, 'utf-8');
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf-8');
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf-8');
        });
        child.on('error', reject);
        child.on('close', (code) => {
            resolve({ stdout, stderr, exitCode: code ?? 1 });
        });
    });
};
/**
 * The reviewer runs in read-only mode, but a mode flag is a prompt-level
 * instruction, not a guarantee — this checks the checkout was actually left
 * untouched, by comparing a snapshot taken before the agent ran against one
 * taken after. Either snapshot being unavailable (not a git repo, git
 * missing) counts as "modified": if read-only behaviour cannot be verified,
 * it is never assumed.
 */
// @signal reviewerMutatedCheckout
export function reviewerMutatedCheckout(before, after) {
    if (before === null || after === null) {
        return true;
    }
    return worktreeChanged(before, after);
}
//# sourceMappingURL=cursor-runner.js.map