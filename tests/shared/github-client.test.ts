import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_MARKER,
  readPullRequestContext,
  stampAutomated,
  type ActionsEventContext,
} from '../../src/shared/github-client.js';

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

/** What `context` looks like for an `issue_comment`, or for the wrong trigger entirely. */
const noPullRequest: ActionsEventContext = {
  repo: { owner: '0xb1te', repo: 'ql-pipeline' },
  payload: {},
};

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

  it('throws when the event has no pull_request and nothing was resolved for it', () => {
    expect(() => readPullRequestContext(noPullRequest, {})).toThrow(/pull_request event/);
  });
});

/**
 * An `issue_comment` is how a person asks for another pass, and GitHub sends
 * it with an `issue` rather than a `pull_request`. The workflow's resolve job
 * looks the PR up once and hands it down through the environment.
 */
describe('readPullRequestContext, on an event that carries no pull request', () => {
  const resolved = {
    QL_PIPELINE_PR_NUMBER: '42',
    QL_PIPELINE_PR_TITLE: 'feat(frontend): add dark-mode toggle',
    QL_PIPELINE_PR_HEAD_REF: 'task/007-dark-mode',
    QL_PIPELINE_PR_HEAD_SHA: 'abc123',
    QL_PIPELINE_PR_BASE_REF: 'main',
    QL_PIPELINE_PR_IS_FORK: 'false',
  };

  it('reads the PR the workflow resolved into the environment', () => {
    expect(readPullRequestContext(noPullRequest, resolved)).toEqual({
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

  it('carries the fork flag through, so a comment on a fork PR still gets review-only treatment', () => {
    const fromFork = { ...resolved, QL_PIPELINE_PR_IS_FORK: 'true' };

    expect(readPullRequestContext(noPullRequest, fromFork).isFork).toBe(true);
  });

  it('names the variable that is missing rather than blaming the trigger', () => {
    const incomplete = { ...resolved, QL_PIPELINE_PR_HEAD_SHA: '' };

    expect(() => readPullRequestContext(noPullRequest, incomplete)).toThrow(/QL_PIPELINE_PR_HEAD_SHA is empty/);
  });

  it('rejects a number that is not one', () => {
    const notANumber = { ...resolved, QL_PIPELINE_PR_NUMBER: 'null' };

    expect(() => readPullRequestContext(noPullRequest, notANumber)).toThrow(/must be a positive integer/);
  });

  it("rejects a fork flag that is neither 'true' nor 'false', rather than guessing", () => {
    const garbled = { ...resolved, QL_PIPELINE_PR_IS_FORK: 'yes' };

    expect(() => readPullRequestContext(noPullRequest, garbled)).toThrow(/must be 'true' or 'false'/);
  });

  it('lets the payload win when the event has a PR of its own', () => {
    const stale = { ...resolved, QL_PIPELINE_PR_NUMBER: '999', QL_PIPELINE_PR_HEAD_SHA: 'stale' };

    expect(readPullRequestContext(context(), stale).number).toBe(42);
    expect(readPullRequestContext(context(), stale).headSha).toBe('abc123');
  });
});

/**
 * Once `GH_TOKEN` is set the workflow acts as that token's owner — a person, and usually the same
 * person who comments on the pull request. Its verdicts then arrive as an ordinary user comment,
 * and no identity check can separate them from direction. What still separates them is the marker.
 */
describe('stampAutomated', () => {
  it('marks a body so a later run can recognise its own voice', () => {
    expect(stampAutomated('Merged into main.')).toContain(AUTOMATION_MARKER);
  });

  it('keeps the original text intact, since a person reads it', () => {
    expect(stampAutomated('Merged into main.')).toContain('Merged into main.');
  });

  it('renders as nothing — the marker is an HTML comment, not visible prose', () => {
    expect(AUTOMATION_MARKER.startsWith('<!--')).toBe(true);
    expect(AUTOMATION_MARKER.endsWith('-->')).toBe(true);
  });

  it('does not stamp twice, so a body that round-trips stays clean', () => {
    const once = stampAutomated('hello');
    const twice = stampAutomated(once);

    expect(twice).toBe(once);
    expect(twice.split(AUTOMATION_MARKER)).toHaveLength(2);
  });

  it('leaves a person’s own words unmarked, which is the whole point', () => {
    // Nothing a human types carries this, so the trigger can decline the pipeline's comments
    // without declining theirs — even when both are written by the same GitHub account.
    expect('please also rename the variable'.includes(AUTOMATION_MARKER)).toBe(false);
  });
});
