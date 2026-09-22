/**
 * How many fix attempts this pull request has already had.
 *
 * Two sources, and the larger wins. Neither is redundant:
 *
 * - **`[bot]`-suffixed commits** (RULES.md R2.3). What the counter always read. It works only
 *   while this pipeline is what commits, which is true of `fix.fixer.fixer` and false of
 *   `fix.fixer.agentsFixer` - ql-agents commits on its own host, with its own message.
 * - **{@link FIX_ATTEMPT_MARKER} comments.** Evidence the pipeline writes about itself, on the
 *   summary it posts when it decides to attempt a fix, so it is true for every provider.
 *
 * Taking the maximum rather than the sum is what keeps both honest. On the cursor provider a
 * single attempt leaves *both* a marked comment and a `[bot]` commit, and adding them would
 * report two attempts for one and exhaust `max_fix_attempts` at half the configured budget. On a
 * pull request older than the marker there are commits and no comments; under `ql_agents` there
 * are comments and no commits. The maximum is right in all three.
 *
 * Reading zero when the marker is present but unreadable is the one failure that matters: it
 * restores the unbounded loop this exists to stop. The caller passes an empty list when it
 * cannot read the comments, which falls back to commit evidence - correct for cursor, and for
 * ql_agents a fresh run rather than a wrong refusal.
 */
export declare function countFixAttempts(commitMessages: readonly string[], commentBodies?: readonly string[]): number;
