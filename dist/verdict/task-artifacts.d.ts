import type { Finding, RequiredCheck } from '../shared/types.js';
/** The three task kinds ql-docs' flows produce, always plural, matching the branch prefix. */
export declare const TASK_KINDS: readonly ["features", "hotfixes", "bugfixes"];
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
export declare const REQUIRED_TASK_ARTIFACTS: readonly ["testing-plan.xlsx", "seed.sql"];
/** Which task folder a branch names, by kind and number. */
export interface TaskFolderRef {
    readonly kind: TaskKind;
    /** Zero-padded to three, as ql-docs mandates. Unique per kind and never reused. */
    readonly number: string;
}
/** What the caller found on disk for a branch, or why it did not look. */
export type TaskFolderLookup = {
    readonly kind: 'not-a-task-branch';
    readonly headRef: string;
} | {
    readonly kind: 'no-folder';
    readonly ref: TaskFolderRef;
} | {
    readonly kind: 'folder';
    readonly ref: TaskFolderRef;
    readonly path: string;
    readonly files: readonly string[];
};
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
export declare function taskFolderRefOf(headRef: string): TaskFolderRef | null;
/** The glob a caller resolves to find the folder. Exported so the message and the search agree. */
export declare function taskFolderGlobFor(ref: TaskFolderRef): string;
/**
 * Which required artifacts a task folder is missing, given its file names.
 *
 * Pure, and takes the listing rather than a path, so the question is answerable in a test without
 * a filesystem - the same reason taskProvenance takes the task list rather than reaching for
 * ql-sprint.
 */
export declare function missingTaskArtifacts(files: readonly string[]): readonly string[];
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
export declare function taskArtifactFinding(lookup: TaskFolderLookup, requiredChecks: readonly RequiredCheck[]): Finding | null;
