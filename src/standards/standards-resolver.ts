import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Area, StandardsConfig } from '../shared/types.js';

export interface ResolvedStandard {
  /** Reference id findings cite, e.g. `frontend.standards`. */
  readonly id: string;
  readonly area: Area;
  /** Path relative to the standards root, kept so the reviewer can name its source. */
  readonly docPath: string;
  readonly text: string;
  readonly truncated: boolean;
}

export interface StandardsResolution {
  readonly standards: readonly ResolvedStandard[];
  /** Docs the config named that were not present — surfaced, never silently ignored. */
  readonly missing: readonly string[];
}

export interface StandardsReader {
  exists: (path: string) => boolean;
  read: (path: string) => string;
}

const defaultReader: StandardsReader = {
  exists: (path) => existsSync(path),
  read: (path) => readFileSync(path, 'utf-8'),
};

export function standardsIdFor(area: Area): string {
  return `${area}.standards`;
}

/**
 * Truncates on a section boundary where possible. The checklists are
 * organised as `## NN — Title` sections, so cutting mid-section would hand
 * the reviewer half a rule; dropping whole trailing sections at least
 * leaves every included rule intact and says what was dropped.
 */
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
 * Loads the engineering standards that apply to a PR's areas — the house
 * workflow documentation, checked out alongside the code under review.
 *
 * Each area's documents are concatenated into a single reference the
 * reviewer can cite, budgeted per area so a large checklist cannot crowd
 * the diff out of the prompt.
 */
export function resolveStandards(
  areas: readonly Area[],
  config: StandardsConfig,
  workspaceRoot: string,
  reader: StandardsReader = defaultReader,
): StandardsResolution {
  if (!config.enabled) {
    return { standards: [], missing: [] };
  }

  const standards: ResolvedStandard[] = [];
  const missing: string[] = [];

  for (const area of areas) {
    const docPaths = config.docs[area];
    if (docPaths === undefined || docPaths.length === 0) {
      continue;
    }

    const parts: string[] = [];
    const included: string[] = [];

    for (const docPath of docPaths) {
      const absolute = join(workspaceRoot, config.root, docPath);
      if (!reader.exists(absolute)) {
        missing.push(docPath);
        continue;
      }
      parts.push(`===== ${docPath} =====\n\n${reader.read(absolute)}`);
      included.push(docPath);
    }

    if (parts.length === 0) {
      continue;
    }

    const { text, truncated } = truncateAtSection(parts.join('\n\n'), config.maxCharsPerArea);
    standards.push({
      id: standardsIdFor(area),
      area,
      docPath: included.join(', '),
      text,
      truncated,
    });
  }

  return { standards, missing };
}

/** The reference ids the reviewer may cite for these standards. */
export function standardsIds(standards: readonly ResolvedStandard[]): string[] {
  return standards.map((standard) => standard.id);
}

/** Renders the standards block injected into the reviewer prompt. */
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
