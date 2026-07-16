import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseConfig } from '../../src/shared/config.js';

const VALID_YAML = `
gates:
  frontend:
    build: "npm ci && npm run build"
    test: "npm test"
merge:
  target_branch: main
  method: squash
  delete_branch: false
  required_checks: [build, test]
fixer:
  max_fix_attempts: 5
  protected_paths: [rules/, prompts/]
`;

describe('parseConfig', () => {
  it('parses a fully specified config', () => {
    const config = parseConfig(VALID_YAML);

    expect(config).toEqual({
      gates: {
        frontend: { build: 'npm ci && npm run build', test: 'npm test' },
      },
      merge: {
        targetBranch: 'main',
        method: 'squash',
        deleteBranch: false,
        requiredChecks: ['build', 'test'],
      },
      fixer: {
        maxFixAttempts: 5,
        protectedPaths: ['rules/', 'prompts/'],
      },
    });
  });

  it('applies defaults for every optional field', () => {
    const config = parseConfig('merge:\n  target_branch: main\n');

    expect(config.gates).toEqual({});
    expect(config.merge).toEqual({
      targetBranch: 'main',
      method: 'merge',
      deleteBranch: true,
      requiredChecks: ['build', 'test', 'ai-review'],
    });
    expect(config.fixer).toEqual({
      maxFixAttempts: 3,
      protectedPaths: ['rules/', 'prompts/', 'pipeline.config.yml', '.github/workflows/'],
    });
  });

  it('rejects a non-mapping top level', () => {
    expect(() => parseConfig('- just\n- a\n- list')).toThrow(ConfigError);
  });

  it('rejects malformed YAML', () => {
    expect(() => parseConfig('merge: [unterminated')).toThrow(ConfigError);
  });

  it('allows a gate to configure only build, or only test', () => {
    const config = parseConfig(
      'gates:\n  frontend:\n    build: "npm run build"\n  backend:\n    test: "npm test"\nmerge:\n  target_branch: main\n',
    );

    expect(config.gates['frontend']).toEqual({ build: 'npm run build' });
    expect(config.gates['backend']).toEqual({ test: 'npm test' });
  });

  it('rejects an unrecognized area under gates', () => {
    expect(() =>
      parseConfig('gates:\n  desktop:\n    build: "make"\nmerge:\n  target_branch: main\n'),
    ).toThrow(/not a recognized area/);
  });

  it('rejects a non-string gate command', () => {
    expect(() =>
      parseConfig('gates:\n  frontend:\n    build: 123\nmerge:\n  target_branch: main\n'),
    ).toThrow(ConfigError);
  });

  it('requires a merge section', () => {
    expect(() => parseConfig('gates: {}')).toThrow(/"merge" must be a mapping/);
  });

  it('requires a non-empty target_branch', () => {
    expect(() => parseConfig('merge:\n  target_branch: ""')).toThrow(/non-empty string/);
  });

  it('rejects an unknown merge method', () => {
    expect(() => parseConfig('merge:\n  target_branch: main\n  method: cherry-pick')).toThrow(/must be one of/);
  });

  it('rejects a non-boolean delete_branch', () => {
    expect(() => parseConfig('merge:\n  target_branch: main\n  delete_branch: "yes"')).toThrow(ConfigError);
  });

  it('rejects a non-array required_checks', () => {
    expect(() => parseConfig('merge:\n  target_branch: main\n  required_checks: build')).toThrow(ConfigError);
  });

  it('defaults protected_paths when the fixer section is present but omits it', () => {
    const config = parseConfig('merge:\n  target_branch: main\nfixer:\n  max_fix_attempts: 5\n');

    expect(config.fixer).toEqual({
      maxFixAttempts: 5,
      protectedPaths: ['rules/', 'prompts/', 'pipeline.config.yml', '.github/workflows/'],
    });
  });

  it('rejects a non-numeric max_fix_attempts', () => {
    expect(() => parseConfig('merge:\n  target_branch: main\nfixer:\n  max_fix_attempts: "three"')).toThrow(
      /must be a number/,
    );
  });

  it('rejects a non-integer max_fix_attempts', () => {
    expect(() => parseConfig('merge:\n  target_branch: main\nfixer:\n  max_fix_attempts: 2.5')).toThrow(
      /positive integer/,
    );
  });

  it('rejects a zero or negative max_fix_attempts', () => {
    expect(() => parseConfig('merge:\n  target_branch: main\nfixer:\n  max_fix_attempts: 0')).toThrow(
      /positive integer/,
    );
  });

  it('rejects a non-array protected_paths', () => {
    expect(() => parseConfig('merge:\n  target_branch: main\nfixer:\n  protected_paths: rules/')).toThrow(
      ConfigError,
    );
  });
});

describe('loadConfig', () => {
  it('reads and parses a config file from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ql-pipeline-config-test-'));
    const path = join(dir, 'pipeline.config.yml');
    writeFileSync(path, 'merge:\n  target_branch: main\n', 'utf-8');

    try {
      const config = loadConfig(path);
      expect(config.merge.targetBranch).toBe('main');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws a ConfigError when the file does not exist', () => {
    expect(() => loadConfig(join(tmpdir(), 'definitely-not-a-real-file-12345.yml'))).toThrow(ConfigError);
  });
});
