import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Area } from '../shared/types.js';

/** Where a consumer repo may place per-area rule overrides (docs/integration-guide.md §5). */
export const CONSUMER_RULES_DIR = join('.github', 'pipeline-rules');

/** Rules that always apply and are deliberately not overridable per-area. */
export const COMMON_RULES_FILE = '_common.rules';

export type RuleSource = 'shipped' | 'consumer';

export interface ResolvedRuleFile {
  /** The rule-file identity used in finding IDs, e.g. `backend.rules`. */
  readonly id: string;
  readonly area: Area | null;
  readonly source: RuleSource;
  readonly path: string;
  readonly text: string;
}

export interface RuleResolutionPaths {
  /** ql-pipeline's own checkout, which ships the default `rules/` directory. */
  readonly pipelineRoot: string;
  /** The consumer repo's checkout, which may carry `.github/pipeline-rules/`. */
  readonly consumerRoot: string;
}

export interface RuleFileReader {
  exists: (path: string) => boolean;
  read: (path: string) => string;
}

const defaultReader: RuleFileReader = {
  exists: (path) => existsSync(path),
  read: (path) => readFileSync(path, 'utf-8'),
};

/**
 * Resolves the rule files that apply to a PR. `_common.rules` always comes
 * from ql-pipeline's own checkout; each matched area prefers the consumer's
 * `.github/pipeline-rules/<area>.rules` when present, and otherwise falls
 * back to the shipped default.
 *
 * An override *fully replaces* that area's shipped rules rather than
 * merging into them — a partial merge would leave it ambiguous which
 * definition of a rule ID won, and the reviewer cites rule IDs as evidence.
 */
export function resolveRuleFiles(
  areas: readonly Area[],
  paths: RuleResolutionPaths,
  reader: RuleFileReader = defaultReader,
): ResolvedRuleFile[] {
  const resolved: ResolvedRuleFile[] = [
    {
      id: COMMON_RULES_FILE,
      area: null,
      source: 'shipped',
      path: join(paths.pipelineRoot, 'rules', COMMON_RULES_FILE),
      text: reader.read(join(paths.pipelineRoot, 'rules', COMMON_RULES_FILE)),
    },
  ];

  for (const area of areas) {
    const id = `${area}.rules`;
    const consumerPath = join(paths.consumerRoot, CONSUMER_RULES_DIR, id);

    if (reader.exists(consumerPath)) {
      resolved.push({ id, area, source: 'consumer', path: consumerPath, text: reader.read(consumerPath) });
      continue;
    }

    // An area with no shipped rule file is normal, not an error: for most
    // areas the house engineering standards (docs/SPECIFICATION.md) are the
    // authoritative source, and duplicating them here as hand-written rules
    // would mean two definitions of the same requirement that can disagree.
    const shippedPath = join(paths.pipelineRoot, 'rules', id);
    if (reader.exists(shippedPath)) {
      resolved.push({ id, area, source: 'shipped', path: shippedPath, text: reader.read(shippedPath) });
    }
  }

  return resolved;
}

/** The rule-file IDs the reviewer is allowed to cite, for the grounding check. */
export function ruleFileIds(files: readonly ResolvedRuleFile[]): string[] {
  return files.map((file) => file.id);
}

/** Concatenates the resolved rules into the block injected into the reviewer prompt. */
export function formatRulesForPrompt(files: readonly ResolvedRuleFile[]): string {
  return files.map((file) => `----- ${file.id} (${file.source}) -----\n${file.text}`).join('\n\n');
}
