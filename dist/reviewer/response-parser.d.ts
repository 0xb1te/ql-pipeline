import type { ReviewVerdict } from '../shared/types.js';
export type ParseResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly reason: string;
};
/**
 * `cursor-agent --output-format json` wraps the model's actual response in
 * an envelope; the text we care about lives in `.result`.
 */
export declare function unwrapCursorAgentEnvelope(rawStdout: string): ParseResult<string>;
/**
 * Finds the first balanced `{...}` object in free-form text, tolerating
 * markdown code fences and conversational preamble/postamble around it —
 * in practice the model adds both even when told not to (observed live:
 * `"Reviewing the workspace...\n{\"verdict\": \"PASS\", ...}"`), so treating
 * "the whole response is pure JSON" as a requirement would fail on real
 * output. This scans for the matching `}` rather than just the last one in
 * the text, so a `}` inside a string value (e.g. in `problem` prose) can't
 * truncate the match early.
 */
export declare function extractJsonObject(text: string): string | null;
/** Parses and validates a cursor-agent reviewer invocation's raw stdout into a ReviewVerdict. */
export declare function parseReviewVerdict(rawStdout: string): ParseResult<ReviewVerdict>;
