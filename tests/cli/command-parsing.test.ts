import { describe, expect, it } from 'vitest';
import { parseCommand } from '../../src/cli/command.js';

describe('parseCommand', () => {
  it('parses deploy-preview, which takes no flags', () => {
    expect(parseCommand(['deploy-preview'])).toEqual({ ok: true, command: { kind: 'deploy-preview' } });
  });

  it('parses the test gate command', () => {
    expect(parseCommand(['gate', '--stage', 'test'])).toEqual({
      ok: true,
      command: { kind: 'gate', stage: 'test', reportPath: 'gate-reports/test.json' },
    });
  });

  it('parses the build gate command', () => {
    const result = parseCommand(['gate', '--stage', 'build']);

    expect(result.ok).toBe(true);
    if (result.ok && result.command.kind === 'gate') {
      expect(result.command.stage).toBe('build');
    }
  });

  it('honours an explicit report path', () => {
    const result = parseCommand(['gate', '--stage', 'test', '--report', 'out/test.json']);

    expect(result.ok).toBe(true);
    if (result.ok && result.command.kind === 'gate') {
      expect(result.command.reportPath).toBe('out/test.json');
    }
  });

  it('parses the govern command with its default reports directory', () => {
    expect(parseCommand(['govern'])).toEqual({
      ok: true,
      command: { kind: 'govern', reportsDir: 'gate-reports' },
    });
  });

  it('honours an explicit reports directory', () => {
    const result = parseCommand(['govern', '--reports', 'artifacts']);

    expect(result.ok).toBe(true);
    if (result.ok && result.command.kind === 'govern') {
      expect(result.command.reportsDir).toBe('artifacts');
    }
  });

  it('rejects a gate command with no stage', () => {
    const result = parseCommand(['gate']);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/--stage/);
    }
  });

  it('rejects an unknown stage rather than guessing one', () => {
    expect(parseCommand(['gate', '--stage', 'ai-review']).ok).toBe(false);
  });

  it('parses init with the default root', () => {
    expect(parseCommand(['init'])).toEqual({ ok: true, command: { kind: 'init', root: '.' } });
  });

  it('parses upgrade, defaulting to not forcing', () => {
    expect(parseCommand(['upgrade'])).toEqual({ ok: true, command: { kind: 'upgrade', root: '.', force: false } });
  });

  it('parses upgrade --force', () => {
    const result = parseCommand(['upgrade', '--force']);

    expect(result.ok).toBe(true);
    if (result.ok && result.command.kind === 'upgrade') {
      expect(result.command.force).toBe(true);
    }
  });

  it('parses doctor with an explicit root', () => {
    expect(parseCommand(['doctor', '--root', 'packages/api'])).toEqual({
      ok: true,
      command: { kind: 'doctor', root: 'packages/api' },
    });
  });

  it('rejects an unknown subcommand', () => {
    const result = parseCommand(['deploy']);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('deploy');
    }
  });

  it('rejects no arguments at all', () => {
    expect(parseCommand([]).ok).toBe(false);
  });
});
