// Matches every `+++ ...` header line, whether it names a file (`b/path`)
// or marks a deleted file's new side (`/dev/null`) — both must be consumed
// here so neither ever falls through to the generic `+`-prefixed content
// check below (a bug caught in testing: `+++ /dev/null` also starts with
// `+` and was being misread as an added line in the *previous* file).
const NEW_FILE_HEADER = /^\+\+\+ (.+)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
/**
 * Indexes which (file, line) pairs actually exist in the *new* side of a
 * unified diff, so reviewer findings can be checked against reality instead
 * of trusted at face value. Only context and added lines count — a removed
 * line no longer exists in the new file, so a finding can't legitimately
 * point at one.
 */
export function buildDiffLineIndex(diff) {
    const linesByFile = new Map();
    let currentFile = null;
    let nextNewLine = 0;
    for (const line of diff.split('\n')) {
        const newFileMatch = NEW_FILE_HEADER.exec(line);
        if (newFileMatch) {
            const target = newFileMatch[1];
            if (target === '/dev/null') {
                // The file was deleted — there is no new side to index lines in.
                currentFile = null;
            }
            else {
                // Git always emits the "b/" destination prefix by default (GitHub's
                // diff output included), so this is a plain strip, not a guess.
                // Each file gets exactly one "+++" header in a unified diff (all of
                // its hunks nest under that one header), so a fresh Set is always
                // correct here — there's no prior entry to preserve.
                currentFile = target.slice(2);
                linesByFile.set(currentFile, new Set());
            }
            continue;
        }
        const hunkMatch = HUNK_HEADER.exec(line);
        if (hunkMatch) {
            nextNewLine = Number(hunkMatch[1]);
            continue;
        }
        if (currentFile === null) {
            continue;
        }
        if (line.startsWith('+')) {
            linesByFile.get(currentFile).add(nextNewLine);
            nextNewLine += 1;
        }
        else if (line.startsWith(' ')) {
            linesByFile.get(currentFile).add(nextNewLine);
            nextNewLine += 1;
        }
        // Lines starting with `-` were removed and have no place in the new
        // file; everything else (diff/index headers, "\ No newline…") carries
        // no line-number information and is ignored.
    }
    return {
        hasFile(file) {
            return linesByFile.has(file);
        },
        hasLine(file, line) {
            return linesByFile.get(file)?.has(line) ?? false;
        },
    };
}
/**
 * Applies the reviewer's grounding requirement (SPECIFICATION.md §6): a
 * finding must cite a file/line that really appears in the diff, and a
 * reference that was actually loaded for this PR. Anything else is
 * discarded rather than trusted — the hallucination guard on the reviewer.
 *
 * A "reference" is any loaded document id: a rule file (`backend.rules`)
 * or an engineering standards document (`backend.standards`). Both are
 * cited the same way, `<id>#<section>`.
 */
export function groundFindings(findings, diffIndex, loadedReferences) {
    const grounded = [];
    const discarded = [];
    for (const finding of findings) {
        if (!diffIndex.hasFile(finding.file)) {
            discarded.push({ finding, reason: `file "${finding.file}" does not appear in the diff` });
            continue;
        }
        if (!diffIndex.hasLine(finding.file, finding.line)) {
            discarded.push({ finding, reason: `line ${finding.line} of "${finding.file}" does not appear in the diff` });
            continue;
        }
        if (!loadedReferences.some((reference) => finding.rule.startsWith(`${reference}#`))) {
            discarded.push({
                finding,
                reason: `rule "${finding.rule}" does not cite a rule file or standards document loaded for this PR`,
            });
            continue;
        }
        grounded.push(finding);
    }
    return { grounded, discarded };
}
//# sourceMappingURL=diff-grounding.js.map