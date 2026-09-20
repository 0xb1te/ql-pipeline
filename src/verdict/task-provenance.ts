// @neuron verdict.decision.taskProvenance
import type { Finding } from '../shared/types.js';

/**
 * The part of a ql-sprint `TaskRecord` this pipeline needs in order to recognise its own work.
 *
 * Deliberately three fields out of the twenty ql-sprint stores. Everything else on that record —
 * state, priority, Telegram topic ids, the sprint budget — belongs to the orchestrator and would
 * only be a shape to keep in step for no gain here.
 */
export interface SprintTask {
  /** Notion page id. The branch suffix is derived from it, so it is the identity that survives a rename. */
  readonly id: string;
  /** The branch ql-sprint created for this task, or null before one was cut. */
  readonly branch: string | null;
  /** The pull request that branch opened, or null before it opened one. */
  readonly prNumber: number | null;
}

/** How a pull request was tied back to a task — strongest evidence first. */
export type TaskMatch = 'pr-number' | 'branch' | 'branch-suffix';

export type TaskProvenance =
  | { readonly kind: 'task'; readonly taskId: string; readonly matchedBy: TaskMatch; readonly reason: string }
  | { readonly kind: 'no-task'; readonly reason: string };

export interface TaskProvenanceInput {
  readonly headRef: string;
  readonly prNumber: number;
  readonly tasks: readonly SprintTask[];
}

/**
 * The task-id suffix ql-sprint puts on every branch it cuts, or null when the branch carries none.
 *
 * ql-sprint's `branchNameFor` ends every branch it creates with `-<first 6 hex of the Notion page
 * id>`, which is what makes a branch traceable back to a task even after the task is renamed. A
 * branch that ends in words instead — `bugfixes/077-a-comment-cancels-the-verdict` — was not cut
 * by ql-sprint, and that is the signal this reads.
 *
 * Six hex characters is a small alphabet, so an ordinary English word can look like one: `facade`
 * is six valid hex digits and a branch ending in it parses as a suffix here. That costs nothing.
 * A suffix is only ever a *lookup key* — it identifies a task solely when some real task's id
 * actually begins with those digits, and is checked last, after the two exact matches.
 */
// @signal taskSuffixOf
export function taskSuffixOf(headRef: string): string | null {
  const match = /-([0-9a-f]{6})$/.exec(headRef.trim());
  return match?.[1] ?? null;
}

/** ql-sprint's own derivation, reproduced so a task whose branch is still null can still be matched. */
function suffixOfTaskId(taskId: string): string {
  return taskId.replace(/-/g, '').slice(0, 6).toLowerCase();
}

/**
 * Whether this pull request corresponds to a real ql-sprint/Notion task, or is work somebody
 * invented outside that flow.
 *
 * Pure, and deliberately advisory: the answer is evidence for a person, never grounds to refuse a
 * pull request. Plenty of legitimate work starts outside ql-sprint — a hotfix at 2am, a
 * dependency bump, a contributor who has never heard of Notion — and a pipeline that blocked it
 * would be enforcing a process the repository never agreed to.
 *
 * Three matches, strongest first, because they fail in different ways:
 *
 * - `prNumber` is ql-sprint's own record of which pull request this task opened. It is the only
 *   one that survives a branch being renamed or force-pushed, so it is tried first.
 * - an exact `branch` match is ql-sprint's record of what it cut. It is exact, but goes stale the
 *   moment anybody renames the branch.
 * - the six-hex suffix is derived rather than recorded, so it still answers for a task whose
 *   `branch` and `prNumber` are both still null — the window between ql-sprint creating a task
 *   and the run that opens its pull request.
 *
 * A branch with no suffix at all gets a different sentence from one whose suffix matches nothing,
 * because they are different situations: the first was never ql-sprint's, and the second may be a
 * task this caller could not see (a different project's tasks, or a filtered list).
 */
// @signal decideTaskProvenance
export function decideTaskProvenance(input: TaskProvenanceInput): TaskProvenance {
  const byNumber = input.tasks.find((task) => task.prNumber === input.prNumber);
  if (byNumber !== undefined) {
    return {
      kind: 'task',
      taskId: byNumber.id,
      matchedBy: 'pr-number',
      reason: `ql-sprint records task ${byNumber.id} as the owner of pull request #${String(input.prNumber)}`,
    };
  }

  const headRef = input.headRef.trim();
  const byBranch = input.tasks.find((task) => task.branch !== null && task.branch === headRef);
  if (byBranch !== undefined) {
    return {
      kind: 'task',
      taskId: byBranch.id,
      matchedBy: 'branch',
      reason: `ql-sprint cut branch ${headRef} for task ${byBranch.id}`,
    };
  }

  const suffix = taskSuffixOf(headRef);
  if (suffix === null) {
    return {
      kind: 'no-task',
      reason:
        `branch ${headRef} does not end in a six-character task id, so it was not created by ql-sprint ` +
        '(every branch it cuts ends in the first six hex characters of the task’s Notion page id)',
    };
  }

  const bySuffix = input.tasks.find((task) => suffixOfTaskId(task.id) === suffix);
  if (bySuffix !== undefined) {
    return {
      kind: 'task',
      taskId: bySuffix.id,
      matchedBy: 'branch-suffix',
      reason: `branch ${headRef} carries the id suffix of task ${bySuffix.id}`,
    };
  }

  return {
    kind: 'no-task',
    reason: `branch ${headRef} ends in "${suffix}", which matches no task ql-sprint returned`,
  };
}

/** What the advisory comment says, kept next to the decision that produces it. */
const NO_TASK_PROBLEM = [
  'This pull request does not correspond to any task ql-sprint knows about, so nothing in Notion',
  'tracks why it exists or who asked for it.',
  '',
  'That is reported, not refused — a hotfix, a dependency bump or a drive-by contribution is',
  'legitimate work that never went through the sprint flow. It is worth knowing about because the',
  'sprint board is what a person reads to find out what this repository is doing, and work that is',
  'not on it is invisible there.',
].join(' ');

/**
 * The advisory finding a taskless pull request earns, or null when it has a task.
 *
 * `should`, never `must` - see decideTaskProvenance for why this may not block. `autoFixable` is
 * false because no fix agent can invent a Notion task, and claiming otherwise would spend an
 * attempt discovering that.
 *
 * The pseudo-path follows the one gateFindings already uses for a finding that is about the pull
 * request rather than about a line of code in it.
 */
// @signal taskProvenanceFinding
export function taskProvenanceFinding(provenance: TaskProvenance): Finding | null {
  if (provenance.kind === 'task') return null;
  return {
    severity: 'should',
    rule: 'task#provenance',
    file: '(task)',
    line: 1,
    problem: `${NO_TASK_PROBLEM}\n\nWhy this run says so: ${provenance.reason}.`,
    suggestedFix: null,
    autoFixable: false,
  };
}
