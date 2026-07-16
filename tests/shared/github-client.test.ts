import { describe, expect, it } from 'vitest';
import { readPullRequestContext, type ActionsEventContext } from '../../src/shared/github-client.js';

describe('readPullRequestContext', () => {
  it('extracts owner/repo/number/title/headRef from a pull_request event', () => {
    const context: ActionsEventContext = {
      repo: { owner: '0xb1te', repo: 'ql-pipeline' },
      payload: {
        pull_request: {
          number: 42,
          title: 'feat(frontend): add dark-mode toggle',
          head: { ref: 'task/007-dark-mode' },
        },
      },
    };

    expect(readPullRequestContext(context)).toEqual({
      owner: '0xb1te',
      repo: 'ql-pipeline',
      number: 42,
      title: 'feat(frontend): add dark-mode toggle',
      headRef: 'task/007-dark-mode',
    });
  });

  it('throws when the event has no pull_request (wrong trigger)', () => {
    const context: ActionsEventContext = {
      repo: { owner: '0xb1te', repo: 'ql-pipeline' },
      payload: {},
    };

    expect(() => readPullRequestContext(context)).toThrow(/pull_request event/);
  });
});
