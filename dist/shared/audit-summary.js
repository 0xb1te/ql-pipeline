/**
 * Renders one audit-trail PR comment per pipeline run. Per plan.md §6
 * ("every verdict, complaint, and fix attempt is persisted as PR
 * comments/check outputs — the full decision trail is reconstructible from
 * the PR alone"), this is what makes that true in practice.
 */
// @signal formatAuditSummary
export function formatAuditSummary(input) {
    const lines = [
        '### ql-pipeline summary',
        '',
        `**Areas:** ${input.areas.join(', ')}`,
        `**Target branch:** ${input.targetBranch}`,
    ];
    if (input.gateOutcomes.length > 0) {
        lines.push('', '**Gates:**');
        for (const outcome of input.gateOutcomes) {
            lines.push(`- ${outcome.area}/${outcome.gate}: ${outcome.passed ? 'passed' : 'failed'}`);
        }
    }
    lines.push('', `**AI review:** ${input.reviewRan ? 'ran' : 'skipped'}`, `**Findings:** ${input.findingCount}`, '', `**Decision:** ${input.decision.kind} (attempt ${input.attemptNumber} of ${input.maxFixAttempts})`);
    if (input.decision.kind === 'BLOCK') {
        lines.push(`> ${input.decision.reason}`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=audit-summary.js.map