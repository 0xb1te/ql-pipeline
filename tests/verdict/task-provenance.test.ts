import { describe, expect, it } from 'vitest';
import {
  decideTaskProvenance,
  taskProvenanceFinding,
  taskSuffixOf,
  type SprintTask,
} from '../../src/verdict/task-provenance.js';

/** A Notion page id, in the dashed shape ql-sprint stores and derives its branch suffix from. */
const PAGE_ID = '2a7f3c19-4d5e-4f60-9b21-0c8e5a6d7b41';
/** What ql-sprint's `branchNameFor` puts on the end of every branch it cuts from PAGE_ID. */
const SUFFIX = '2a7f3c';

function task(overrides: Partial<SprintTask> = {}): SprintTask {
  return { id: PAGE_ID, branch: null, prNumber: null, ...overrides };
}

describe('taskSuffixOf', () => {
  it('reads the six-hex id suffix off a branch ql-sprint cut', () => {
    expect(taskSuffixOf(`features/add-a-thing-${SUFFIX}`)).toBe(SUFFIX);
  });

  it('is null for a branch that ends in words, which is what an invented task looks like', () => {
    expect(taskSuffixOf('bugfixes/077-a-comment-cancels-the-verdict')).toBeNull();
  });

  it('is null when the tail is the right length but not hex', () => {
    expect(taskSuffixOf('features/some-work-zzzzzz')).toBeNull();
  });

  it('is null when the tail is hex but the wrong length', () => {
    expect(taskSuffixOf('features/some-work-2a7f3')).toBeNull();
    expect(taskSuffixOf('features/some-work-2a7f3c1')).toBeNull();
  });

  it('does not read an uppercase tail as a suffix, because ql-sprint never writes one', () => {
    expect(taskSuffixOf('features/some-work-2A7F3C')).toBeNull();
  });
});

describe('decideTaskProvenance', () => {
  it('matches on prNumber first, the only evidence that survives a branch rename', () => {
    const renamed = decideTaskProvenance({
      headRef: 'someone/renamed-this-branch',
      prNumber: 44,
      tasks: [task({ branch: `features/original-${SUFFIX}`, prNumber: 44 })],
    });

    expect(renamed).toMatchObject({ kind: 'task', taskId: PAGE_ID, matchedBy: 'pr-number' });
  });

  it('matches an exact branch when ql-sprint has not recorded a PR number yet', () => {
    const decision = decideTaskProvenance({
      headRef: `features/add-a-thing-${SUFFIX}`,
      prNumber: 44,
      tasks: [task({ branch: `features/add-a-thing-${SUFFIX}` })],
    });

    expect(decision).toMatchObject({ kind: 'task', matchedBy: 'branch' });
  });

  it('matches on the id suffix for a task whose branch and PR number are both still null', () => {
    // The window between ql-sprint creating the task and the run that opens its pull request:
    // nothing is recorded against the task yet, but the branch already carries its id.
    const decision = decideTaskProvenance({
      headRef: `features/add-a-thing-${SUFFIX}`,
      prNumber: 44,
      tasks: [task()],
    });

    expect(decision).toMatchObject({ kind: 'task', taskId: PAGE_ID, matchedBy: 'branch-suffix' });
  });

  it('does not let a null branch match a branch that is merely absent', () => {
    // `task.branch === headRef` must never be reached with both sides nullish.
    const decision = decideTaskProvenance({ headRef: '', prNumber: 44, tasks: [task()] });

    expect(decision.kind).toBe('no-task');
  });

  it('does not let a null prNumber match a pull request, either', () => {
    const decision = decideTaskProvenance({
      headRef: 'bugfixes/077-invented',
      prNumber: Number.NaN,
      tasks: [task()],
    });

    expect(decision.kind).toBe('no-task');
  });

  it('calls a branch that ends in words what it is: not something ql-sprint cut', () => {
    const decision = decideTaskProvenance({
      headRef: 'bugfixes/077-a-comment-cancels-the-verdict',
      prNumber: 44,
      tasks: [task({ branch: `features/add-a-thing-${SUFFIX}`, prNumber: 12 })],
    });

    expect(decision.kind).toBe('no-task');
    expect(decision.reason).toContain('does not end in a six-character task id');
  });

  it('distinguishes "no suffix at all" from "a suffix that matches nothing"', () => {
    // Different situations: the first was never ql-sprint's, the second may be a task this
    // caller could not see. One sentence for both would hide that.
    const unknownSuffix = decideTaskProvenance({
      headRef: 'features/some-work-abcdef',
      prNumber: 44,
      tasks: [task()],
    });

    expect(unknownSuffix.kind).toBe('no-task');
    expect(unknownSuffix.reason).toContain('matches no task ql-sprint returned');
  });

  it('is no-task against an empty task list rather than throwing', () => {
    expect(decideTaskProvenance({ headRef: `features/x-${SUFFIX}`, prNumber: 1, tasks: [] }).kind).toBe('no-task');
  });

  it('matches an undashed Notion page id, which ql-sprint also stores', () => {
    const undashed = PAGE_ID.replace(/-/g, '');

    const decision = decideTaskProvenance({
      headRef: `features/add-a-thing-${SUFFIX}`,
      prNumber: 44,
      tasks: [task({ id: undashed })],
    });

    expect(decision).toMatchObject({ kind: 'task', matchedBy: 'branch-suffix' });
  });
});

describe('taskProvenanceFinding', () => {
  it('raises nothing when the pull request has a task', () => {
    const decision = decideTaskProvenance({ headRef: `features/x-${SUFFIX}`, prNumber: 44, tasks: [task()] });

    expect(taskProvenanceFinding(decision)).toBeNull();
  });

  it('is advisory and never auto-fixable, because no agent can invent a Notion task', () => {
    const decision = decideTaskProvenance({ headRef: 'bugfixes/077-invented', prNumber: 44, tasks: [] });

    const finding = taskProvenanceFinding(decision);

    expect(finding).toMatchObject({ severity: 'should', rule: 'task#provenance', autoFixable: false });
  });

  it('carries the reason into the comment, so the PR says why it was flagged', () => {
    const decision = decideTaskProvenance({ headRef: 'bugfixes/077-invented', prNumber: 44, tasks: [] });

    expect(taskProvenanceFinding(decision)?.problem).toContain('does not end in a six-character task id');
  });
});
