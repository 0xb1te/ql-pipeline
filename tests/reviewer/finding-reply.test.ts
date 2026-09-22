import { describe, expect, it } from 'vitest';
import { pickedUpReply, replyForFinding } from '../../src/reviewer/finding-reply.js';

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

describe('pickedUpReply', () => {
  it('names the run, so a reader has something they can look up or cancel', () => {
    const body = pickedUpReply({ runId: 'run-7', attemptNumber: 1, maxFixAttempts: 3 });

    expect(body).toContain('run-7');
    expect(body).toContain('attempt 1 of 3');
  });

  it('says the agent has every finding, not just this thread', () => {
    // The agent is given the whole complaint at once, so a thread claiming sole ownership of
    // the run would be the same overstatement replyForFinding already refuses to make.
    expect(pickedUpReply({ runId: 'run-7', attemptNumber: 2, maxFixAttempts: 3 })).toMatch(
      /every finding in this review/i,
    );
  });

  it('promises the second reply that replyForFinding posts', () => {
    expect(pickedUpReply({ runId: 'run-7', attemptNumber: 1, maxFixAttempts: 3 })).toMatch(/second reply/i);
  });

  it('never claims the finding is fixed', () => {
    const body = pickedUpReply({ runId: 'run-7', attemptNumber: 1, maxFixAttempts: 3 });

    expect(body).not.toMatch(/fixed|resolved/i);
  });
});
