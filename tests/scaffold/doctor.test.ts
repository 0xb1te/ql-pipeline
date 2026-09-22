import { describe, expect, it } from 'vitest';
import { runDoctorChecks, worstStatus, type DoctorInput } from '../../src/scaffold/doctor.js';

/** The two lines that turn the comment trigger on, so a test can take them away again. */
const COMMENT_TRIGGER = `  issue_comment:
    types: [created, edited]
`;

/** A caller that takes comment triggers and tells the two kinds of run apart. */
const CALLER_WITH_SPLIT_GROUP = `on:
  pull_request:
    types: [opened, synchronize, reopened]
  issue_comment:
    types: [created, edited]

concurrency:
  group: pr-pipeline-\${{ github.event.pull_request.number || github.event.issue.number }}-\${{ github.event_name == 'pull_request' && 'commit' || 'comment' }}
  cancel-in-progress: true
`;

/** The recipe the integration guide used to document, and the one that self-cancels. */
const CALLER_WITH_SHARED_GROUP = `on:
  pull_request:
    types: [opened, synchronize, reopened]
  issue_comment:
    types: [created, edited]

concurrency:
  group: pr-pipeline-\${{ github.event.pull_request.number || github.event.issue.number }}
  cancel-in-progress: true
`;

function input(overrides: Partial<DoctorInput> = {}): DoctorInput {
  return {
    callerWorkflowPresent: true,
    callerWorkflowReferencesPipeline: true,
    callerWorkflowText: CALLER_WITH_SPLIT_GROUP,
    configPresent: true,
    configError: null,
    targetBranch: 'main',
    gatedAreas: ['frontend', 'backend'],
    standardsEnabled: true,
    standardsRootPresent: true,
    missingStandardsDocs: [],
    standardsIgnored: true,
    cursorRuleCount: 7,
    previewEnvironment: { kind: 'valid' },
    ...overrides,
  };
}

const statusOf = (results: ReturnType<typeof runDoctorChecks>, name: string): string | undefined =>
  results.find((result) => result.name === name)?.status;

describe('runDoctorChecks', () => {
  it('passes everything on a fully configured repo', () => {
    expect(worstStatus(runDoctorChecks(input()))).toBe('pass');
  });

  it('fails when no caller workflow exists', () => {
    const results = runDoctorChecks(input({ callerWorkflowPresent: false }));

    expect(statusOf(results, 'caller workflow')).toBe('fail');
    expect(worstStatus(results)).toBe('fail');
  });

  it('warns when a governance workflow exists but does not call ql-pipeline', () => {
    const results = runDoctorChecks(input({ callerWorkflowReferencesPipeline: false }));

    expect(statusOf(results, 'caller workflow')).toBe('warn');
  });

  it('fails when the config is missing', () => {
    expect(statusOf(runDoctorChecks(input({ configPresent: false })), 'pipeline config')).toBe('fail');
  });

  it('fails when the config does not parse, surfacing the reason', () => {
    const results = runDoctorChecks(input({ configError: 'merge.target_branch must be a non-empty string' }));

    expect(statusOf(results, 'pipeline config')).toBe('fail');
    expect(results.find((r) => r.name === 'pipeline config')?.detail).toContain('target_branch');
  });

  it('does not claim the gates are fine when the config could not be read', () => {
    expect(statusOf(runDoctorChecks(input({ configError: 'broken' })), 'gates')).toBe('warn');
  });

  it('warns when no area has gate commands, since those checks would pass vacuously', () => {
    expect(statusOf(runDoctorChecks(input({ gatedAreas: [] })), 'gates')).toBe('warn');
  });

  it('warns, not fails, when the standards are simply not cloned locally', () => {
    // CI clones them itself, so this only degrades the editor experience.
    const results = runDoctorChecks(input({ standardsRootPresent: false }));

    expect(statusOf(results, 'standards')).toBe('warn');
    expect(worstStatus(results)).toBe('warn');
  });

  it('fails when a configured standards document is missing from a present checkout', () => {
    const results = runDoctorChecks(input({ missingStandardsDocs: ['workflow/review/pr-feature/frontend.md'] }));

    expect(statusOf(results, 'standards')).toBe('fail');
  });

  it('warns when standards are disabled, because reviews are then weaker than the default', () => {
    expect(statusOf(runDoctorChecks(input({ standardsEnabled: false })), 'standards')).toBe('warn');
  });

  it('does not claim standards are "disabled" when the config could not be read at all', () => {
    // We never read the setting, so reporting it as disabled would state a
    // fact we do not have.
    const results = runDoctorChecks(input({ configError: 'broken', standardsEnabled: false }));

    expect(results.find((result) => result.name === 'standards')?.detail).toContain('not checked');
  });

  it('does not nag about gitignore when standards are disabled entirely', () => {
    const results = runDoctorChecks(input({ standardsEnabled: false, standardsIgnored: false }));

    expect(results.find((result) => result.name === 'standards ignored')).toBeUndefined();
  });

  it('warns when the standards checkout could be committed by accident', () => {
    expect(statusOf(runDoctorChecks(input({ standardsIgnored: false })), 'standards ignored')).toBe('warn');
  });

  it('warns when no cursor rules are installed', () => {
    expect(statusOf(runDoctorChecks(input({ cursorRuleCount: 0 })), 'cursor rules')).toBe('warn');
  });

  it('passes the preview environment check on a repository with no product apps', () => {
    const results = runDoctorChecks(input({ previewEnvironment: { kind: 'not-required' } }));

    expect(statusOf(results, 'preview environment')).toBe('pass');
    expect(results.find((r) => r.name === 'preview environment')?.detail).toContain('not required');
  });

  it('fails the preview environment check with every violation and a pointer to the contract', () => {
    const results = runDoctorChecks(
      input({ previewEnvironment: { kind: 'invalid', violations: ['no edge service', 'env.example is missing'] } }),
    );
    const check = results.find((r) => r.name === 'preview environment');

    expect(check?.status).toBe('fail');
    expect(check?.detail).toContain('no edge service');
    expect(check?.detail).toContain('env.example is missing');
    expect(check?.fix).toContain('stage-8-deployment');
    expect(worstStatus(results)).toBe('fail');
  });

  it('offers a fix for every non-passing check that has one', () => {
    const results = runDoctorChecks(
      input({ callerWorkflowPresent: false, configPresent: false, cursorRuleCount: 0, standardsIgnored: false }),
    );

    // "not checked" results are downstream of another failure that does
    // carry the fix; suggesting one here would point at the wrong thing.
    const actionable = results.filter((r) => r.status !== 'pass' && !r.detail.includes('not checked'));

    expect(actionable.length).toBeGreaterThan(0);
    for (const result of actionable) {
      expect(result.fix, `${result.name} should suggest a fix`).toBeDefined();
    }
  });
});

