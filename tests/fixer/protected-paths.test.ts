import { describe, expect, it, vi } from 'vitest';
import { revertProtectedPaths } from '../../src/fixer/protected-paths.js';
import type { CommandExecutor } from '../../src/shared/exec.js';

describe('revertProtectedPaths', () => {
  it('runs git checkout -- for each configured path', async () => {
    const exec = vi.fn<CommandExecutor>().mockResolvedValue({ stdout: '', stderr: '' });

    await revertProtectedPaths('/repo', ['.github/workflows/', '.github/pipeline.config.yml'], exec);

    expect(exec).toHaveBeenNthCalledWith(1, 'git checkout -- ".github/workflows/"', { cwd: '/repo' });
    expect(exec).toHaveBeenNthCalledWith(2, 'git checkout -- ".github/pipeline.config.yml"', { cwd: '/repo' });
  });

  it('does nothing when there are no protected paths', async () => {
    const exec = vi.fn<CommandExecutor>();

    await revertProtectedPaths('/repo', [], exec);

    expect(exec).not.toHaveBeenCalled();
  });

  it('continues to the next path when one path errors (e.g. not tracked in this repo)', async () => {
    const exec = vi
      .fn<CommandExecutor>()
      .mockRejectedValueOnce(new Error('pathspec did not match any files'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' });

    await revertProtectedPaths('/repo', ['.github/pipeline-rules/', '.github/workflows/'], exec);

    expect(exec).toHaveBeenCalledTimes(2);
  });
});
