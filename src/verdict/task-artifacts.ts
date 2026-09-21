// @neuron verdict.decision.taskArtifacts
import type { Finding, RequiredCheck } from '../shared/types.js';

/** The three task kinds ql-docs' flows produce, always plural, matching the branch prefix. */
export const TASK_KINDS = ['features', 'hotfixes', 'bugfixes'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/**
 * The two artifacts a task folder owes an automated tester.
 *
 * `testing-plan.xlsx` carries the pinned `MCP Cases` sheet the tester job parses; `seed.sql`
 * carries the fixtures those cases run against. Both are required of every task folder by
 * ql-docs `workflow/flows/testing-plan.md` and `seed-data.md`.
 *
 * The generated `testing-plan.md` rendering is deliberately *not* checked here. It is derived
 * from the workbook rather than authored, so a missing one is a forgotten command rather than a
 * missing contract, and it is the AI review - which is the thing that reads it - that notices.
 */
export const REQUIRED_TASK_ARTIFACTS = ['testing-plan.xlsx', 'seed.sql'] as const;

/** Which task folder a branch names, by kind and number. */
export interface TaskFolderRef {
  readonly kind: TaskKind;
  /** Zero-padded to three, as ql-docs mandates. Unique per kind and never reused. */
  readonly number: string;
}

/** What the caller found on disk for a branch, or why it did not look. */
export type TaskFolderLookup =
  | { readonly kind: 'not-a-task-branch'; readonly headRef: string }
  | { readonly kind: 'no-folder'; readonly ref: TaskFolderRef }
  | { readonly kind: 'folder'; readonly ref: TaskFolderRef; readonly path: string; readonly files: readonly string[] };

/**
 * The task folder a branch names, or null when it names none.
 *
 * Matched on `<kind>/NNN`, not on the whole slug, and that is the point. ql-sprint appends
 * `-<first six hex of the Notion page id>` to every branch it cuts, so an exact slug comparison
 * would miss `features/007-statistics-dashboard-a1b2c3` against `docs/features/007-statistics-
 * dashboard/`. Matching the number instead is exact anyway: ql-docs gives each kind its own
 * counter and never reuses a number, so `docs/features/007-*` resolves to one folder or none.
 *
 * A branch that names no task folder - `dependabot/npm/lodash`, `main`, a bare `hotfix` - returns
 * null, and the caller raises nothing. That is deliberate. This check exists to make sure a task
 * folder is complete, not to force every branch in every repository through the task flow; a
 * dependency bump has no task folder to be missing artifacts from. A pull request with no task at
 * all is already reported, advisorily, by verdict.decision.taskProvenance.
 */
// @signal taskFolderRefOf
export function taskFolderRefOf(headRef: string): TaskFolderRef | null {
  const branch = headRef.trim().replace(/\\/g, '/');
  const match = /(?:^|\/)(features|hotfixes|bugfixes)\/(\d{3})(?:-|$)/.exec(branch);
  if (match === null) return null;
  return { kind: match[1] as TaskKind, number: match[2] as string };
}

/** The glob a caller resolves to find the folder. Exported so the message and the search agree. */
// @signal taskFolderGlobFor
export function taskFolderGlobFor(ref: TaskFolderRef): string {
  return `docs/${ref.kind}/${ref.number}-*/`;
}

/**
 * Which required artifacts a task folder is missing, given its file names.
 *
 * Pure, and takes the listing rather than a path, so the question is answerable in a test without
 * a filesystem - the same reason taskProvenance takes the task list rather than reaching for
 * ql-sprint.
 */
// @signal missingTaskArtifacts
export function missingTaskArtifacts(files: readonly string[]): readonly string[] {
  const present = new Set(files.map((file) => file.toLowerCase()));
  return REQUIRED_TASK_ARTIFACTS.filter((artifact) => !present.has(artifact.toLowerCase()));
}

const WHY_STRUCTURAL = [
  'This is checked structurally, before the AI review, for the same reason RULES.md R4 is: whether',
  'a file exists is not a matter of opinion, and a reviewer is the wrong enforcement mechanism for',
  'it. A judgement can be argued with; a missing file cannot.',
].join(' ');

const WHAT_THEY_ARE: Readonly<Record<string, string>> = {
  'testing-plan.xlsx':
    'the test plan, carrying the pinned `MCP Cases` sheet the automated tester parses. Copy ' +
    '`workflow/flows/assets/testing-plan.template.xlsx` and fill it in — see ql-docs ' +
    '`workflow/flows/testing-plan.md`',
  'seed.sql':
    'the synthetic fixtures the preview database boots with. Copy ' +
    '`workflow/flows/assets/seed.template.sql`. A task that needs no data still ships the file, ' +
    'carrying a comment saying so — see ql-docs `workflow/flows/seed-data.md`',
};

/**
 * The finding a task folder earns for being absent or incomplete, or null when it is complete.
 *
 * `must` only when the repository has opted in by listing `task-artifacts` in
 * `merge.required_checks`; `should` otherwise. This mirrors requiredChecks#gateFindings exactly,
 * and for the same reason: a check that starts blocking the day it ships turns every pull request
 * already in flight red at once, and hands every author the same repair job in the same files.
 * Advisory everywhere from day one, blocking where a repository has said it is ready, is how a
 * standard arrives without an outage.
 *
 * autoFixable is false throughout. A fix agent cannot invent a test plan or the data it runs
 * against, and claiming otherwise would spend an attempt discovering that - the same reasoning
 * taskProvenance gives for a task nobody can invent either.
 */
// @signal taskArtifactFinding
export function taskArtifactFinding(
  lookup: TaskFolderLookup,
  requiredChecks: readonly RequiredCheck[],
): Finding | null {
  if (lookup.kind === 'not-a-task-branch') return null;

  const severity = requiredChecks.includes('task-artifacts') ? ('must' as const) : ('should' as const);
  const base = {
    severity,
    rule: 'task#artifacts',
    file: '(task)',
    line: 1,
    suggestedFix: null,
    autoFixable: false,
  };

  if (lookup.kind === 'no-folder') {
    const glob = taskFolderGlobFor(lookup.ref);
    return {
      ...base,
      problem:
        `This branch names task ${lookup.ref.number} of \`${lookup.ref.kind}\`, but no folder matches ` +
        `\`${glob}\`. Every task opens one, and it carries the plan, the test plan and the data a ` +
        `preview needs.\n\n${WHY_STRUCTURAL}`,
    };
  }

  const missing = missingTaskArtifacts(lookup.files);
  if (missing.length === 0) return null;

  const lines = missing.map((artifact) => `- \`${artifact}\` — ${WHAT_THEY_ARE[artifact] ?? 'required by the task-folder contract'}`);
  const plural = missing.length === 1 ? 'artifact' : 'artifacts';
  return {
    ...base,
    problem:
      `\`${lookup.path}\` is missing ${String(missing.length)} required ${plural}:\n\n${lines.join('\n')}\n\n` +
      `Without them an automated tester has no plan to run and no data to run it against, so a ` +
      `preview of this pull request can only be read, not exercised.\n\n${WHY_STRUCTURAL}`,
  };
}
