import type { Area } from '../shared/types.js';
/** Where a consumer repo may place per-area rule overrides (docs/integration-guide.md §5). */
export declare const CONSUMER_RULES_DIR: string;
/** Rules that always apply and are deliberately not overridable per-area. */
export declare const COMMON_RULES_FILE = "_common.rules";
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
export declare function resolveRuleFiles(areas: readonly Area[], paths: RuleResolutionPaths, reader?: RuleFileReader): ResolvedRuleFile[];
/** The rule-file IDs the reviewer is allowed to cite, for the grounding check. */
export declare function ruleFileIds(files: readonly ResolvedRuleFile[]): string[];
/** Concatenates the resolved rules into the block injected into the reviewer prompt. */
export declare function formatRulesForPrompt(files: readonly ResolvedRuleFile[]): string;
