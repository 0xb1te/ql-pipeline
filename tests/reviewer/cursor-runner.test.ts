import { describe, expect, it } from 'vitest';
import { cursorAgentArgs } from '../../src/reviewer/cursor-runner.js';

describe('cursorAgentArgs', () => {
  it('omits --model when none is configured, so the CLI keeps its own default', () => {
    expect(cursorAgentArgs({ cwd: '/repo', mode: 'ask' })).toEqual([
      '--print',
      '--output-format',
      'json',
      '--trust',
      '--workspace',
      '/repo',
      '--mode',
      'ask',
    ]);
  });

  it('passes --model when a slug is set', () => {
    expect(
      cursorAgentArgs({
        cwd: '/repo',
        mode: 'agent',
        model: 'cursor-grok-4.6-xhigh-fast',
      }),
    ).toEqual([
      '--print',
      '--output-format',
      'json',
      '--trust',
      '--workspace',
      '/repo',
      '--model',
      'cursor-grok-4.6-xhigh-fast',
      '--force',
    ]);
  });

  it('never puts the prompt in argv', () => {
    // Regression guard. A single ql-docs review pack is ~132KB, over Linux's
    // MAX_ARG_STRLEN of 131072 for one argument, so a prompt in argv made
    // every frontend PR die with `spawn E2BIG` before the review started.
    // It goes on stdin instead; nothing here may carry it again.
    const args = cursorAgentArgs({ cwd: '/repo', mode: 'ask', model: 'm' });

    expect(args.join(' ').length).toBeLessThan(200);
    for (const arg of args) {
      expect(arg.length).toBeLessThan(100);
    }
  });
});
