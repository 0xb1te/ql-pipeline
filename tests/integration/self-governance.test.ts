import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * The dogfood check must exercise the pull request's own code.
 *
 * Every job of pr-pipeline.yml checks ql-pipeline out into `.ql-pipeline/`
 * and runs `node .ql-pipeline/dist/main.js` from THERE, while the branch
 * under review is only the other checkout. Until 051 that second checkout
 * read `inputs.ql-pipeline-ref`, which dogfood.yml never set, so it was
 * always `main`: run 35728255439 on #43 logged 0.5.1's lines against a 0.6.0
 * branch, and a change to govern, gate or tester code was never once run by
 * the check meant to prove it. Only the YAML came from the branch, because
 * `uses: ./...` is local.
 *
 * These assertions pin the wiring that closes that: `resolve` decides which
 * ql-pipeline runs (the PR's own head when the caller is this repository),
 * and every checkout reads that decision rather than the input. They read
 * the workflow files as data - the only way to test a workflow without
 * running one - and would fail against the pre-051 file on three counts.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

type Step = { name?: string; uses?: string; env?: Record<string, string>; with?: Record<string, string> };
type Job = { needs?: string | string[]; outputs?: Record<string, string>; steps?: Step[]; uses?: string; with?: Record<string, string> };
type Workflow = { jobs: Record<string, Job> };

function loadWorkflow(name: string): Workflow {
  return parse(readFileSync(`${ROOT}.github/workflows/${name}`, 'utf8')) as Workflow;
}

const pipeline = loadWorkflow('pr-pipeline.yml');
const dogfood = loadWorkflow('dogfood.yml');

const checkoutsOfQlPipeline = Object.entries(pipeline.jobs).flatMap(([job, def]) =>
  (def.steps ?? [])
    .filter((step) => step.name === 'Checkout ql-pipeline')
    .map((step) => ({ job, step })),
);

describe('ql-pipeline governs its own pull requests with their own code', () => {
  it('has a ql-pipeline checkout in every job that runs the engine', () => {
    // If the workflow ever loses the step by that name the assertions below
    // would pass vacuously; pin the count so a rename is a red test.
    expect(checkoutsOfQlPipeline.map((c) => c.job).sort()).toEqual(['build', 'preview', 'preview-tester', 'ql-pipeline', 'test'].sort());
  });

  it('resolve decides which ql-pipeline every job runs', () => {
    const outputs = pipeline.jobs.resolve?.outputs ?? {};
    expect(outputs['ql-pipeline-repo']).toBe('${{ steps.pr.outputs.ql-pipeline-repo }}');
    expect(outputs['ql-pipeline-ref']).toBe('${{ steps.pr.outputs.ql-pipeline-ref }}');
  });

  it('runs the pull request head, not ql-pipeline-ref, when the caller is this repository', () => {
    const resolveStep = (pipeline.jobs.resolve?.steps ?? []).find((step) => step.uses?.startsWith('actions/github-script'));
    const script = String(resolveStep?.with?.script ?? '');
    expect(script).toContain("=== '0xb1te/ql-pipeline'");
    expect(script).toContain("core.setOutput('ql-pipeline-repo', governsItself ? pr.head.repo.full_name : '0xb1te/ql-pipeline')");
    expect(script).toContain("core.setOutput('ql-pipeline-ref', governsItself ? pr.head.ref : process.env.QL_PIPELINE_REF)");
    // The consumer's pinned ref reaches the script through the environment,
    // never interpolated into it.
    expect(resolveStep?.env?.QL_PIPELINE_REF).toBe('${{ inputs.ql-pipeline-ref }}');
    expect(script).not.toContain('inputs.ql-pipeline-ref');
  });

  it('every ql-pipeline checkout reads that decision and nothing else', () => {
    for (const { job, step } of checkoutsOfQlPipeline) {
      expect(step.with?.repository, `${job}: repository`).toBe('${{ needs.resolve.outputs.ql-pipeline-repo }}');
      expect(step.with?.ref, `${job}: ref`).toBe('${{ needs.resolve.outputs.ql-pipeline-ref }}');
      expect(step.with?.path, `${job}: path`).toBe('.ql-pipeline');
      const needs = pipeline.jobs[job]?.needs ?? [];
      expect(Array.isArray(needs) ? needs : [needs], `${job}: needs resolve`).toContain('resolve');
    }
  });

  it('nothing but resolve reads the ql-pipeline-ref input', () => {
    const raw = readFileSync(`${ROOT}.github/workflows/pr-pipeline.yml`, 'utf8');
    const readers = raw.split('\n').filter((line) => line.includes('inputs.ql-pipeline-ref'));
    expect(readers).toHaveLength(1);
    expect(readers[0]).toContain('QL_PIPELINE_REF:');
  });

  it('dogfood calls the local workflow and leaves the ref to it', () => {
    const checks = dogfood.jobs.checks;
    expect(checks?.uses).toBe('./.github/workflows/pr-pipeline.yml');
    expect(checks?.with?.['config-path']).toBe('pipeline.config.yml');
    // Setting it here would cover `pull_request` only - `github.head_ref` is
    // empty on both comment events - and resolve ignores it for this caller
    // anyway. One mechanism, in one place.
    expect(checks?.with).not.toHaveProperty('ql-pipeline-ref');
  });
});
