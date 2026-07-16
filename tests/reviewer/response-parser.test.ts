import { describe, expect, it } from 'vitest';
import { extractJsonObject, parseReviewVerdict, unwrapCursorAgentEnvelope } from '../../src/reviewer/response-parser.js';

function envelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1000,
    result: '{"verdict":"PASS","findings":[]}',
    session_id: 'test-session',
    request_id: 'test-request',
    ...overrides,
  });
}

describe('unwrapCursorAgentEnvelope', () => {
  it('extracts the result field from a valid envelope', () => {
    const result = unwrapCursorAgentEnvelope(envelope({ result: 'hello' }));

    expect(result).toEqual({ ok: true, value: 'hello' });
  });

  it('fails when the raw output is not valid JSON at all', () => {
    const result = unwrapCursorAgentEnvelope('not json at all {{{');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not valid JSON/);
    }
  });

  it('fails when the parsed JSON is not an object', () => {
    const result = unwrapCursorAgentEnvelope('[1, 2, 3]');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not a JSON object/);
    }
  });

  it('fails when is_error is true', () => {
    const result = unwrapCursorAgentEnvelope(envelope({ is_error: true, result: 'rate limited' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/reported an error/);
      expect(result.reason).toContain('rate limited');
    }
  });

  it('fails when the result field is missing or not a string', () => {
    const result = unwrapCursorAgentEnvelope(envelope({ result: 42 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no string "result" field/);
    }
  });

  it('falls back to a generic message when is_error is true but result is not a string', () => {
    const result = unwrapCursorAgentEnvelope(envelope({ is_error: true, result: { code: 500 } }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('cursor-agent reported an error: unknown error');
    }
  });
});

describe('extractJsonObject', () => {
  it('extracts a pure JSON object with nothing around it', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it('extracts JSON preceded by conversational preamble', () => {
    expect(extractJsonObject('Sure, here you go:\n{"a":1}')).toBe('{"a":1}');
  });

  it('extracts JSON followed by trailing text', () => {
    expect(extractJsonObject('{"a":1}\nLet me know if you need anything else.')).toBe('{"a":1}');
  });

  it('strips markdown code fences', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('finds the matching closing brace, not the first one, across nested structures', () => {
    const text = '{"a":{"nested":true},"b":[1,2,3]}';

    expect(extractJsonObject(text)).toBe(text);
  });

  it('does not get confused by a literal "}" inside a string value', () => {
    const text = '{"problem":"unexpected } in template literal"}';

    expect(extractJsonObject(text)).toBe(text);
  });

  it('does not treat an escaped quote inside a string as ending the string', () => {
    const text = String.raw`{"problem":"a \"quoted\" word"}`;

    expect(extractJsonObject(text)).toBe(text);
  });

  it('reproduces the actual behavior observed from a live cursor-agent call: preamble + valid JSON', () => {
    // Captured verbatim (session/request IDs aside) from a real invocation:
    // despite the prompt saying "no text before or after", the model still
    // prepended a sentence before the JSON object.
    const modelText = 'Reviewing the workspace to produce the JSON verdict.\n{"verdict": "PASS", "findings": []}';

    expect(extractJsonObject(modelText)).toBe('{"verdict": "PASS", "findings": []}');
  });

  it('returns null when there is no "{" anywhere', () => {
    expect(extractJsonObject('no json here')).toBeNull();
  });

  it('returns null when the braces never balance', () => {
    expect(extractJsonObject('{"a":1, "b": {"c": 2}')).toBeNull();
  });
});

describe('parseReviewVerdict', () => {
  it('parses a clean PASS with no findings', () => {
    const result = parseReviewVerdict(envelope({ result: '{"verdict":"PASS","findings":[]}' }));

    expect(result).toEqual({ ok: true, value: { verdict: 'PASS', findings: [] } });
  });

  it('parses the real preamble-plus-JSON shape observed live, end to end', () => {
    const raw = envelope({
      result: 'Reviewing the workspace to produce the JSON verdict.\n{"verdict": "PASS", "findings": []}',
    });

    const result = parseReviewVerdict(raw);

    expect(result).toEqual({ ok: true, value: { verdict: 'PASS', findings: [] } });
  });

  it('maps a well-formed finding, converting snake_case to camelCase', () => {
    const result = parseReviewVerdict(
      envelope({
        result: JSON.stringify({
          verdict: 'FAIL',
          findings: [
            {
              severity: 'security',
              rule: 'backend.rules#no-string-concat-sql',
              file: 'src/api/users.ts',
              line: 42,
              problem: 'string-concatenated SQL',
              suggested_fix: 'use a parameterized query',
              auto_fixable: true,
            },
          ],
        }),
      }),
    );

    expect(result).toEqual({
      ok: true,
      value: {
        verdict: 'FAIL',
        findings: [
          {
            severity: 'security',
            rule: 'backend.rules#no-string-concat-sql',
            file: 'src/api/users.ts',
            line: 42,
            problem: 'string-concatenated SQL',
            suggestedFix: 'use a parameterized query',
            autoFixable: true,
          },
        ],
      },
    });
  });

  it('accepts a null suggested_fix', () => {
    const result = parseReviewVerdict(
      envelope({
        result: JSON.stringify({
          verdict: 'FAIL',
          findings: [
            {
              severity: 'must',
              rule: 'r',
              file: 'f.ts',
              line: 1,
              problem: 'p',
              suggested_fix: null,
              auto_fixable: false,
            },
          ],
        }),
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.findings[0]?.suggestedFix).toBeNull();
    }
  });

  it('fails when verdict is missing or not PASS/FAIL', () => {
    const result = parseReviewVerdict(envelope({ result: '{"verdict":"MAYBE","findings":[]}' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/"verdict" must be/);
    }
  });

  it('fails when findings is not an array', () => {
    const result = parseReviewVerdict(envelope({ result: '{"verdict":"PASS","findings":"none"}' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/"findings" must be an array/);
    }
  });

  it('fails when a finding has an invalid severity', () => {
    const result = parseReviewVerdict(
      envelope({
        result: JSON.stringify({
          verdict: 'FAIL',
          findings: [{ severity: 'critical', rule: 'r', file: 'f', line: 1, problem: 'p', suggested_fix: null, auto_fixable: true }],
        }),
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/severity must be one of/);
    }
  });

  it('fails when a finding has an empty rule', () => {
    const result = parseReviewVerdict(
      envelope({
        result: JSON.stringify({
          verdict: 'FAIL',
          findings: [{ severity: 'must', rule: '', file: 'f', line: 1, problem: 'p', suggested_fix: null, auto_fixable: true }],
        }),
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/rule must be a non-empty string/);
    }
  });

  it('fails when a finding has an empty file', () => {
    const result = parseReviewVerdict(
      envelope({
        result: JSON.stringify({
          verdict: 'FAIL',
          findings: [{ severity: 'must', rule: 'r', file: '', line: 1, problem: 'p', suggested_fix: null, auto_fixable: true }],
        }),
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/file must be a non-empty string/);
    }
  });

  it('fails when a finding has an empty problem', () => {
    const result = parseReviewVerdict(
      envelope({
        result: JSON.stringify({
          verdict: 'FAIL',
          findings: [{ severity: 'must', rule: 'r', file: 'f', line: 1, problem: '', suggested_fix: null, auto_fixable: true }],
        }),
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/problem must be a non-empty string/);
    }
  });

  it('fails when suggested_fix is neither null nor a string', () => {
    const result = parseReviewVerdict(
      envelope({
        result: JSON.stringify({
          verdict: 'FAIL',
          findings: [{ severity: 'must', rule: 'r', file: 'f', line: 1, problem: 'p', suggested_fix: 42, auto_fixable: true }],
        }),
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/suggested_fix must be a string or null/);
    }
  });

  it('fails when a finding has a non-integer line', () => {
    const result = parseReviewVerdict(
      envelope({
        result: JSON.stringify({
          verdict: 'FAIL',
          findings: [{ severity: 'must', rule: 'r', file: 'f', line: 1.5, problem: 'p', suggested_fix: null, auto_fixable: true }],
        }),
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/positive integer/);
    }
  });

  it('fails when a finding is missing auto_fixable', () => {
    const result = parseReviewVerdict(
      envelope({
        result: JSON.stringify({
          verdict: 'FAIL',
          findings: [{ severity: 'must', rule: 'r', file: 'f', line: 1, problem: 'p', suggested_fix: null }],
        }),
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/auto_fixable must be a boolean/);
    }
  });

  it('fails when a finding in the array is not an object', () => {
    const result = parseReviewVerdict(envelope({ result: '{"verdict":"FAIL","findings":["oops"]}' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/findings\[0\] is not a JSON object/);
    }
  });

  it('propagates an envelope-level failure without attempting to extract JSON', () => {
    const result = parseReviewVerdict(envelope({ is_error: true, result: 'boom' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/reported an error/);
    }
  });

  it('fails when no JSON object can be found in the response text', () => {
    const result = parseReviewVerdict(envelope({ result: 'I could not complete the review.' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no JSON object found/);
    }
  });

  it('fails when the extracted text is not parseable JSON', () => {
    const result = parseReviewVerdict(envelope({ result: '{verdict: PASS, findings: []}' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/failed to parse/);
    }
  });
});
