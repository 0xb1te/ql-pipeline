/**
 * Pure decision function: MERGE, FIX, or BLOCK. `should`-severity findings
 * never factor into the decision — they ride along on MERGE as advisory
 * comments (plan.md §4.5).
 */
// @signal decidePipelineOutcome
export function decidePipelineOutcome(input) {
    const blocking = input.findings.filter((finding) => finding.severity === 'must' || finding.severity === 'security');
    const advisoryFindings = input.findings.filter((finding) => finding.severity === 'should');
    if (blocking.length === 0) {
        return { kind: 'MERGE', advisoryFindings };
    }
    const allAutoFixable = blocking.every((finding) => finding.autoFixable);
    if (!allAutoFixable) {
        return {
            kind: 'BLOCK',
            reason: 'one or more findings require a human (not auto-fixable)',
            findings: blocking,
            advisoryFindings,
        };
    }
    if (input.attemptsSoFar >= input.maxFixAttempts) {
        return {
            kind: 'BLOCK',
            reason: `max fix attempts (${input.maxFixAttempts}) reached`,
            findings: blocking,
            advisoryFindings,
        };
    }
    return { kind: 'FIX', findings: blocking, advisoryFindings };
}
//# sourceMappingURL=verdict.js.map