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

/**
 * Truncates on a section boundary where possible. The checklists are
 * organised as `## NN — Title` sections, so cutting mid-section would hand
 * the reviewer half a rule; dropping whole trailing sections at least
 * leaves every included rule intact and says what was dropped.
 */
// @signal truncateAtSection
export function truncateAtSection(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  const clipped = text.slice(0, maxChars);
  const lastSection = clipped.lastIndexOf('\n## ');
  const cut = lastSection > 0 ? clipped.slice(0, lastSection) : clipped;

  return {
    text: `${cut}\n\n[... truncated: this document exceeds the configured standards budget. Sections beyond this point were not included. ...]`,
    truncated: true,
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
    const { text, truncated } = truncateAtSection(await reader.read(absolute), config.maxCharsPerArea);
    standards.push({
      id: entry.id,
      area: entry.area,
      docPath: entry.docPath,
      text,
      truncated,
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
