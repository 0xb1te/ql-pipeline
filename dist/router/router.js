import { parseCommitHeader, parseCommits } from '../commit-parser/commit-parser.js';
import { AREAS, COMMIT_TYPES, } from '../shared/types.js';
/**
 * Determines how a PR should be routed: which areas it touches, which rule
 * files apply, and which gate commands to run. Prefers the union of areas
 * found across the PR's commits; a commit that doesn't match the grammar is
 * treated as noise (a "wip" commit, a merge commit) and skipped, as long as
 * at least one commit does parse. Only when zero commits parse does this
 * fall back to the PR title — and only when that also fails to parse is the
 * PR unroutable.
 */
export function determineRoute(input, config) {
    const { parsed } = parseCommits(input.commitMessages);
    if (parsed.length > 0) {
        return buildDecision(parsed.map((commit) => commit.type), parsed.map((commit) => commit.area), config);
    }
    const titleCommit = parseCommitHeader(input.prTitle);
    if (titleCommit !== null) {
        return buildDecision([titleCommit.type], [titleCommit.area], config);
    }
    return {
        ok: false,
        reason: `no commit on this PR matches the required header format \`<type>(<area>): <description>\`, ` +
            `and the PR title ("${input.prTitle}") doesn't either`,
    };
}
function buildDecision(types, areas, config) {
    const uniqueTypes = dedupeInCanonicalOrder(types, COMMIT_TYPES);
    const uniqueAreas = dedupeInCanonicalOrder(areas, AREAS);
    const ruleFiles = ['_common.rules', ...uniqueAreas.map((area) => `${area}.rules`)];
    const gates = uniqueAreas.map((area) => {
        const commands = config.gates[area];
        return {
            area,
            ...(commands?.build !== undefined ? { build: commands.build } : {}),
            ...(commands?.test !== undefined ? { test: commands.test } : {}),
        };
    });
    return {
        ok: true,
        decision: {
            types: uniqueTypes,
            areas: uniqueAreas,
            ruleFiles,
            gates,
        },
    };
}
function dedupeInCanonicalOrder(values, canonicalOrder) {
    const present = new Set(values);
    return canonicalOrder.filter((item) => present.has(item));
}
//# sourceMappingURL=router.js.map