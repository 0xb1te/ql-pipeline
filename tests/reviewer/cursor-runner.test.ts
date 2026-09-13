import { describe, expect, it } from 'vitest';
import { cursorAgentArgs } from '../../src/reviewer/cursor-runner.js';

describe('cursorAgentArgs', () => {
  it('omits --model when none is configured, so the CLI keeps its own default', () => {
    expect(cursorAgentArgs('review this', { cwd: '/repo', mode: 'ask' })).toEqual([
      '--print',
      '--output-format',
      'json',
      '--trust',
      '--workspace',
      '/repo',
      '--mode',
      'ask',
      'review this',
    ]);
  });

  it('passes --model before the prompt when a slug is set', () => {
    expect(
      cursorAgentArgs('fix this', {
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
      'fix this',
    ]);
  });
});
