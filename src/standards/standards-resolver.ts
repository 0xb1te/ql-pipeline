// @neuron standards.reader.standardsResolver
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AREAS, type Area, type StandardsConfig } from '../shared/types.js';
import { REVIEW_KINDS, type ReviewKind } from './review-kind.js';

export interface ResolvedStandard {
  /** Reference id findings cite, e.g. `frontend.standards` or `review.standards`. */
  readonly id: string;
  readonly area: Area | null;
  /** Path relative to the standards root, kept so the reviewer can name its source. */
  readonly docPath: string;
  readonly text: string;
  readonly truncated: boolean;
  /** Titles of the `## ` sections dropped, in document order. */
  readonly droppedSections: readonly string[];
  /** Characters removed from the source document. */
  readonly droppedChars: number;
}

export interface StandardsResolution {
  readonly standards: readonly ResolvedStandard[];
  /** Docs the pack named that were not present — surfaced, never silently ignored. */
  readonly missing: readonly string[];
}

/**
 * A source of standards documents, keyed by the same absolute path
 * `resolveStandards` joins from `workspaceRoot` + `config.root` + a
 * pack-relative doc path.
 */
export interface StandardsReader {
  exists: (path: string) => Promise<boolean>;
  read: (path: string) => Promise<string>;
}

const defaultReader: StandardsReader = {
  exists: (path) => Promise.resolve(existsSync(path)),
  read: (path) => Promise.resolve(readFileSync(path, 'utf-8')),
};

export interface ReviewPackEntry {
  readonly id: string;
  readonly area: Area | null;
  readonly docPath: string;
}

// @signal standardsIdFor
export function standardsIdFor(area: Area): string {
  return `${area}.standards`;
}

// @signal reviewPackEntries
export function reviewPackEntries(kind: ReviewKind, areas: readonly Area[]): ReviewPackEntry[] {
  const entries: ReviewPackEntry[] = [
    { id: 'review.standards', area: null, docPath: `workflow/review/${kind}/checklist.md` },
  ];
  for (const area of areas) {
    entries.push({ id: standardsIdFor(area), area, docPath: `workflow/review/${kind}/${area}.md` });
  }
  return entries;
}

/** Every file a local `.standards` checkout must have for `doctor` to pass. */
// @signal allReviewDocumentPaths
export function allReviewDocumentPaths(): string[] {
  return REVIEW_KINDS.flatMap((kind) => reviewPackEntries(kind, AREAS).map((entry) => entry.docPath));
}

/** How many section titles a rendered list names before eliding the rest. */
export const MAX_LISTED_SECTIONS = 10;

export interface TruncationResult {
  readonly text: string;
  readonly truncated: boolean;
  /** Titles of the `## ` sections dropped, in document order. */
  readonly droppedSections: readonly string[];
  /** Characters removed from the source document. */
  readonly droppedChars: number;
}

/**
 * Renders a dropped-section list for a log line or a prompt note. Long lists
 * are elided: the point is to make the shape of the gap legible, and thirty
 * titles on one line is not. The full list survives in the gate report, which
 * has no line-length pressure.
 */
// @signal describeDroppedSections
export function describeDroppedSections(sections: readonly string[], droppedChars: number): string {
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
export function truncateAtSection(text: string, maxChars: number): TruncationResult {
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
    text:
      `${cut}\n\n[... truncated: this document exceeds the configured standards budget. ` +
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
export async function resolveStandards(
  areas: readonly Area[],
  config: StandardsConfig,
  workspaceRoot: string,
  reader: StandardsReader = defaultReader,
  kind: ReviewKind = 'pr-feature',
): Promise<StandardsResolution> {
  if (!config.enabled) {
    return { standards: [], missing: [] };
  }

  const standards: ResolvedStandard[] = [];
  const missing: string[] = [];

  for (const entry of reviewPackEntries(kind, areas)) {
    const absolute = join(workspaceRoot, config.root, entry.docPath);
    if (!(await reader.exists(absolute))) {
      missing.push(entry.docPath);
      continue;
    }
    const { text, truncated, droppedSections, droppedChars } = truncateAtSection(
      await reader.read(absolute),
      config.maxCharsPerArea,
    );
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
export function standardsIds(standards: readonly ResolvedStandard[]): string[] {
  return standards.map((standard) => standard.id);
}

/** Renders the standards block injected into the reviewer prompt. */
// @signal formatStandardsForPrompt
export function formatStandardsForPrompt(standards: readonly ResolvedStandard[]): string {
  if (standards.length === 0) {
    return '(no engineering standards are configured for the areas this PR touches)';
  }

  return standards
    .map(
      (standard) =>
        `----- ${standard.id} (source: ${standard.docPath}) -----\n` +
        `Cite findings against this document as \`${standard.id}#<section>\`, e.g. ` +
        `\`${standard.id}#09-controllers\`.\n\n${standard.text}`,
    )
    .join('\n\n');
}
