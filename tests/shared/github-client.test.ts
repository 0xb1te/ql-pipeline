import { describe, expect, it } from 'vitest';
import { readPullRequestContext, type ActionsEventContext } from '../../src/shared/github-client.js';

function context(overrides: Partial<ActionsEventContext['payload']['pull_request']> = {}): ActionsEventContext {
  return {
    repo: { owner: '0xb1te', repo: 'ql-pipeline' },
    payload: {
      pull_request: {
        number: 42,
        title: 'feat(frontend): add dark-mode toggle',
        head: { ref: 'task/007-dark-mode', sha: 'abc123', repo: { full_name: '0xb1te/ql-pipeline' } },
        base: { ref: 'main', repo: { full_name: '0xb1te/ql-pipeline' } },
        ...overrides,
      },
    },
  };
}

describe('readPullRequestContext', () => {
  it('extracts owner/repo/number/title/headRef/headSha/baseRef from a pull_request event', () => {
    expect(readPullRequestContext(context())).toEqual({
      owner: '0xb1te',
      repo: 'ql-pipeline',
      number: 42,
      title: 'feat(frontend): add dark-mode toggle',
      headRef: 'task/007-dark-mode',
      headSha: 'abc123',
      baseRef: 'main',
      isFork: false,
    });
  });

  it('flags a PR whose head lives in a different repository as a fork', () => {
    const forked = context({
      head: { ref: 'patch-1', sha: 'def456', repo: { full_name: 'someone-else/ql-pipeline' } },
    });

    expect(readPullRequestContext(forked).isFork).toBe(true);
  });

  it('treats a deleted fork (null head repo) as a fork rather than as same-repo', () => {
    const deletedFork = context({ head: { ref: 'patch-1', sha: 'def456', repo: null } });

    expect(readPullRequestContext(deletedFork).isFork).toBe(true);
  });

  it('reports the base branch the PR actually targets, not the configured one', () => {
    const targetingDevelop = context({ base: { ref: 'develop', repo: { full_name: '0xb1te/ql-pipeline' } } });

    expect(readPullRequestContext(targetingDevelop).baseRef).toBe('develop');
  });

  it('throws when the event has no pull_request (wrong trigger)', () => {
    const wrongEvent: ActionsEventContext = {
      repo: { owner: '0xb1te', repo: 'ql-pipeline' },
      payload: {},
    };

    expect(() => readPullRequestContext(wrongEvent)).toThrow(/pull_request event/);
  });
});
