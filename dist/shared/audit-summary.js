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
    // Coverage sits directly above the finding count, because it is what makes
    // that count readable: `Findings: 0` against a gutted standards block does
    // not mean the same thing as `Findings: 0` against the whole document.
    const coverage = input.standardsCoverage ?? [];
    if (coverage.length > 0 || input.promptCoverage !== undefined) {
        lines.push('', '**Standards coverage:**');
        for (const doc of coverage) {
            const total = doc.keptSections + doc.droppedSections;
            lines.push(`- ${doc.id} — ${doc.keptSections} of ${total} sections; ` +
                `${doc.droppedSections} dropped (${doc.droppedChars} chars) by the per-area cap`);
        }
        if (input.promptCoverage?.omitted === true) {
            lines.push('- the diff filled the prompt budget; **no engineering standards were sent at all**');
        }
        else if (input.promptCoverage !== undefined) {
            lines.push(`- the prompt ceiling cut a further ${input.promptCoverage.droppedSections} sections ` +
                `(${input.promptCoverage.droppedChars} chars)`);
        }
    }
    lines.push('', `**AI review:** ${input.reviewRan ? 'ran' : 'skipped'}`, `**Findings:** ${input.findingCount}`, '', `**Decision:** ${input.decision.kind} (attempt ${input.attemptNumber} of ${input.maxFixAttempts})`);
    if (input.decision.kind === 'BLOCK') {
        lines.push(`> ${input.decision.reason}`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=audit-summary.js.map