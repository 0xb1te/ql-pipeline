/**
 * Counts prior fix attempts by counting `[bot]`-suffixed commits already on
 * the PR (RULES.md R2.3), rather than tracking a separate counter (a PR
 * label or comment) — the attempt count falls out of commit history the
 * pipeline already fetches for routing.
 */
export declare function countFixAttempts(commitMessages: readonly string[]): number;
