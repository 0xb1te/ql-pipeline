const BOT_COMMIT_HEADER = /\[bot\]\s*$/;
/**
 * Counts prior fix attempts by counting `[bot]`-suffixed commits already on
 * the PR (RULES.md R2.3), rather than tracking a separate counter (a PR
 * label or comment) — the attempt count falls out of commit history the
 * pipeline already fetches for routing.
 */
export function countFixAttempts(commitMessages) {
    return commitMessages.filter((message) => {
        const headerLine = message.split('\n', 1)[0];
        return BOT_COMMIT_HEADER.test(headerLine);
    }).length;
}
//# sourceMappingURL=attempt-counter.js.map