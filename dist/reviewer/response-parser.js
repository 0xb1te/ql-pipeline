/**
 * `cursor-agent --output-format json` wraps the model's actual response in
 * an envelope; the text we care about lives in `.result`.
 */
export function unwrapCursorAgentEnvelope(rawStdout) {
    let envelope;
    try {
        envelope = JSON.parse(rawStdout);
    }
    catch (cause) {
        return { ok: false, reason: `cursor-agent output is not valid JSON: ${String(cause)}` };
    }
    if (!isRecord(envelope)) {
        return { ok: false, reason: 'cursor-agent output is not a JSON object' };
    }
    const record = envelope;
    if (record['is_error'] === true) {
        const detail = typeof record['result'] === 'string' ? record['result'] : 'unknown error';
        return { ok: false, reason: `cursor-agent reported an error: ${detail}` };
    }
    const result = record['result'];
    if (typeof result !== 'string') {
        return { ok: false, reason: 'cursor-agent output has no string "result" field' };
    }
    return { ok: true, value: result };
}
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
export function extractJsonObject(text) {
    const defenced = text.replace(/```(?:json)?/gi, '');
    const start = defenced.indexOf('{');
    if (start === -1) {
        return null;
    }
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    for (let i = start; i < defenced.length; i += 1) {
        const char = defenced[i];
        if (escapeNext) {
            escapeNext = false;
            continue;
        }
        if (inString) {
            if (char === '\\') {
                escapeNext = true;
            }
            else if (char === '"') {
                inString = false;
            }
            continue;
        }
        if (char === '"') {
            inString = true;
        }
        else if (char === '{') {
            depth += 1;
        }
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return defenced.slice(start, i + 1);
            }
        }
    }
    return null;
}
const SEVERITIES = ['must', 'should', 'security'];
/** Parses and validates a cursor-agent reviewer invocation's raw stdout into a ReviewVerdict. */
export function parseReviewVerdict(rawStdout) {
    const envelope = unwrapCursorAgentEnvelope(rawStdout);
    if (!envelope.ok) {
        return envelope;
    }
    const jsonText = extractJsonObject(envelope.value);
    if (jsonText === null) {
        return { ok: false, reason: 'no JSON object found in the reviewer\'s response text' };
    }
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    }
    catch (cause) {
        return { ok: false, reason: `extracted JSON object failed to parse: ${String(cause)}` };
    }
    return validateReviewVerdictShape(parsed);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validateReviewVerdictShape(value) {
    if (!isRecord(value)) {
        return { ok: false, reason: 'parsed verdict is not a JSON object' };
    }
    const verdictValue = value['verdict'];
    if (verdictValue !== 'PASS' && verdictValue !== 'FAIL') {
        return { ok: false, reason: '"verdict" must be "PASS" or "FAIL"' };
    }
    const findingsValue = value['findings'];
    if (!Array.isArray(findingsValue)) {
        return { ok: false, reason: '"findings" must be an array' };
    }
    const findings = [];
    for (const [index, item] of findingsValue.entries()) {
        const result = validateFindingShape(item, index);
        if (!result.ok) {
            return result;
        }
        findings.push(result.value);
    }
    return { ok: true, value: { verdict: verdictValue, findings } };
}
function validateFindingShape(value, index) {
    if (!isRecord(value)) {
        return { ok: false, reason: `findings[${index}] is not a JSON object` };
    }
    const severity = value['severity'];
    if (!SEVERITIES.includes(severity)) {
        return { ok: false, reason: `findings[${index}].severity must be one of ${SEVERITIES.join(', ')}` };
    }
    const rule = value['rule'];
    if (typeof rule !== 'string' || rule.length === 0) {
        return { ok: false, reason: `findings[${index}].rule must be a non-empty string` };
    }
    const file = value['file'];
    if (typeof file !== 'string' || file.length === 0) {
        return { ok: false, reason: `findings[${index}].file must be a non-empty string` };
    }
    const line = value['line'];
    if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) {
        return { ok: false, reason: `findings[${index}].line must be a positive integer` };
    }
    const problem = value['problem'];
    if (typeof problem !== 'string' || problem.length === 0) {
        return { ok: false, reason: `findings[${index}].problem must be a non-empty string` };
    }
    const suggestedFix = value['suggested_fix'];
    if (suggestedFix !== null && typeof suggestedFix !== 'string') {
        return { ok: false, reason: `findings[${index}].suggested_fix must be a string or null` };
    }
    const autoFixable = value['auto_fixable'];
    if (typeof autoFixable !== 'boolean') {
        return { ok: false, reason: `findings[${index}].auto_fixable must be a boolean` };
    }
    return {
        ok: true,
        value: {
            severity: severity,
            rule,
            file,
            line,
            problem,
            suggestedFix,
            autoFixable,
        },
    };
}
//# sourceMappingURL=response-parser.js.map