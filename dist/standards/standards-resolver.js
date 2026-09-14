// @neuron standards.reader.standardsResolver
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AREAS } from '../shared/types.js';
import { REVIEW_KINDS } from './review-kind.js';
const defaultReader = {
    exists: (path) => Promise.resolve(existsSync(path)),
    read: (path) => Promise.resolve(readFileSync(path, 'utf-8')),
};
// @signal standardsIdFor
export function standardsIdFor(area) {
    return `${area}.standards`;
}
// @signal reviewPackEntries
export function reviewPackEntries(kind, areas) {
    const entries = [
        { id: 'review.standards', area: null, docPath: `workflow/review/${kind}/checklist.md` },
    ];
    for (const area of areas) {
        entries.push({ id: standardsIdFor(area), area, docPath: `workflow/review/${kind}/${area}.md` });
    }
    return entries;
}
/** Every file a local `.standards` checkout must have for `doctor` to pass. */
// @signal allReviewDocumentPaths
export function allReviewDocumentPaths() {
    return REVIEW_KINDS.flatMap((kind) => reviewPackEntries(kind, AREAS).map((entry) => entry.docPath));
}
/** How many section titles a rendered list names before eliding the rest. */
export const MAX_LISTED_SECTIONS = 10;
/**
 * Renders a dropped-section list for a log line or a prompt note. Long lists
 * are elided: the point is to make the shape of the gap legible, and thirty
 * titles on one line is not. The full list survives in the gate report, which
 * has no line-length pressure.
 */
// @signal describeDroppedSections
export function describeDroppedSections(sections, droppedChars) {
    if (sections.length === 0) {
        // A document with no `## ` headings can still overflow. Saying so beats
        // reporting "0 sections", which reads as "nothing was lost".
        return `dropped ${droppedChars} chars (no section headings to name)`;
    }
    const listed = sections.slice(0, MAX_LISTED_SECTIONS).join(', ');
    const rest = sections.length - MAX_LISTED_SECTIONS;
    const elision = rest > 0 ? ` (+${rest} more)` : '';
    const plural = sections.length === 1 ? '' : 's';
    return `dropped ${droppedChars} chars, ${sections.length} section${plural}: ${listed}${elision}`;
}
/**
 * Truncates on a section boundary where possible. The checklists are
 * organised as `## NN — Title` sections, so cutting mid-section would hand
 * the reviewer half a rule; dropping whole trailing sections at least
 * leaves every included rule intact and says what was dropped.
 *
 * "Says what was dropped" is literal: the removed tail is scanned for its
 * section headings, which are returned to the caller and named in the marker.
 * A reviewer that cannot see a rule should at least be able to tell the rule
 * existed - otherwise `Findings: 0` is unreadable, because nothing separates
 * "nothing to report" from "the rule that would have caught it was not in the
 * prompt".
 */
// @signal truncateAtSection
export function truncateAtSection(text, maxChars) {
    if (text.length <= maxChars) {
        return { text, truncated: false, droppedSections: [], droppedChars: 0 };
    }
    const clipped = text.slice(0, maxChars);
    const lastSection = clipped.lastIndexOf('\n## ');
    const cut = lastSection > 0 ? clipped.slice(0, lastSection) : clipped;
    // Scan only the removed tail, so the cost is proportional to what was lost.
    const removed = text.slice(cut.length);
    const droppedSections = Array.from(removed.matchAll(/^## (.*)$/gm), (match) => (match[1] ?? '').trim());
    const droppedChars = text.length - cut.length;
    return {
        text: `${cut}\n\n[... truncated: this document exceeds the configured standards budget. ` +
            `${describeDroppedSections(droppedSections, droppedChars)}. ` +
            `Do not treat an absent section as permission. ...]`,
        truncated: true,
        droppedSections,
        droppedChars,
    };
}
/**
 * Loads the review pack for this PR's kind and areas from
 * `workflow/review/pr-*`. The pack path is a convention, not a config map.
 */
// @signal resolveStandards
export async function resolveStandards(areas, config, workspaceRoot, reader = defaultReader, kind = 'pr-feature') {
    if (!config.enabled) {
        return { standards: [], missing: [] };
    }
    const standards = [];
    const missing = [];
    for (const entry of reviewPackEntries(kind, areas)) {
        const absolute = join(workspaceRoot, config.root, entry.docPath);
        if (!(await reader.exists(absolute))) {
            missing.push(entry.docPath);
            continue;
        }
        const { text, truncated, droppedSections, droppedChars } = truncateAtSection(await reader.read(absolute), config.maxCharsPerArea);
        standards.push({
            id: entry.id,
            area: entry.area,
            docPath: entry.docPath,
            text,
            truncated,
            droppedSections,
            droppedChars,
        });
    }
    return { standards, missing };
}
/** The reference ids the reviewer may cite for these standards. */
// @signal standardsIds
export function standardsIds(standards) {
    return standards.map((standard) => standard.id);
}
/** Renders the standards block injected into the reviewer prompt. */
// @signal formatStandardsForPrompt
export function formatStandardsForPrompt(standards) {
    if (standards.length === 0) {
        return '(no engineering standards are configured for the areas this PR touches)';
    }
    return standards
        .map((standard) => `----- ${standard.id} (source: ${standard.docPath}) -----\n` +
        `Cite findings against this document as \`${standard.id}#<section>\`, e.g. ` +
        `\`${standard.id}#09-controllers\`.\n\n${standard.text}`)
        .join('\n\n');
}
//# sourceMappingURL=standards-resolver.js.map