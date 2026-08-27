/**
 * Pure decision function: MERGE, FIX, or BLOCK. `should`-severity findings
 * never factor into the decision — they ride along on MERGE as advisory
 * comments (plan.md §4.5).
 */
export function decidePipelineOutcome(input) {
    const blocking = input.findings.filter((finding) => finding.severity === 'must' || finding.severity === 'security');
    if (blocking.length === 0) {
        const advisoryFindings = input.findings.filter((finding) => finding.severity === 'should');
        return { kind: 'MERGE', advisoryFindings };
    }
    const allAutoFixable = blocking.every((finding) => finding.autoFixable);
    if (!allAutoFixable) {
        return {
            kind: 'BLOCK',
            reason: 'one or more findings require a human (not auto-fixable)',
            findings: blocking,
        };
    }
    if (input.attemptsSoFar >= input.maxFixAttempts) {
        return {
            kind: 'BLOCK',
            reason: `max fix attempts (${input.maxFixAttempts}) reached`,
            findings: blocking,
        };
    }
    return { kind: 'FIX', findings: blocking };
}
//# sourceMappingURL=verdict.js.map