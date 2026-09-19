import { describe, expect, it } from 'vitest';
import { threadsToResolve, type ReviewThread } from '../../src/reviewer/settled-threads.js';

function thread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return { id: 'PRRT_1', isResolved: false, openedByPipeline: true, ...overrides };
}

describe('threadsToResolve', () => {
  it('closes the pipeline’s own open threads when the review has nothing left to say', () => {
    // The only evidence that actually exists for "that is dealt with": every complaint was
    // re-examined against the current code and none survived.
    const threads = [thread({ id: 'a' }), thread({ id: 'b' })];

    expect(threadsToResolve({ threads, findingsRaised: 0 })).toEqual(['a', 'b']);
  });

  it('closes nothing while the review is still raising findings', () => {
    // A run that just pushed a fix cannot say which complaints it settled — only that it tried.
    // Resolving here would mark threads settled on a guess.
    const threads = [thread({ id: 'a' })];

    expect(threadsToResolve({ threads, findingsRaised: 1 })).toEqual([]);
    expect(threadsToResolve({ threads, findingsRaised: 7 })).toEqual([]);
  });

  it('never touches a person’s thread — they opened it, it is theirs to close', () => {
    const threads = [thread({ id: 'mine' }), thread({ id: 'theirs', openedByPipeline: false })];

    expect(threadsToResolve({ threads, findingsRaised: 0 })).toEqual(['mine']);
  });

  it('skips threads that are already resolved rather than resolving them twice', () => {
    const threads = [thread({ id: 'open' }), thread({ id: 'done', isResolved: true })];

    expect(threadsToResolve({ threads, findingsRaised: 0 })).toEqual(['open']);
  });

  it('answers empty for a pull request with no threads at all', () => {
    expect(threadsToResolve({ threads: [], findingsRaised: 0 })).toEqual([]);
  });

  it('resolves all of the pipeline’s threads or none, never a guessed subset', () => {
    // Matching a new review's findings back to an older review's threads would mean comparing on
    // path, line and wording — and a line number moves the moment anybody edits the file above
    // it. A wrong match closes a live complaint, which is worse than leaving a settled one open.
    const threads = [thread({ id: 'a' }), thread({ id: 'b' }), thread({ id: 'c' })];

    expect(threadsToResolve({ threads, findingsRaised: 0 })).toHaveLength(3);
    expect(threadsToResolve({ threads, findingsRaised: 1 })).toHaveLength(0);
  });
});