describe('worstStatus', () => {
  it('is pass for an empty list', () => {
    expect(worstStatus([])).toBe('pass');
  });

  it('reports fail over warn', () => {
    expect(
      worstStatus([
        { name: 'a', status: 'warn', detail: '' },
        { name: 'b', status: 'fail', detail: '' },
      ]),
    ).toBe('fail');
  });
});

describe('caller concurrency', () => {
  it('warns when a comment can cancel the run that wrote it', () => {
    // The defect. The pipeline posts its verdict, that comment queues a run in the same group,
    // and `cancel-in-progress` kills the run that was posting — so a pull request the engine
    // approved shows a red check, because a cancelled check is not a green one.
    const results = runDoctorChecks(input({ callerWorkflowText: CALLER_WITH_SHARED_GROUP }));

    expect(statusOf(results, 'caller concurrency')).toBe('warn');
    expect(results.find((r) => r.name === 'caller concurrency')?.fix).toContain('event_name');
  });

  it('passes once the group tells commit runs from comment runs', () => {
    expect(statusOf(runDoctorChecks(input()), 'caller concurrency')).toBe('pass');
  });

  it('says nothing about a caller that takes no comment trigger', () => {
    // Without the comment triggers the shared group is exactly right, and warning about it would
    // be advice to break a working workflow.
    const noComments = CALLER_WITH_SHARED_GROUP.replace(COMMENT_TRIGGER, '');

    expect(statusOf(runDoctorChecks(input({ callerWorkflowText: noComments })), 'caller concurrency')).toBe('pass');
  });

  it('says nothing about a caller that does not cancel in progress', () => {
    // Nothing is cancelled, so nothing can cancel the run posting a verdict.
    const noCancel = CALLER_WITH_SHARED_GROUP.replace('cancel-in-progress: true', 'cancel-in-progress: false');

    expect(statusOf(runDoctorChecks(input({ callerWorkflowText: noCancel })), 'caller concurrency')).toBe('pass');
  });

  it('does not claim to know about a repo with no caller workflow', () => {
    const results = runDoctorChecks(input({ callerWorkflowPresent: false, callerWorkflowText: null }));

    expect(statusOf(results, 'caller concurrency')).toBe('warn');
  });
});
