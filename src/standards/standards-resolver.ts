// @neuron standards.reader.standardsResolver
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

/**
 * A source of standards documents, keyed by the same absolute path
 * `resolveStandards` joins from `workspaceRoot` + `config.root` + a
 * configured doc path. HTTP-backed implementations (`HouseStandardsReader`)
 * reverse that join internally to recover the doc path they actually need —
 * this interface's shape stays the local-filesystem one so neither side has
 * to change when a new transport is added.
 *
 * Both methods are `Promise`-returning because a reader backed by a network
 * call is inherently async; the local-filesystem reader below just resolves
 * immediately.
 */
export interface StandardsReader {
  exists: (path: string) => Promise<boolean>;
  read: (path: string) => Promise<string>;
}

const defaultReader: StandardsReader = {
  exists: (path) => Promise.resolve(existsSync(path)),
  read: (path) => Promise.resolve(readFileSync(path, 'utf-8')),
};

// @signal standardsIdFor
export function standardsIdFor(area: Area): string {
  return `${area}.standards`;
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
 * Loads the engineering standards that apply to a PR's areas — the house
 * workflow documentation, checked out alongside the code under review.
 *
 * Each area's documents are concatenated into a single reference the
 * reviewer can cite, budgeted per area so a large checklist cannot crowd
 * the diff out of the prompt.
 */
// @signal resolveStandards
export async function resolveStandards(
  areas: readonly Area[],
  config: StandardsConfig,
  workspaceRoot: string,
  reader: StandardsReader = defaultReader,
): Promise<StandardsResolution> {
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
      if (!(await reader.exists(absolute))) {
        missing.push(docPath);
        continue;
      }
      parts.push(`===== ${docPath} =====\n\n${await reader.read(absolute)}`);
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
