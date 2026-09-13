import { describe, expect, it, vi } from 'vitest';
import { readGateReports, shouldSkipCursorFixer } from '../../src/cli/govern-command.js';
import { serializeGateReport } from '../../src/shared/gate-report.js';

function reader(files: Record<string, string>): {
  exists: (p: string) => boolean;
  list: (p: string) => string[];
  read: (p: string) => string;
} {
  return {
    exists: vi.fn(() => true),
    list: vi.fn(() => Object.keys(files)),
    read: vi.fn((path: string) => {
      const name = path.split(/[\\/]/).pop()!;
      const content = files[name];
      if (content === undefined) {
        throw new Error(`no such file: ${path}`);
      }
      return content;
    }),
  };
}

const TEST_REPORT = serializeGateReport({
  stage: 'test',
  outcomes: [{ area: 'backend', gate: 'test', command: 'npm test', passed: true, output: '' }],
});
const BUILD_REPORT = serializeGateReport({
  stage: 'build',
  outcomes: [{ area: 'backend', gate: 'build', command: 'npm run build', passed: false, output: 'tsc error' }],
});

describe('shouldSkipCursorFixer', () => {
  it('lets the Cursor fixer run when the review provider is cursor', () => {
    expect(shouldSkipCursorFixer('cursor')).toBe(false);
  });

  it('escalates a FIX after an openai_compatible review instead of pretending HTTP can write a fix', () => {
    expect(shouldSkipCursorFixer('openai_compatible')).toBe(true);
  });
});

describe('readGateReports', () => {
  it('reads and merges every stage report, test before build', () => {
    const result = readGateReports('/reports', reader({ 'test.json': TEST_REPORT, 'build.json': BUILD_REPORT }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcomes.map((outcome) => outcome.gate)).toEqual(['test', 'build']);
    }
  });

  it('treats a missing reports directory as "no stage reported"', () => {
    const missing = { exists: vi.fn(() => false), list: vi.fn(() => []), read: vi.fn(() => '') };

    expect(readGateReports('/reports', missing)).toEqual({ ok: true, outcomes: [] });
  });

  it('handles a skipped stage: one report present, the other absent', () => {
    const result = readGateReports('/reports', reader({ 'test.json': TEST_REPORT }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      // A skipped build reports nothing, which is not the same as passing —
      // no build finding is invented either way.
      expect(result.outcomes).toHaveLength(1);
      expect(result.outcomes[0]?.gate).toBe('test');
    }
  });

  it('ignores non-JSON files in the artifact directory', () => {
    const result = readGateReports('/reports', reader({ 'test.json': TEST_REPORT, 'README.txt': 'ignore me' }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcomes).toHaveLength(1);
    }
  });

  it('fails closed on a corrupt report rather than assuming the gates passed', () => {
    const result = readGateReports('/reports', reader({ 'test.json': '{corrupt' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('test.json');
    }
  });
});
