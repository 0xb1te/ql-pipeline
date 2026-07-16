import { describe, expect, it, vi } from 'vitest';
import { isWorkingTreeClean } from '../../src/reviewer/cursor-runner.js';
import type { CommandExecutor } from '../../src/shared/exec.js';

describe('isWorkingTreeClean', () => {
  it('is true when git status --porcelain reports nothing', async () => {
    const exec = vi.fn<CommandExecutor>().mockResolvedValue({ stdout: '', stderr: '' });

    expect(await isWorkingTreeClean('/repo', exec)).toBe(true);
    expect(exec).toHaveBeenCalledWith('git status --porcelain', { cwd: '/repo' });
  });

  it('is true when git status --porcelain reports only whitespace', async () => {
    const exec = vi.fn<CommandExecutor>().mockResolvedValue({ stdout: '\n  \n', stderr: '' });

    expect(await isWorkingTreeClean('/repo', exec)).toBe(true);
  });

  it('is false when git status --porcelain reports changes', async () => {
    const exec = vi.fn<CommandExecutor>().mockResolvedValue({ stdout: ' M src/foo.ts\n', stderr: '' });

    expect(await isWorkingTreeClean('/repo', exec)).toBe(false);
  });

  it('is false (fails closed) when the check itself throws', async () => {
    const exec = vi.fn<CommandExecutor>().mockRejectedValue(new Error('git not found'));

    expect(await isWorkingTreeClean('/repo', exec)).toBe(false);
  });
});
