import { describe, expect, it } from 'vitest';
import {
  MAX_DIRECTION_CHARS,
  formatDirection,
  humanComments,
  type PrComment,
} from '../../src/shared/human-direction.js';

const human = (body: string, extra: Record<string, unknown> = {}): PrComment => ({
  author: '0xb1te',
  isBot: false,
  body,
  ...extra,
});

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
