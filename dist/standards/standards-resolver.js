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
        const docPaths = await discoverDocs(entry, config, workspaceRoot, reader);
        if (docPaths.length === 0) {
            missing.push(entry.docPath);
            continue;
        }
        for (const docPath of docPaths) {
            const absolute = join(workspaceRoot, config.root, docPath);
            const { text, truncated, droppedSections, droppedChars } = truncateAtSection(await reader.read(absolute), config.maxCharsPerArea);
            standards.push({
                id: entry.id,
                area: entry.area,
                docPath,
                text,
                truncated,
                droppedSections,
                droppedChars,
            });
        }
    }
    return { standards, missing };
}
/**
 * The reference ids the reviewer may cite for these standards.
 *
 * Deduplicated: every slice of an area carries that area's id, so a sliced
 * area would otherwise list `frontend.standards` once per slice. The id is a
 * citation vocabulary, not a document count - slicing is deliberately
 * invisible to the reviewer.
 */
// @signal standardsIds
export function standardsIds(standards) {
    return [...new Set(standards.map((standard) => standard.id))];
}
/**
 * Renders one standards document as it appears in the prompt. Exported so the
 * pass planner can size a document exactly as the prompt will carry it, rather
 * than approximating from `text.length` and drifting from the real cost.
 */
// @signal formatStandard
export function formatStandard(standard) {
    return (`----- ${standard.id} (source: ${standard.docPath}) -----\n` +
        `Cite findings against this document as \`${standard.id}#<section>\`, e.g. ` +
        `\`${standard.id}#09-controllers\`.\n\n${standard.text}`);
}
/** Renders the standards block injected into the reviewer prompt. */
// @signal formatStandardsForPrompt
export function formatStandardsForPrompt(standards) {
    if (standards.length === 0) {
        return '(no engineering standards are configured for the areas this PR touches)';
    }
    return standards.map(formatStandard).join('\n\n');
}
/**
 * Most sections of a pack document a reviewer never sees are not dropped by
 * choice - the document is simply larger than a prompt can carry (task 017
 * measured 48% of `frontend.md` reaching the reviewer). An area may therefore
 * publish numbered slices instead of one file:
 *
 *   workflow/review/pr-bugfix/frontend-1.md
 *   workflow/review/pr-bugfix/frontend-2.md
 *
 * They are flat siblings, NOT a `frontend/` folder: house-api cannot reach a
 * document two or more levels below a route's entry node (see
 * `house-standards-reader.ts` and House problem
 * d5a75cba-3ede-4f35-afed-0f2dfdde9dcb), and a folder would put them there.
 *
 * `${area}.md` still wins when present, so an area that fits stays exactly as
 * it was and pays nothing for this.
 */
const MAX_SLICES = 20;
async function discoverDocs(entry, config, workspaceRoot, reader) {
    const whole = join(workspaceRoot, config.root, entry.docPath);
    if (await reader.exists(whole)) {
        return [entry.docPath];
    }
    // Only an area document slices. The shared checklist is small by design and
    // a numbered `checklist-1.md` would be a sign something else went wrong.
    if (entry.area === null) {
        return [];
    }
    const base = entry.docPath.replace(/\.md$/, '');
    const found = [];
    for (let n = 1; n <= MAX_SLICES; n += 1) {
        const slice = `${base}-${n}.md`;
        if (!(await reader.exists(join(workspaceRoot, config.root, slice)))) {
            break;
        }
        found.push(slice);
    }
    return found;
}
//# sourceMappingURL=standards-resolver.js.map