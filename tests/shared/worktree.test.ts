import { describe, expect, it, vi } from 'vitest';
import {
  captureWorktreeState,
  changedPaths,
  parsePorcelain,
  worktreeChanged,
} from '../../src/shared/worktree.js';
import type { CommandExecutor } from '../../src/shared/exec.js';

describe('parsePorcelain', () => {
  it('parses an empty output as an empty state', () => {
    expect(parsePorcelain('')).toEqual(new Map());
  });

  it('ignores blank lines', () => {
    expect(parsePorcelain('\n\n')).toEqual(new Map());
  });

  it('records the status code against each path', () => {
    const state = parsePorcelain(' M src/index.ts\n?? new-file.ts\n');

    expect(state.get('src/index.ts')).toBe(' M');
    expect(state.get('new-file.ts')).toBe('??');
  });

  it('records a rename under its destination path', () => {
    const state = parsePorcelain('R  old-name.ts -> new-name.ts\n');

    expect(state.has('new-name.ts')).toBe(true);
    expect(state.has('old-name.ts')).toBe(false);
  });

  it('strips the quotes git adds around paths with spaces', () => {
    const state = parsePorcelain('?? "src/a file.ts"\n');

    expect(state.has('src/a file.ts')).toBe(true);
  });

  it('keeps a path containing " -> " intact when it is not a rename entry', () => {
    const state = parsePorcelain('?? plain/path.ts\n');

    expect(state.has('plain/path.ts')).toBe(true);
  });
});

describe('changedPaths', () => {
  it('is empty when both snapshots match', () => {
    const state = parsePorcelain('?? dist/\n');

    expect(changedPaths(state, state)).toEqual([]);
  });

  it('reports a path that appeared', () => {
    const before = parsePorcelain('?? dist/\n');
    const after = parsePorcelain('?? dist/\n M src/fixed.ts\n');

    expect(changedPaths(before, after)).toEqual(['src/fixed.ts']);
  });

  it('reports a path whose status changed even though it was already dirty', () => {
    const before = parsePorcelain('?? src/thing.ts\n');
    const after = parsePorcelain('A  src/thing.ts\n');

    expect(changedPaths(before, after)).toEqual(['src/thing.ts']);
  });

  it('excludes pre-existing build artifacts, which is the whole point of the baseline', () => {
    const before = parsePorcelain('?? node_modules/\n?? dist/\n');
    const after = parsePorcelain('?? node_modules/\n?? dist/\n M src/api/payments.ts\n');

    expect(changedPaths(before, after)).toEqual(['src/api/payments.ts']);
  });

  it('does not report a path that disappeared (a revert is not something to stage)', () => {
    const before = parsePorcelain(' M rules/backend.rules\n');
    const after = parsePorcelain('');

    expect(changedPaths(before, after)).toEqual([]);
  });

  it('returns multiple changed paths in sorted order', () => {
    const before = parsePorcelain('');
    const after = parsePorcelain(' M z.ts\n M a.ts\n');

    expect(changedPaths(before, after)).toEqual(['a.ts', 'z.ts']);
  });
});

describe('worktreeChanged', () => {
  it('is false for identical snapshots', () => {
    const state = parsePorcelain('?? dist/\n');

    expect(worktreeChanged(state, state)).toBe(false);
  });

  it('is true when something changed', () => {
    expect(worktreeChanged(parsePorcelain(''), parsePorcelain(' M x.ts\n'))).toBe(true);
  });
});

describe('captureWorktreeState', () => {
  it('runs git status --porcelain in the given directory', async () => {
    const exec = vi.fn<CommandExecutor>().mockResolvedValue({ stdout: ' M x.ts\n', stderr: '' });

    const state = await captureWorktreeState('/repo', exec);

    expect(exec).toHaveBeenCalledWith('git status --porcelain', { cwd: '/repo' });
    expect(state?.get('x.ts')).toBe(' M');
  });

  it('returns null (unknown, never "unchanged") when git fails', async () => {
    const exec = vi.fn<CommandExecutor>().mockRejectedValue(new Error('not a git repository'));

    expect(await captureWorktreeState('/repo', exec)).toBeNull();
  });
});
