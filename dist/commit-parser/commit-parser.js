// @neuron routing.parser.commitParser
import { AREAS, COMMIT_TYPES } from '../shared/types.js';
const HEADER_PATTERN = new RegExp(`^(?<type>${COMMIT_TYPES.join('|')})\\((?<area>${AREAS.join('|')})\\): (?<description>.+)$`);
/**
 * Parses a single commit message's header line against the grammar
 * `<type>(<area>): <description>`. Only the first line is considered;
 * body/footer content does not affect parsing. Returns null for anything
 * that doesn't match — callers decide what an unparseable header means.
 */
// @signal parseCommitHeader
export function parseCommitHeader(message) {
    // `.split('\n', 1)` on any string always yields at least one element.
    const firstLine = message.split('\n', 1)[0];
    const headerLine = firstLine.endsWith('\r') ? firstLine.slice(0, -1) : firstLine;
    const match = HEADER_PATTERN.exec(headerLine);
    if (match === null) {
        return null;
    }
    // The pattern's three named groups are all mandatory (none is inside an
    // optional quantifier), so a successful match always populates them.
    const groups = match.groups;
    return {
        type: groups.type,
        area: groups.area,
        description: groups.description,
        raw: message,
    };
}
/**
 * Parses a batch of commit messages (e.g. every commit on a PR). Messages
 * that don't match the grammar are collected separately rather than
 * discarded — routing policy (fallback to the PR title, etc.) decides what
 * to do with them, this module only parses.
 */
// @signal parseCommits
export function parseCommits(messages) {
    const parsed = [];
    const unparsed = [];
    for (const message of messages) {
        const result = parseCommitHeader(message);
        if (result === null) {
            unparsed.push(message);
        }
        else {
            parsed.push(result);
        }
    }
    return { parsed, unparsed };
}
//# sourceMappingURL=commit-parser.js.map