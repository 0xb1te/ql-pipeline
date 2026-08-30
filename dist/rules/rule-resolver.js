// @neuron rules.resolver.ruleResolver
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
/** Where a consumer repo may place per-area rule overrides (docs/integration-guide.md §5). */
export const CONSUMER_RULES_DIR = join('.github', 'pipeline-rules');
/** Rules that always apply and are deliberately not overridable per-area. */
export const COMMON_RULES_FILE = '_common.rules';
const defaultReader = {
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
// @signal resolveRuleFiles
export function resolveRuleFiles(areas, paths, reader = defaultReader) {
    const resolved = [
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
// @signal ruleFileIds
export function ruleFileIds(files) {
    return files.map((file) => file.id);
}
/** Concatenates the resolved rules into the block injected into the reviewer prompt. */
// @signal formatRulesForPrompt
export function formatRulesForPrompt(files) {
    return files.map((file) => `----- ${file.id} (${file.source}) -----\n${file.text}`).join('\n\n');
}
//# sourceMappingURL=rule-resolver.js.map