import { describe, expect, it } from 'vitest';
import {
  MAX_DIRECTION_CHARS,
  formatDirection,
  humanComments,
  type PrComment,
} from '../../src/shared/human-direction.js';
import { AUTOMATION_MARKER } from '../../src/shared/types.js';

const human = (body: string, extra: Record<string, unknown> = {}): PrComment => ({
  author: '0xb1te',
  isBot: false,
  body,
  ...extra,
});

/**
 * What the pipeline's own comment looks like on a repository with `GH_TOKEN` set: written by the
 * operator's account, so GitHub reports `type: 'User'` and `isBot` is false. Stamped, because
 * `stampAutomated` applies the marker inside the client to every body that reaches GitHub.
 */
const pipelineSaid = (body: string, extra: Record<string, unknown> = {}): PrComment =>
  human(`${body}\n\n${AUTOMATION_MARKER}`, extra);

describe('humanComments', () => {
  it('drops what the pipeline said, which is the loop guard', () => {
    // The pipeline posts a summary and a review every run. Feeding those back as "direction"
    // would have it answering its own complaints — and on a comment-triggered workflow it would
    // re-trigger on its own writing and never stop.
    const kept = humanComments([
      { author: 'github-actions[bot]', isBot: true, body: 'Automated review found 3 issues' },
      human('use the existing helper instead'),
      { author: 'ql-pipeline[bot]', isBot: true, body: 'Attempt 1 of 3: pushed abc123' },
    ]);

    expect(kept).toHaveLength(1);
    expect(kept[0]?.body).toBe('use the existing helper instead');
  });

  it('drops what the pipeline said when a human token wrote it', () => {
    // The loop guard above holds only while GitHub calls the author a bot. With `GH_TOKEN` set,
    // the pipeline posts as the operator — `type: 'User'` — so `isBot` is false on its own
    // summary, its complaint body and every thread reply it writes. The marker is the one thing
    // that still separates the two voices, which is why `stampAutomated` puts it on all of them.
    const kept = humanComments([
      pipelineSaid('### ql-pipeline summary\n\nDecision: FIX (attempt 1 of 3)'),
      human('use the existing helper instead'),
      pipelineSaid('Attempt 1 of 3: pushed `fix(backend): resolve pipeline complaint`.'),
    ]);

    expect(kept).toHaveLength(1);
    expect(kept[0]?.body).toBe('use the existing helper instead');
  });

  it('keeps a comment a person wrote from the very same account', () => {
    // The discriminator has to be the marker, not the author. Declining everything `0xb1te`
    // wrote would throw away the operator's direction along with the pipeline's chatter — the
    // exact failure the marker was introduced to avoid.
    const kept = humanComments([
      pipelineSaid('### ql-pipeline summary'),
      human('ignore finding 2, that cast is deliberate'),
    ]);

    expect(kept).toHaveLength(1);
    expect(kept[0]?.body).toBe('ignore finding 2, that cast is deliberate');
  });

  it('drops a stamped line comment too, not just conversation ones', () => {
    // Inline review comments come from a second endpoint and carry `path`/`line`. The complaint
    // review writes its findings there, so they are stamped and must be dropped the same way.
    const kept = humanComments([
      pipelineSaid('[must] review.standards#MUST', { path: 'src/a.ts', line: 42 }),
    ]);

    expect(kept).toEqual([]);
  });

  it('drops empty bodies, which carry no instruction', () => {
    expect(humanComments([human('   '), human('')])).toEqual([]);
  });
});

describe('formatDirection', () => {
  it('returns nothing at all when nobody said anything', () => {
    // A heading with nothing under it invites an agent to invent a reason for the silence.
    expect(formatDirection([])).toBe('');
    expect(formatDirection([{ author: 'bot', isBot: true, body: 'hello' }])).toBe('');
  });

  it('gives the fix agent nothing on a PR only the pipeline has spoken on', () => {
    // End to end, this is the bug: on a `GH_TOKEN` repository every one of these arrives with
    // `isBot: false`, so the block handed to the fix agent was the pipeline's own verdict read
    // back to it as instructions from a person.
    const text = formatDirection([
      pipelineSaid('### ql-pipeline summary\n\nDecision: FIX (attempt 1 of 3)'),
      pipelineSaid('[must] review.standards#MUST', { path: 'src/a.ts', line: 42 }),
      pipelineSaid('Attempt 1 of 3: pushed a fix commit.'),
    ]);

    expect(text).toBe('');
  });

  it('keeps conversation order, so later instructions read as overriding earlier ones', () => {
    const text = formatDirection([human('do it with a map'), human('actually, use a Set')]);

    expect(text.indexOf('map')).toBeLessThan(text.indexOf('Set'));
  });

  it('says where a line comment was made, so the agent can find what it refers to', () => {
    const text = formatDirection([human('this cast is wrong', { path: 'src/a.ts', line: 42 })]);

    expect(text).toContain('@0xb1te on src/a.ts:42');
    expect(text).toContain('this cast is wrong');
  });

  it('drops the oldest when there is more than fits, keeping the most recent word', () => {
    const many = Array.from({ length: 40 }, (_, i) => human(`${String(i)} ${'x'.repeat(400)}`));

    const text = formatDirection(many);

    expect(text.length).toBeLessThanOrEqual(MAX_DIRECTION_CHARS);
    expect(text).toContain('earlier comments omitted');
    // The newest comment is the one a person expects to be followed.
    expect(text).toContain('39 ');
  });
});
