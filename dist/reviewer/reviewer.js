// @neuron review.reviewer.reviewer
import { defaultCommandExecutor } from '../shared/exec.js';
import { captureWorktreeState } from '../shared/worktree.js';
import { runCursorAgent, reviewerMutatedCheckout } from './cursor-runner.js';
import { buildDiffLineIndex, groundFindings } from './diff-grounding.js';
import { parseReviewVerdict } from './response-parser.js';
import { truncateAtSection } from '../standards/standards-resolver.js';
/**
 * Ceiling for the assembled prompt, in bytes.
 *
 * The whole prompt is handed to `cursor-agent` as a single argv element, and
 * Linux refuses any one argument over MAX_ARG_STRLEN — 131072 bytes — with
 * `spawn E2BIG`, before the process starts. This sits below that to leave room
 * for the rest of argv.
 *
 * `standards.max_chars_per_area` cannot enforce this on its own: it is a
 * *per-area* cap, so a PR touching two areas can carry twice it. A PR touching
 * three areas, three times. Only a total has the property we need.
 */
export const MAX_PROMPT_BYTES = 120_000;
function substitute(template, context, standardsText) {
    return template
        .replaceAll('{{AREAS}}', context.areas.join(', '))
        .replaceAll('{{RULES}}', context.rulesText)
        .replaceAll('{{STANDARDS}}', standardsText)
        .replaceAll('{{GATE_RESULTS}}', formatGateResults(context.gateOutcomes))
        .replaceAll('{{PR_DESCRIPTION}}', context.prDescription)
        .replaceAll('{{DIFF}}', context.diff);
}
/**
 * Substitutes the placeholders documented in prompts/reviewer.md, trimming the
 * standards if the result would be too large to spawn.
 *
 * The standards are what gets cut, because they are the one part that is both
 * large and safely divisible — they are already organised into sections and
 * already have a truncation routine that cuts on a section boundary. The diff
 * and the rules are not: half a diff is a misleading review, and a rule set
 * missing its tail silently stops being the thing the PR is judged against.
 */
// @signal buildReviewPrompt
export function buildReviewPrompt(template, context) {
    const full = substitute(template, context, context.standardsText);
    if (Buffer.byteLength(full, 'utf8') <= MAX_PROMPT_BYTES) {
        return full;
    }
    const note = '\n\n----- NOTE: the engineering standards above were truncated to fit the prompt size limit. ' +
        'Trailing sections are missing. Do not treat their absence as permission. -----';
    // The note is part of what gets substituted, so it has to come out of the
    // budget too - otherwise the result lands just over the ceiling.
    const overhead = Buffer.byteLength(substitute(template, context, ''), 'utf8') + Buffer.byteLength(note, 'utf8');
    const budget = MAX_PROMPT_BYTES - overhead;
    if (budget <= 0) {
        // The diff alone fills the prompt. Dropping the standards entirely is the
        // most that can be done here; the spawn may still fail, and that is a
        // clearer signal than a review of a silently halved diff.
        return substitute(template, context, '(engineering standards omitted: the diff alone fills the prompt budget)');
    }
    // `truncateAtSection` takes a character budget and cuts on a section
    // boundary, so its result can still sit a little over a *byte* budget -
    // by the tail of the last section it kept, and by any multi-byte character
    // in it. Clamp afterwards so the ceiling is an actual guarantee rather than
    // an approximation that fails on the one PR that happens to cross it.
    const { text } = truncateAtSection(context.standardsText, budget);
    let standards = text;
    while (standards.length > 0 && Buffer.byteLength(standards, 'utf8') > budget) {
        standards = standards.slice(0, Math.max(0, standards.length - Math.max(1, Math.ceil((Buffer.byteLength(standards, 'utf8') - budget) / 2))));
    }
    return substitute(template, context, `${standards}${note}`);
}
function formatGateResults(outcomes) {
    if (outcomes.length === 0) {
        return '(no gates were configured for the matched areas)';
    }
    return outcomes
        .map((outcome) => {
        const status = outcome.passed ? 'PASSED' : 'FAILED';
        const detail = outcome.passed ? '' : `\n  ${outcome.output}`;
        return `- ${outcome.area}/${outcome.gate}: ${status}${detail}`;
    })
        .join('\n');
}
/**
 * Runs the AI reviewer against a PR: builds the prompt, invokes cursor-agent
 * in read-only (`ask`) mode, verifies the checkout wasn't mutated despite
 * that, parses the strict JSON verdict (retrying the invocation once if
 * parsing fails — real responses observed in testing sometimes wrap the
 * JSON in conversational text; a second attempt is worth it before giving
 * up), and applies the grounding requirement to the resulting findings.
 */
// @signal runReview
export async function runReview(context, promptTemplate, options) {
    const agentRunner = options.agentRunner ?? runCursorAgent;
    const commandExecutor = options.commandExecutor ?? defaultCommandExecutor;
    const prompt = buildReviewPrompt(promptTemplate, context);
    // Snapshot the tree before the agent runs, so the read-only guard
    // compares against reality rather than demanding a pristine checkout —
    // the build and test gates have already run by this point and will have
    // left artifacts behind.
    const before = await captureWorktreeState(options.cwd, commandExecutor);
    let attempt = await invokeAndParse(agentRunner, prompt, options.cwd, options.model);
    if (!attempt.ok) {
        attempt = await invokeAndParse(agentRunner, prompt, options.cwd, options.model);
    }
    const after = await captureWorktreeState(options.cwd, commandExecutor);
    if (reviewerMutatedCheckout(before, after)) {
        return {
            ok: false,
            reason: 'the reviewer checkout was modified during a read-only review invocation; treating this run as BLOCK',
        };
    }
    if (!attempt.ok) {
        return { ok: false, reason: `reviewer response was unusable even after a retry: ${attempt.reason}` };
    }
    const diffIndex = buildDiffLineIndex(context.diff);
    const { grounded, discarded } = groundFindings(attempt.value.findings, diffIndex, context.ruleFiles);
    return { ok: true, outcome: { findings: grounded, discarded } };
}
async function invokeAndParse(agentRunner, prompt, cwd, model) {
    const invocation = await agentRunner(prompt, {
        cwd,
        mode: 'ask',
        ...(model !== undefined && model !== '' ? { model } : {}),
    });
    if (invocation.exitCode !== 0) {
        return { ok: false, reason: `cursor-agent exited with code ${invocation.exitCode}: ${invocation.stderr}` };
    }
    return parseReviewVerdict(invocation.stdout);
}
//# sourceMappingURL=reviewer.js.map