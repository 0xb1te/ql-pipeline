import { describe, expect, it } from 'vitest';
import { hashContent, type ScaffoldManifest } from '../../src/scaffold/manifest.js';
import {
  isWrite,
  nextManifest,
  planInit,
  planUpgrade,
  type ExistingFile,
  type TemplateFile,
} from '../../src/scaffold/plan.js';

const WORKFLOW: TemplateFile = { dest: '.github/workflows/pr-governance.yml', mode: 'managed', content: 'workflow v2' };
const CONFIG: TemplateFile = { dest: '.github/pipeline.config.yml', mode: 'owned', content: 'scaffold config' };
const RULE: TemplateFile = { dest: '.cursor/rules/22-testing.mdc', mode: 'managed', content: 'rule v2' };
const TEMPLATES = [WORKFLOW, CONFIG, RULE];

function existing(entries: Record<string, string>): Map<string, ExistingFile> {
  return new Map(Object.entries(entries).map(([dest, content]) => [dest, { content }]));
}

function manifestFor(entries: Record<string, string>): ScaffoldManifest {
  return { version: '0.1.0', files: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, hashContent(v)])) };
}

describe('planInit', () => {
  it('creates every file in an empty repo', () => {
    const actions = planInit({ templates: TEMPLATES, existing: existing({}) });

    expect(actions.every((action) => action.kind === 'create')).toBe(true);
    expect(actions).toHaveLength(3);
  });

  it('never overwrites anything that already exists', () => {
    const actions = planInit({
      templates: TEMPLATES,
      existing: existing({ '.github/pipeline.config.yml': 'my config', '.cursor/rules/22-testing.mdc': 'my rule' }),
    });

    expect(actions.filter(isWrite).map((action) => action.dest)).toEqual(['.github/workflows/pr-governance.yml']);
  });

  it('is safe to run twice — the second run writes nothing', () => {
    const all = existing({
      '.github/workflows/pr-governance.yml': 'workflow v2',
      '.github/pipeline.config.yml': 'scaffold config',
      '.cursor/rules/22-testing.mdc': 'rule v2',
    });

    expect(planInit({ templates: TEMPLATES, existing: all }).filter(isWrite)).toEqual([]);
  });
});

describe('planUpgrade', () => {
  it('updates a managed file the user never touched', () => {
    // On disk it is still v1, and the manifest agrees we wrote v1 — so the
    // difference is ours, not theirs.
    const actions = planUpgrade({
      templates: [WORKFLOW],
      existing: existing({ [WORKFLOW.dest]: 'workflow v1' }),
      manifest: manifestFor({ [WORKFLOW.dest]: 'workflow v1' }),
      force: false,
    });

    expect(actions).toEqual([{ kind: 'update', dest: WORKFLOW.dest, content: 'workflow v2' }]);
  });

  it('refuses to overwrite a managed file the user edited', () => {
    const actions = planUpgrade({
      templates: [RULE],
      existing: existing({ [RULE.dest]: 'rule v1 + my own note' }),
      manifest: manifestFor({ [RULE.dest]: 'rule v1' }),
      force: false,
    });

    expect(actions).toEqual([{ kind: 'skip-modified', dest: RULE.dest }]);
  });

  it('overwrites an edited managed file only when forced', () => {
    const actions = planUpgrade({
      templates: [RULE],
      existing: existing({ [RULE.dest]: 'rule v1 + my own note' }),
      manifest: manifestFor({ [RULE.dest]: 'rule v1' }),
      force: true,
    });

    expect(actions).toEqual([{ kind: 'overwrite-modified', dest: RULE.dest, content: 'rule v2' }]);
  });

  it('never touches an owned file, even with --force', () => {
    const actions = planUpgrade({
      templates: [CONFIG],
      existing: existing({ [CONFIG.dest]: 'my real build commands' }),
      manifest: manifestFor({}),
      force: true,
    });

    expect(actions).toEqual([{ kind: 'skip-owned', dest: CONFIG.dest }]);
  });

  it('treats a file with no manifest entry as the user\'s, not ours', () => {
    // A repo scaffolded by hand, or before manifests existed. We cannot
    // prove we wrote it, so we do not claim the right to replace it.
    const actions = planUpgrade({
      templates: [RULE],
      existing: existing({ [RULE.dest]: 'rule v1' }),
      manifest: null,
      force: false,
    });

    expect(actions).toEqual([{ kind: 'skip-modified', dest: RULE.dest }]);
  });

  it('creates a managed file added in a newer version', () => {
    const actions = planUpgrade({
      templates: [RULE],
      existing: existing({}),
      manifest: manifestFor({}),
      force: false,
    });

    expect(actions).toEqual([{ kind: 'create', dest: RULE.dest, content: 'rule v2' }]);
  });

  it('reports a file already at the current version as unchanged, writing nothing', () => {
    const actions = planUpgrade({
      templates: [RULE],
      existing: existing({ [RULE.dest]: 'rule v2' }),
      manifest: manifestFor({ [RULE.dest]: 'rule v2' }),
      force: false,
    });

    expect(actions).toEqual([{ kind: 'unchanged', dest: RULE.dest }]);
  });

  it('ignores line-ending differences, which a Windows checkout introduces on its own', () => {
    const actions = planUpgrade({
      templates: [{ dest: 'a.md', mode: 'managed', content: 'line one\nline two\n' }],
      existing: existing({ 'a.md': 'line one\r\nline two\r\n' }),
      manifest: null,
      force: false,
    });

    expect(actions).toEqual([{ kind: 'unchanged', dest: 'a.md' }]);
  });
});

describe('nextManifest', () => {
  it('records managed files that were written or already current', () => {
    const actions = planUpgrade({
      templates: [WORKFLOW, RULE],
      existing: existing({ [WORKFLOW.dest]: 'workflow v2', [RULE.dest]: 'rule v1' }),
      manifest: manifestFor({ [WORKFLOW.dest]: 'workflow v2', [RULE.dest]: 'rule v1' }),
      force: false,
    });

    const manifest = nextManifest('0.2.0', [WORKFLOW, RULE], actions);

    expect(manifest.version).toBe('0.2.0');
    expect(manifest.files[WORKFLOW.dest]).toBe(hashContent('workflow v2'));
    expect(manifest.files[RULE.dest]).toBe(hashContent('rule v2'));
  });

  it('never records an owned file — we do not track what we do not manage', () => {
    const actions = planInit({ templates: [CONFIG], existing: existing({}) });

    expect(nextManifest('0.1.0', [CONFIG], actions).files).toEqual({});
  });

  it('never records a file left alone because the user edited it', () => {
    const actions = planUpgrade({
      templates: [RULE],
      existing: existing({ [RULE.dest]: 'their edit' }),
      manifest: manifestFor({ [RULE.dest]: 'rule v1' }),
      force: false,
    });

    // Recording a hash here would claim we authored their edit, and the
    // next upgrade would silently overwrite it.
    expect(nextManifest('0.2.0', [RULE], actions).files).toEqual({});
  });
});
