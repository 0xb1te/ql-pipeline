import type { Finding } from '../shared/types.js';
/** Renders findings as numbered plain-text entries for the fixer prompt. */
export declare function formatFindingsForPrompt(findings: readonly Finding[]): string;
/** Substitutes the placeholders documented in prompts/fixer.md. */
export declare function buildFixerPrompt(template: string, findings: readonly Finding[], attemptNumber: number, maxAttempts: number, humanDirection?: string): string;
/**
 * The top-level body of the request-changes review posted alongside per-finding comments.
 *
 * `unanchored` is rendered in full here because this body is the only place it can appear. A
 * finding about the pull request itself - a failed gate, most often - carries a pseudo-path that
 * GitHub will not accept an inline comment on, so it is left out of the comments; and unlike the
 * approval path, which posts a separate advisory comment afterwards, a blocking review has one
 * message and this is it. Dropping the text would leave `found 3 issue(s)` above two comments and
 * no way to learn what the third one was.
 *
 * The count stays the count of everything. It answers how much is wrong, not how much fitted in a
 * margin.
 */
export declare function formatComplaintSummary(findings: readonly Finding[], attemptNumber: number, maxAttempts: number, unanchored?: readonly Finding[]): string;
