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
        targetBranchByArea: {},
        method: 'squash',
        deleteBranch: false,
        requiredChecks: ['build', 'test'],
        requireHumanApproval: false,
      },
      fixer: {
        maxFixAttempts: 5,
        protectedPaths: ['rules/', 'prompts/'],
      },
      agent: { provider: 'cursor', model: null, baseUrl: null, review: { model: null }, fix: { model: null } },
      areas: { paths: { frontend: ['apps/*frontend*/**'], backend: ['apps/*backend*/**'] } },
      standards: {
        enabled: true,
        root: '.standards',
        docs: {
          frontend: ['workflow/rules/stage-2-mockup/checklist.md', 'workflow/rules/stage-5-frontend/checklist.md'],
          backend: [
            'workflow/rules/stage-4-backend/backend/checklist.md',
            'workflow/rules/stage-4-backend/sql/checklist.md',
            'workflow/rules/stage-6-tests/backend/checklist.md',
          ],
          mobile: ['workflow/rules/stage-5-frontend/checklist.md'],
          ios: ['workflow/rules/stage-5-frontend/checklist.md'],
          android: ['workflow/rules/stage-5-frontend/checklist.md'],
          infrastructure: ['workflow/rules/stage-8-deployment/checklist.md'],
        },
        maxCharsPerArea: 140_000,
      },
    });
  });

  it('applies defaults for every optional field', () => {
    const config = parseConfig('merge:\n  target_branch: main\n');

    expect(config.gates).toEqual({});
    expect(config.merge).toEqual({
      targetBranch: 'main',
      targetBranchByArea: {},
      method: 'merge',
      deleteBranch: true,
      requiredChecks: ['build', 'test', 'ai-review'],
      requireHumanApproval: false,
    });
    expect(config.fixer).toEqual({
      maxFixAttempts: 3,
      protectedPaths: ['.github/workflows/', '.github/pipeline.config.yml', '.github/pipeline-rules/'],
    });
    expect(config.agent).toEqual({
      provider: 'cursor',
      model: null,
      baseUrl: null,
      review: { model: null },
      fix: { model: null },
    });
  });

  it('parses agent.model when set on the cursor provider', () => {
    const config = parseConfig(
      'merge:\n  target_branch: main\nagent:\n  model: cursor-grok-4.6-xhigh-fast\n',
    );

    expect(config.agent).toEqual({
      provider: 'cursor',
      model: 'cursor-grok-4.6-xhigh-fast',
      baseUrl: null,
      review: { model: 'cursor-grok-4.6-xhigh-fast' },
      fix: { model: 'cursor-grok-4.6-xhigh-fast' },
    });
  });

  it('lets each phase override agent.model with its own', () => {
    const config = parseConfig(
      'merge:\n  target_branch: main\nagent:\n  model: strong\n  fix:\n    model: cheap\n',
    );

    expect(config.agent.review).toEqual({ model: 'strong' });
    expect(config.agent.fix).toEqual({ model: 'cheap' });
  });

  it('allows per-phase models with no agent.model fallback at all', () => {
    const config = parseConfig(
      'merge:\n  target_branch: main\nagent:\n  review:\n    model: reviewer\n  fix:\n    model: fixer\n',
    );

    expect(config.agent.model).toBeNull();
    expect(config.agent.review).toEqual({ model: 'reviewer' });
    expect(config.agent.fix).toEqual({ model: 'fixer' });
  });

  it('rejects an empty per-phase model', () => {
    expect(() =>
      parseConfig('merge:\n  target_branch: main\nagent:\n  review:\n    model: ""\n'),
    ).toThrow(/agent.review.model/);
  });

  it('parses an openai_compatible agent', () => {
    const config = parseConfig(
      'merge:\n  target_branch: main\nagent:\n  provider: openai_compatible\n  model: gpt-4.1\n  base_url: https://api.openai.com/v1\n',
    );

    expect(config.agent).toEqual({
      provider: 'openai_compatible',
      model: 'gpt-4.1',
      baseUrl: 'https://api.openai.com/v1',
      review: { model: 'gpt-4.1' },
      fix: { model: 'gpt-4.1' },
    });
  });

  it('accepts agent.review.model as the openai_compatible review model', () => {
    const config = parseConfig(
      'merge:\n  target_branch: main\nagent:\n  provider: openai_compatible\n  review:\n    model: gpt-4.1\n  base_url: https://api.openai.com/v1\n',
    );

    expect(config.agent.review).toEqual({ model: 'gpt-4.1' });
  });

  it('rejects openai_compatible without model or base_url', () => {
    expect(() =>
      parseConfig('merge:\n  target_branch: main\nagent:\n  provider: openai_compatible\n  model: gpt-4.1\n'),
    ).toThrow(/agent.base_url/);
    expect(() =>
      parseConfig(
        'merge:\n  target_branch: main\nagent:\n  provider: openai_compatible\n  base_url: https://api.openai.com/v1\n',
      ),
    ).toThrow(/agent.model/);
  });

  it('rejects base_url on the cursor provider', () => {
    expect(() =>
      parseConfig(
        'merge:\n  target_branch: main\nagent:\n  base_url: https://api.openai.com/v1\n',
      ),
    ).toThrow(/only valid when agent.provider is openai_compatible/);
  });

  it('rejects an unknown agent.provider', () => {
    expect(() =>
      parseConfig('merge:\n  target_branch: main\nagent:\n  provider: anthropic\n'),
    ).toThrow(/agent.provider/);
  });

  it('rejects a non-http agent.base_url', () => {
    expect(() =>
      parseConfig(
        'merge:\n  target_branch: main\nagent:\n  provider: openai_compatible\n  model: gpt-4.1\n  base_url: ftp://llm.example.com/v1\n',
      ),
    ).toThrow(/http or https/);
  });

  it('strips trailing slashes from agent.base_url', () => {
    const config = parseConfig(
      'merge:\n  target_branch: main\nagent:\n  provider: openai_compatible\n  model: gpt-4.1\n  base_url: https://api.openai.com/v1/\n',
    );

    expect(config.agent.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('rejects an empty agent.model', () => {
    expect(() => parseConfig('merge:\n  target_branch: main\nagent:\n  model: ""\n')).toThrow(/non-empty string/);
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

  it('parses per-area target branch overrides', () => {
    const config = parseConfig(
      'merge:\n  target_branch: main\n  target_branch_by_area:\n    mobile: release/mobile\n    ios: release/mobile\n',
    );

    expect(config.merge.targetBranchByArea).toEqual({ mobile: 'release/mobile', ios: 'release/mobile' });
  });

  it('rejects an unrecognized area under target_branch_by_area', () => {
    expect(() =>
      parseConfig('merge:\n  target_branch: main\n  target_branch_by_area:\n    desktop: release/desktop\n'),
    ).toThrow(/not a recognized area/);
  });

  it('rejects a non-mapping target_branch_by_area', () => {
    expect(() => parseConfig('merge:\n  target_branch: main\n  target_branch_by_area: release/mobile\n')).toThrow(
      /must be a mapping/,
    );
  });

  it('rejects an empty branch name in target_branch_by_area', () => {
    expect(() => parseConfig('merge:\n  target_branch: main\n  target_branch_by_area:\n    mobile: ""\n')).toThrow(
      /non-empty string/,
    );
  });

  it('rejects a required_checks entry that is not a known pipeline stage', () => {
    expect(() => parseConfig('merge:\n  target_branch: main\n  required_checks: [build, lint]\n')).toThrow(
      /must be one of build, test, ai-review/,
    );
  });

  it('accepts an empty required_checks list, meaning nothing is enforced', () => {
    expect(parseConfig('merge:\n  target_branch: main\n  required_checks: []\n').merge.requiredChecks).toEqual([]);
  });

  it('rejects a non-array required_checks', () => {
    expect(() => parseConfig('merge:\n  target_branch: main\n  required_checks: build')).toThrow(ConfigError);
  });

  it('defaults protected_paths when the fixer section is present but omits it', () => {
    const config = parseConfig('merge:\n  target_branch: main\nfixer:\n  max_fix_attempts: 5\n');

    expect(config.fixer).toEqual({
      maxFixAttempts: 5,
      protectedPaths: ['.github/workflows/', '.github/pipeline.config.yml', '.github/pipeline-rules/'],
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
