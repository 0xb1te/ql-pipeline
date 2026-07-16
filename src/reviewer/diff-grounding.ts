import type { Finding } from '../shared/types.js';

// Matches every `+++ ...` header line, whether it names a file (`b/path`)
// or marks a deleted file's new side (`/dev/null`) — both must be consumed
// here so neither ever falls through to the generic `+`-prefixed content
// check below (a bug caught in testing: `+++ /dev/null` also starts with
// `+` and was being misread as an added line in the *previous* file).
const NEW_FILE_HEADER = /^\+\+\+ (.+)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export interface DiffLineIndex {
  hasFile(file: string): boolean;
  hasLine(file: string, line: number): boolean;
}

/**
 * Indexes which (file, line) pairs actually exist in the *new* side of a
 * unified diff, so reviewer findings can be checked against reality instead
 * of trusted at face value. Only context and added lines count — a removed
 * line no longer exists in the new file, so a finding can't legitimately
 * point at one.
 */
export function buildDiffLineIndex(diff: string): DiffLineIndex {
  const linesByFile = new Map<string, Set<number>>();
  let currentFile: string | null = null;
  let nextNewLine = 0;

  for (const line of diff.split('\n')) {
    const newFileMatch = NEW_FILE_HEADER.exec(line);
    if (newFileMatch) {
      const target = newFileMatch[1]!;
      if (target === '/dev/null') {
        // The file was deleted — there is no new side to index lines in.
        currentFile = null;
      } else {
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
      nextNewLine = Number(hunkMatch[1]!);
      continue;
    }

    if (currentFile === null) {
      continue;
    }

    if (line.startsWith('+')) {
      linesByFile.get(currentFile)!.add(nextNewLine);
      nextNewLine += 1;
    } else if (line.startsWith(' ')) {
      linesByFile.get(currentFile)!.add(nextNewLine);
      nextNewLine += 1;
    }
    // Lines starting with `-` were removed and have no place in the new
    // file; everything else (diff/index headers, "\ No newline…") carries
    // no line-number information and is ignored.
  }

  return {
    hasFile(file): boolean {
      return linesByFile.has(file);
    },
    hasLine(file, line): boolean {
      return linesByFile.get(file)?.has(line) ?? false;
    },
  };
}

export interface GroundingResult {
  readonly grounded: readonly Finding[];
  readonly discarded: readonly { readonly finding: Finding; readonly reason: string }[];
}

/**
 * Applies the reviewer's grounding requirement (plan.md §4.4): a finding
 * must cite a file/line that really appears in the diff, and a rule file
 * that was actually loaded for this PR. Anything else is discarded rather
 * than trusted — our hallucination guard on the reviewer itself.
 */
export function groundFindings(
  findings: readonly Finding[],
  diffIndex: DiffLineIndex,
  loadedRuleFiles: readonly string[],
): GroundingResult {
  const grounded: Finding[] = [];
  const discarded: { finding: Finding; reason: string }[] = [];

  for (const finding of findings) {
    if (!diffIndex.hasFile(finding.file)) {
      discarded.push({ finding, reason: `file "${finding.file}" does not appear in the diff` });
      continue;
    }
    if (!diffIndex.hasLine(finding.file, finding.line)) {
      discarded.push({ finding, reason: `line ${finding.line} of "${finding.file}" does not appear in the diff` });
      continue;
    }
    if (!loadedRuleFiles.some((ruleFile) => finding.rule.startsWith(`${ruleFile.replace(/\.rules$/, '')}.rules#`))) {
      discarded.push({ finding, reason: `rule "${finding.rule}" is not from a rule file loaded for this PR` });
      continue;
    }
    grounded.push(finding);
  }

  return { grounded, discarded };
}
