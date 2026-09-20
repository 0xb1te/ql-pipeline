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
export function buildFixerPrompt(template, findings, attemptNumber, maxAttempts, humanDirection = '') {
    return template
        .replaceAll('{{ATTEMPT_NUMBER}}', String(attemptNumber))
        .replaceAll('{{MAX_ATTEMPTS}}', String(maxAttempts))
        .replaceAll('{{HUMAN_DIRECTION}}', humanDirection)
        .replaceAll('{{COMPLAINT}}', formatFindingsForPrompt(findings));
}
/**
 * The top-level body of the request-changes review posted alongside per-finding comments.
 *
 * `unanchored` is rendered in full here because this body is the only place it can appear. A
 * finding about the pull request itself - a failed gate, most often - carries a pseudo-path that
 * GitHub will not accept an inline comment on, so it is left out of the comments; and unlike the
 * approval path, which posts a separate advisory comment afterwards, a blocking review has one
 * message and this is it. Dropping the text would leave `found 3 issue(s)` above two comments and
 * no way to learn what the third one was.
 *
 * The count stays the count of everything. It answers how much is wrong, not how much fitted in a
 * margin.
 */
// @signal formatComplaintSummary
export function formatComplaintSummary(findings, attemptNumber, maxAttempts, unanchored = [], advisoryCount = 0) {
    const attemptsLeft = attemptNumber < maxAttempts;
    const nextStep = attemptsLeft
        ? 'An automated fix attempt will follow.'
        : `Max fix attempts (${maxAttempts}) reached — this needs a human.`;
    // `findings` is the blocking set, so "must be resolved" stays literally true. The advisory ones
    // are counted separately rather than added in: a number that mixes the two says neither.
    const advisory = advisoryCount > 0
        ? `\n\n${advisoryCount} further finding(s) are advisory and do not block; they are reported alongside.`
        : '';
    const head = `**Automated review found ${findings.length} issue(s) that must be resolved before this PR can merge.**\n\n` +
        `Attempt ${attemptNumber} of ${maxAttempts}. ${nextStep}${advisory}`;
    if (unanchored.length === 0)
        return head;
    const rendered = unanchored.map((finding) => {
        const suggestion = finding.suggestedFix !== null ? `\n\nSuggested fix: ${finding.suggestedFix}` : '';
        return `**[${finding.severity}] ${finding.rule}**\n\n${finding.problem}${suggestion}`;
    });
    return [
        head,
        '',
        '### About this pull request rather than a line in it',
        '',
        'No inline comment can point at these, so they are reported here.',
        '',
        rendered.join('\n\n---\n\n'),
    ].join('\n');
}
//# sourceMappingURL=complaint.js.map