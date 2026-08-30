/**
 * Whether the AI review stage runs at all. When `ai-review` isn't a
 * required check, the review is skipped outright rather than run and
 * ignored — a review whose findings can't block is pure cost.
 */
// @signal isReviewRequired
export function isReviewRequired(requiredChecks) {
    return requiredChecks.includes('ai-review');
}
/**
 * Turns failed gates into findings, so a build break flows through exactly
 * the same verdict path as a review finding (plan.md §4.3). A gate whose
 * stage isn't in `merge.required_checks` still runs and still reports, but
 * its failures are advisory (`should`) instead of blocking — that's the
 * whole point of making the stage optional.
 */
// @signal gateFindings
export function gateFindings(outcomes, requiredChecks) {
    return outcomes
        .filter((outcome) => !outcome.passed)
        .map((outcome) => ({
        severity: requiredChecks.includes(outcome.gate) ? 'must' : 'should',
        rule: `gate#${outcome.area}-${outcome.gate}`,
        file: '(gate)',
        line: 1,
        problem: `${outcome.area} ${outcome.gate} gate failed for command \`${outcome.command}\`:\n${outcome.output}`,
        suggestedFix: null,
        autoFixable: true,
    }));
}
//# sourceMappingURL=required-checks.js.map