import type { Finding } from '../shared/types.js';
/** Renders findings as numbered plain-text entries for the fixer prompt. */
export declare function formatFindingsForPrompt(findings: readonly Finding[]): string;
/** Substitutes the placeholders documented in prompts/fixer.md. */
export declare function buildFixerPrompt(template: string, findings: readonly Finding[], attemptNumber: number, maxAttempts: number): string;
/** The top-level body of the request-changes review posted alongside per-finding comments. */
export declare function formatComplaintSummary(findings: readonly Finding[], attemptNumber: number, maxAttempts: number): string;
