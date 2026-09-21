import { describe, expect, it } from 'vitest';
import {
  missingTaskArtifacts,
  taskArtifactFinding,
  taskFolderGlobFor,
  taskFolderRefOf,
  REQUIRED_TASK_ARTIFACTS,
  type TaskFolderLookup,
} from '../../src/verdict/task-artifacts.js';
import type { RequiredCheck } from '../../src/shared/types.js';

const COMPLETE = ['index.md', 'plan.md', 'testing-plan.xlsx', 'testing-plan.md', 'seed.sql', 'summary.md'];
const OPTED_IN: readonly RequiredCheck[] = ['build', 'test', 'ai-review', 'task-artifacts'];
const NOT_OPTED_IN: readonly RequiredCheck[] = ['build', 'test', 'ai-review'];

function folder(files: readonly string[]): TaskFolderLookup {
  return {
    kind: 'folder',
    ref: { kind: 'features', number: '007' },
    path: 'docs/features/007-statistics-dashboard',
    files,
  };
}

describe('taskFolderRefOf', () => {
  it('reads the kind and number off a branch', () => {
    expect(taskFolderRefOf('features/007-statistics-dashboard')).toEqual({ kind: 'features', number: '007' });
  });

  it('still resolves a branch ql-sprint suffixed with a task id', () => {
    // The whole reason this matches on NNN rather than the slug: ql-sprint ends
    // every branch it cuts with six hex characters, so the slug never matches the
    // folder name exactly.
    expect(taskFolderRefOf('features/007-statistics-dashboard-a1b2c3')).toEqual({
      kind: 'features',
      number: '007',
    });
  });

  it.each([
    ['hotfixes/003-checkout-500-error', 'hotfixes', '003'],
    ['bugfixes/012-wrong-vat-rounding', 'bugfixes', '012'],
  ])('handles %s', (branch, kind, number) => {
    expect(taskFolderRefOf(branch)).toEqual({ kind, number });
  });

  it('accepts backslashes, which is what a Windows checkout reports', () => {
    expect(taskFolderRefOf('features\\007-statistics-dashboard')).toEqual({ kind: 'features', number: '007' });
  });

  it.each([
    'dependabot/npm_and_yarn/lodash-4.17.21',
    'main',
    'feature/007-wrong-kind-singular',
    'features/7-not-padded',
    'features/no-number-at-all',
  ])('is null for %s, which names no task folder', (branch) => {
    expect(taskFolderRefOf(branch)).toBeNull();
  });
});

describe('taskFolderGlobFor', () => {
  it('names the directory the caller searches', () => {
    expect(taskFolderGlobFor({ kind: 'features', number: '007' })).toBe('docs/features/007-*/');
  });
});

describe('missingTaskArtifacts', () => {
  it('finds nothing missing in a complete folder', () => {
    expect(missingTaskArtifacts(COMPLETE)).toEqual([]);
  });

  it('reports every missing artifact, not just the first', () => {
    expect(missingTaskArtifacts(['index.md', 'plan.md'])).toEqual([...REQUIRED_TASK_ARTIFACTS]);
  });

  it('ignores case, because a Windows checkout and a Linux runner disagree about Seed.SQL', () => {
    expect(missingTaskArtifacts(['Testing-Plan.XLSX', 'SEED.sql'])).toEqual([]);
  });

  it('does not require the generated rendering, which is derived rather than authored', () => {
    expect(missingTaskArtifacts(['testing-plan.xlsx', 'seed.sql'])).toEqual([]);
  });
});

describe('taskArtifactFinding', () => {
  it('raises nothing for a branch that names no task folder', () => {
    // A dependency bump has no task folder to be missing artifacts from. Blocking
    // it would enforce a process the repository never agreed to.
    expect(taskArtifactFinding({ kind: 'not-a-task-branch', headRef: 'dependabot/x' }, OPTED_IN)).toBeNull();
  });

  it('raises nothing for a complete folder', () => {
    expect(taskArtifactFinding(folder(COMPLETE), OPTED_IN)).toBeNull();
  });

  it('blocks with `must` when the repository opted in', () => {
    const finding = taskArtifactFinding(folder(['index.md']), OPTED_IN);
    expect(finding?.severity).toBe('must');
  });

  it('is advisory when the repository has not opted in', () => {
    // The whole point of the opt-in: shipping this check must not turn every pull
    // request already in flight red at once.
    const finding = taskArtifactFinding(folder(['index.md']), NOT_OPTED_IN);
    expect(finding?.severity).toBe('should');
  });

  it('names every missing artifact and where to copy it from', () => {
    const finding = taskArtifactFinding(folder(['index.md', 'plan.md']), OPTED_IN);
    expect(finding?.problem).toContain('testing-plan.xlsx');
    expect(finding?.problem).toContain('seed.sql');
    expect(finding?.problem).toContain('testing-plan.template.xlsx');
    expect(finding?.problem).toContain('seed.template.sql');
    expect(finding?.problem).toContain('docs/features/007-statistics-dashboard');
  });

  it('reports only the artifact that is actually missing', () => {
    const finding = taskArtifactFinding(folder(['index.md', 'testing-plan.xlsx']), OPTED_IN);
    expect(finding?.problem).toContain('seed.sql');
    expect(finding?.problem).not.toContain('`testing-plan.xlsx` —');
    expect(finding?.problem).toContain('1 required artifact');
  });

  it('says something different when the folder does not exist at all', () => {
    const finding = taskArtifactFinding({ kind: 'no-folder', ref: { kind: 'hotfixes', number: '003' } }, OPTED_IN);
    expect(finding?.problem).toContain('docs/hotfixes/003-*/');
    expect(finding?.problem).toContain('no folder matches');
  });

  it('is never auto-fixable — no agent can invent a test plan or its data', () => {
    const finding = taskArtifactFinding(folder([]), OPTED_IN);
    expect(finding?.autoFixable).toBe(false);
    expect(finding?.suggestedFix).toBeNull();
  });

  it('uses the pseudo-path the other PR-level findings use', () => {
    const finding = taskArtifactFinding(folder([]), OPTED_IN);
    expect(finding?.file).toBe('(task)');
    expect(finding?.rule).toBe('task#artifacts');
  });
});
