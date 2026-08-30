/** Renders findings as numbered plain-text entries for the fixer prompt. */
// @signal formatFindingsForPrompt
export function formatFindingsForPrompt(findings) {
    return findings
        .map((finding, index) => {
        const fix = finding.suggestedFix ?? '(no suggested fix provided)';
        return (`${index + 1}. [${finding.severity}] ${finding.rule}\n` +
            `   File: ${finding.file}:${finding.line}\n` +
            `   Problem: ${finding.problem}\n` +
            `   Suggested fix: ${fix}`);
    })
        .join('\n\n');
}
/** Substitutes the placeholders documented in prompts/fixer.md. */
// @signal buildFixerPrompt
export function buildFixerPrompt(template, findings, attemptNumber, maxAttempts) {
    return template
        .replaceAll('{{ATTEMPT_NUMBER}}', String(attemptNumber))
        .replaceAll('{{MAX_ATTEMPTS}}', String(maxAttempts))
        .replaceAll('{{COMPLAINT}}', formatFindingsForPrompt(findings));
}
/** The top-level body of the request-changes review posted alongside per-finding comments. */
// @signal formatComplaintSummary
export function formatComplaintSummary(findings, attemptNumber, maxAttempts) {
    const attemptsLeft = attemptNumber < maxAttempts;
    const nextStep = attemptsLeft
        ? 'An automated fix attempt will follow.'
        : `Max fix attempts (${maxAttempts}) reached — this needs a human.`;
    return (`**Automated review found ${findings.length} issue(s) that must be resolved before this PR can merge.**\n\n` +
        `Attempt ${attemptNumber} of ${maxAttempts}. ${nextStep}`);
}
//# sourceMappingURL=complaint.js.map