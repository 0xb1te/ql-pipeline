import { FIX_ATTEMPT_MARKER } from './types.js';
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
    // Announced here because here is the only place it can be. This comment is posted before
    // `runFix` is called, and the fix agent then runs for minutes with nothing else written to the
    // pull request until it is done -- so `Decision: FIX` was, quite literally, the only signal
    // that anything was happening, and it does not read as one.
    //
    // It is said in this comment rather than in a second one on purpose: comments on the pull
    // request are fed back to the fix agent as human direction, so a status update posted
    // separately would arrive at the agent as an instruction from a person. See bugfix 043.
    if (input.decision.kind === 'FIX') {
        lines.push('', `A fix agent is starting now, against ${String(input.decision.findings.length)} blocking ` +
            'finding(s). It writes one commit addressing all of them at once, and the review that ' +
            'commit triggers is what decides whether they are settled.');
        if (input.runUrl !== undefined && input.runUrl !== null) {
            lines.push('', `Watch it: ${input.runUrl}`);
        }
        lines.push('', 'Pushing to this branch cancels the attempt while it runs, and the run itself is the only ' +
            'place that is visible.', 
        // Renders as nothing, and is how the next run knows this attempt happened. The commit
        // history cannot answer that under a provider that commits for itself - see
        // fix.fixer.attemptCounter.
        '', FIX_ATTEMPT_MARKER);
    }
    if (input.decision.kind === 'BLOCK') {
        lines.push(`> ${input.decision.reason}`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=audit-summary.js.map