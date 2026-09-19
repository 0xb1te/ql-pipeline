import { describe, expect, it } from 'vitest';

import {
  MAX_LISTED_SECTIONS,
  describeDroppedSections,
  truncateAtSection,
} from '../../src/standards/standards-resolver.js';
import { MAX_PROMPT_BYTES, buildReviewPrompt, type ReviewContext } from '../../src/reviewer/reviewer.js';

/** `n` sections, each big enough that a handful blows any realistic budget. */
function sections(n: number, from = 1): string {
  return Array.from({ length: n }, (_, i) => `## ${String(from + i).padStart(2, '0')} — Section ${from + i}\n${'x'.repeat(500)}`).join(
    '\n',
  );
}

describe('truncateAtSection reports what it dropped', () => {
  it('names nothing when the document fits', () => {
    expect(truncateAtSection('## 01 — Only\nbody', 10_000)).toEqual({
      text: '## 01 — Only\nbody',
      truncated: false,
      droppedSections: [],
      droppedChars: 0,
    });
  });

  it('names every section it removed, in document order', () => {
    const text = '## 01 — First\nalpha\n## 02 — Second\nbeta\n## 03 — Third\ngamma';

    const result = truncateAtSection(text, text.indexOf('## 02') + 5);

    expect(result.truncated).toBe(true);
    expect(result.droppedSections).toEqual(['02 — Second', '03 — Third']);
    expect(result.text).toContain('## 01 — First');
    expect(result.text).not.toContain('beta');
  });

  it('counts the characters it removed', () => {
    const text = '## 01 — First\nalpha\n## 02 — Second\nbeta';

    const result = truncateAtSection(text, text.indexOf('## 02') + 5);

    // Everything from the `\n` before `## 02` onwards.
    expect(result.droppedChars).toBe(text.length - text.indexOf('\n## 02'));
  });

  it('says so plainly when there are no headings to name', () => {
    // A document can overflow without a single `## ` in it. Reporting
    // "0 sections" would read as "nothing was lost".
    const result = truncateAtSection('a'.repeat(100), 10);

    expect(result.truncated).toBe(true);
    expect(result.droppedSections).toEqual([]);
    expect(result.droppedChars).toBe(90);
    expect(result.text).toContain('no section headings to name');
  });

  it('names the dropped sections inside the marker the reviewer reads', () => {
    const text = '## 01 — First\nalpha\n## 02 — Danger Zone\nbeta';

    const result = truncateAtSection(text, text.indexOf('## 02') + 5);

    expect(result.text).toContain('02 — Danger Zone');
    expect(result.text).toContain('Do not treat an absent section as permission');
  });
});

describe('describeDroppedSections', () => {
  it('lists a short set in full', () => {
    expect(describeDroppedSections(['01 — A', '02 — B'], 40)).toBe('dropped 40 chars, 2 sections: 01 — A, 02 — B');
  });

  it('uses the singular for one section', () => {
    expect(describeDroppedSections(['01 — A'], 5)).toContain('1 section:');
  });

  it('elides past the listing threshold rather than printing thirty titles', () => {
    const many = Array.from({ length: MAX_LISTED_SECTIONS + 4 }, (_, i) => `S${i}`);

    const described = describeDroppedSections(many, 900);

    expect(described).toContain('S0');
    expect(described).toContain(`(+4 more)`);
    expect(described).not.toContain(`S${MAX_LISTED_SECTIONS + 1}`);
  });

  it('reports the size when there are no titles', () => {
    expect(describeDroppedSections([], 120)).toBe('dropped 120 chars (no section headings to name)');
  });
});

const TEMPLATE = '{{AREAS}} {{RULES}} {{STANDARDS}} {{GATE_RESULTS}} {{PR_DESCRIPTION}} {{DIFF}}';

function context(standardsText: string, diff = 'diff body'): ReviewContext {
  return {
    areas: ['frontend'],
    ruleFiles: ['frontend.rules'],
    rulesText: 'rules body',
    standardsText,
    gateOutcomes: [],
    prDescription: 'description',
    humanDirection: '',
    diff,
  };
}

describe('buildReviewPrompt reports the prompt-ceiling cut', () => {
  it('reports no truncation when everything fits', () => {
    const { standardsTruncation } = buildReviewPrompt(TEMPLATE, context('## 01 — Small\nbody'));

    expect(standardsTruncation).toEqual({
      truncated: false,
      standardsOmitted: false,
      droppedSections: [],
      droppedChars: 0,
    });
  });

  it('names the sections the ceiling cut — this layer used to be silent', () => {
    const { prompt, standardsTruncation } = buildReviewPrompt(TEMPLATE, context(sections(400)));

    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(MAX_PROMPT_BYTES);
    expect(standardsTruncation.truncated).toBe(true);
    expect(standardsTruncation.standardsOmitted).toBe(false);
    expect(standardsTruncation.droppedSections.length).toBeGreaterThan(0);
    expect(standardsTruncation.droppedChars).toBeGreaterThan(0);
    // The reviewer is told which rules it is missing, not merely that some exist.
    expect(prompt).toContain('truncated to fit the prompt size limit');
    expect(prompt).toContain(standardsTruncation.droppedSections[0] ?? '');
  });

  it('reports the standards as omitted entirely when the diff fills the budget', () => {
    const hugeDiff = 'd'.repeat(MAX_PROMPT_BYTES + 1_000);

    const { standardsTruncation } = buildReviewPrompt(TEMPLATE, context(sections(3), hugeDiff));

    expect(standardsTruncation.standardsOmitted).toBe(true);
    expect(standardsTruncation.truncated).toBe(true);
    // Even here it names what was lost, rather than reporting an empty set.
    expect(standardsTruncation.droppedSections.length).toBe(3);
  });

  it('holds the byte ceiling even when the dropped list makes the note long', () => {
    // The note carries the dropped titles now, so its length varies with the
    // cut. Long titles maximise it. This pins the ceiling as a property -
    // it does not isolate the probe-vs-emitted note gap, which the elision
    // at MAX_LISTED_SECTIONS bounds to a few bytes.
    const longTitles = Array.from(
      { length: 300 },
      (_, i) => `## ${i} - ${'T'.repeat(120)}\n${'x'.repeat(500)}`,
    ).join('\n');

    const { prompt, standardsTruncation } = buildReviewPrompt(TEMPLATE, context(longTitles));

    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(MAX_PROMPT_BYTES);
    expect(standardsTruncation.droppedSections.length).toBeGreaterThan(0);
  });

  it('never trims the diff to make room for standards', () => {
    const { prompt } = buildReviewPrompt(TEMPLATE, context(sections(400), 'UNIQUE_DIFF_MARKER'));

    expect(prompt).toContain('UNIQUE_DIFF_MARKER');
    expect(prompt).toContain('rules body');
  });
});
