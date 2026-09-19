import { describe, expect, it } from 'vitest';
import { replyForFinding } from '../../src/reviewer/finding-reply.js';

const ATTEMPT = { attemptNumber: 1, maxFixAttempts: 3 };

describe('replyForFinding', () => {
  it('names the commit, and refuses to claim the finding is resolved', () => {
    // The fixer works from every finding at once and reports one commit, not a mapping from
    // finding to edit. Saying "fixed" in a specific thread would be a guess dressed as a fact.
    const text = replyForFinding({
      ...ATTEMPT,
      outcome: { kind: 'committed', commitMessage: 'fix(backend): resolve pipeline complaint', files: ['a.ts'] },
    });

    expect(text).toContain('Attempt 1 of 3');
    expect(text).toContain('fix(backend): resolve pipeline complaint');
    expect(text).toContain('a.ts');
    expect(text).toContain('for the next review to say');
    expect(text.toLowerCase()).not.toContain('resolved');
  });

  it('says the finding stands when the agent changed nothing', () => {
    const text = replyForFinding({ ...ATTEMPT, outcome: { kind: 'no-changes' } });

    expect(text).toContain('no usable change');
    expect(text).toContain('stands');
    // The operator's way out is the same channel they are already reading.
    expect(text).toContain('comment on this PR');
  });

  it('gives the reason when no fix was attempted at all', () => {
    const text = replyForFinding({
      ...ATTEMPT,
      outcome: { kind: 'not-attempted', why: 'this PR comes from a fork, whose branch this token cannot push to.' },
    });

    expect(text).toContain('No fix was attempted');
    expect(text).toContain('fork');
    expect(text).toContain('needs a person');
  });

  it('carries the attempt number, so a thread shows how much budget is left', () => {
    const text = replyForFinding({
      attemptNumber: 3,
      maxFixAttempts: 3,
      outcome: { kind: 'committed', commitMessage: 'fix: x', files: [] },
    });

    expect(text).toContain('Attempt 3 of 3');
  });

  it('omits the file list rather than printing an empty one', () => {
    const text = replyForFinding({
      ...ATTEMPT,
      outcome: { kind: 'committed', commitMessage: 'fix: x', files: [] },
    });

    expect(text).not.toContain('Files touched');
  });
});
