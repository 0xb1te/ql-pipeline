# 051 — Plan

## Confirmed Root Cause

`.github/workflows/pr-pipeline.yml`, pre-fix, in all four engine jobs (`test`, `build`, `ql-pipeline`, `preview-tester`):

```yaml
- name: Checkout ql-pipeline
  uses: actions/checkout@v4
  with:
    repository: 0xb1te/ql-pipeline
    ref: ${{ inputs.ql-pipeline-ref }}
    path: .ql-pipeline
```

with the input declared as:

```yaml
ql-pipeline-ref:
  description: Git ref of ql-pipeline to run. Pin a tag/sha in production consumers.
  type: string
  default: main
```

and `.github/workflows/dogfood.yml` calling it with:

```yaml
uses: ./.github/workflows/pr-pipeline.yml
with:
  config-path: pipeline.config.yml
```

Nothing set `ql-pipeline-ref`, so it was `main`. Every `node .ql-pipeline/dist/main.js …` invocation — `gate`, `govern`, `test-preview` — ran `main`'s engine. The pull request's branch was checked out only as the repository under review. The workflow YAML was the branch's, because `uses: ./…` resolves locally; that is the whole reason the defect was invisible: the run *looked* like the branch's.

### Reproduction

Run `35728255439`, on #43 (`features/049-preview-environment-gate`, `0.6.0`). The branch's `runGovern` (`src/cli/govern-command.ts:241-249`) logs exactly one of three `preview environment:` lines directly after the `task artifacts:` line. The run's `checks / ql-pipeline` job logged:

```
[info] task artifacts: complete in docs/features/049-preview-environment-gate
```

and nothing beginning `preview environment:`. That is `0.5.1`'s output. Deterministic: every dogfood run before this fix behaves this way, whatever the branch.

### Is the invariant wrong, or is the code failing it?

The input's contract — *"pin a tag/sha in production consumers"* — is right for a consumer and was never written for the one caller that is not a consumer. Nothing in the workflow distinguished "ql-pipeline governing a product repository" from "ql-pipeline governing itself"; `dogfood.yml`'s header comment says the only difference is `config-path`, and that was true of the YAML and false of what ran. No neuron covers `.github/workflows/`, so the harness had no invariant to check here. The invariant is new and lives in the workflow: **when the caller is ql-pipeline, the engine under test is the pull request.**

## The Fix

The `resolve` job — already the one place that answers "which pull request?" for all three events, and already the only reader of `github.event` — decides which ql-pipeline runs and exposes it as two outputs:

```js
const governsItself = `${context.repo.owner}/${context.repo.repo}` === '0xb1te/ql-pipeline';
core.setOutput('ql-pipeline-repo', governsItself ? pr.head.repo.full_name : '0xb1te/ql-pipeline');
core.setOutput('ql-pipeline-ref', governsItself ? pr.head.ref : process.env.QL_PIPELINE_REF);
```

The consumer's input reaches the script through `env:` (`QL_PIPELINE_REF: ${{ inputs.ql-pipeline-ref }}`), never interpolated into the JavaScript, so a ref containing a quote cannot break the script. All four **Checkout ql-pipeline** steps read `needs.resolve.outputs.ql-pipeline-repo` / `ql-pipeline-ref`. Nothing else reads the input.

`dogfood.yml` is unchanged in effect. It gains a comment saying why it passes no ref, so the next reader does not "fix" it by adding one.

### Why `resolve`, and not `dogfood.yml`

The brief's first suggestion was `ql-pipeline-ref: ${{ github.head_ref }}` in `dogfood.yml`, falling back to `github.ref_name`. Considered and rejected as the mechanism:

| Event | `github.head_ref` | which `dogfood.yml` runs | result of that fix |
|---|---|---|---|
| `pull_request` | the branch | the branch's | correct |
| `issue_comment` | empty | the default branch's | falls back to `main` — the defect, on the re-run a person asked for |
| `pull_request_review_comment` | empty | the default branch's | same |

`resolve` knows the pull request on every event because it asks the API when the payload has no head — that is what it exists for. And a caller cannot forget to set an input the workflow does not read from it. The brief's second suggestion — the reusable workflow defaulting to the head when the caller is ql-pipeline — is what shipped, made unconditional rather than a default the caller can override, because there is no case in which ql-pipeline should govern its own pull request with somebody else's code.

### Why the head *branch*, not the head *sha*

The repository-under-review checkout uses `needs.resolve.outputs.head-ref`. Using the same ref for the engine makes the two checkouts the same tree by construction, rather than two things that agree until a push lands between `resolve` and a later job. A push already cancels the run (`cancel-in-progress`), so pinning the sha would buy nothing and could leave the engine one commit behind the code it reviews.

### Fork pull requests

For a fork, `ql-pipeline-repo` is the fork. The gate jobs already check the fork out and run its `package.json` scripts, so running its `dist/main.js` is not new exposure. A deleted fork is declined by `resolve` before any of this runs, as before.

### The alternative not taken

Skipping the second checkout entirely when the caller is ql-pipeline, and running the engine from the repository-under-review checkout. Every install and invocation in the file is written against `.ql-pipeline/`, and the `Hide the ql-pipeline checkout` step, the pnpm `--ignore-workspace` reasoning and the `GH_PACKAGES_TOKEN` rewrite all assume the nested layout. Re-pointing one `ref:` in four places is the smallest change that resolves the root cause; restructuring the layout is not.

## Neurons

No neuron describes `.github/workflows/` — the harness stops at `src/`. `entrypoint.cli.governCommand` gains `provenance` to this task's `summary.md`: its `runGovern` signal was the one whose absence from the run log proved the defect, and it is the unit a future planner reads before changing what the dogfood check exercises. No signal is added, renamed or removed (**KH-10** N/A). `shared.core.config`'s effector already reads *"the consumer repo's pipeline.config.yml (or ql-pipeline's own, when dogfooding)"*, which stays true.

## Test Plan

A workflow cannot be unit-tested by running it, so the regression test reads both workflow files as data (`yaml`, already a dependency) and pins the wiring — `tests/integration/self-governance.test.ts`, six cases:

- **`has a ql-pipeline checkout in every job that runs the engine`** — pins the four job names, so the assertions below cannot pass vacuously after a rename.
- **`resolve decides which ql-pipeline every job runs`** — the two outputs exist and read from `steps.pr`.
- **`runs the pull request head, not ql-pipeline-ref, when the caller is this repository`** — the self test, both `setOutput` lines, the input read through `env`.
- **`every ql-pipeline checkout reads that decision and nothing else`** — all four steps, `repository`, `ref`, `path`, and `needs: resolve`.
- **`nothing but resolve reads the ql-pipeline-ref input`** — exactly one reader in the file, and it is the `env:` line.
- **`dogfood calls the local workflow and leaves the ref to it`** — `uses: ./…`, `config-path`, and no `ql-pipeline-ref` under `with:`.

Red proven by running the file against `main`'s copies of both workflows: **4 failed, 2 passed**. The two that held — the job list and dogfood's shape — are invariants that were already true; the four that failed are exactly the wiring this task adds. Restored and confirmed byte-identical with `cmp`.

Live (Gate 3): this pull request's own dogfood run is a `pull_request` event, so it already runs the branch's YAML. The `resolve` job should print the notice `ql-pipeline governs itself: running 0xb1te/ql-pipeline@bugfixes/051-dogfood-runs-main-not-the-pr, not ql-pipeline-ref.` and each **Checkout ql-pipeline** step should show that ref. The engine's *behaviour* on this run is indistinguishable from `main`'s, because `dist/` is identical; the first pull request after the merge whose engine differs is where a branch-specific log line appears.

## Explicitly Out Of Scope

- **A neuron for the workflows.** The harness has no unit kind for a YAML workflow; inventing one for this task is the kind of "while I'm here" the flow forbids. Recorded in the rollup instead.
- **Pinning the engine to the head sha.** See above.
- **Making the dogfood run rebuild `dist/`.** It runs the committed one deliberately — that is what a consumer installs.
- **MCP surface.** No tool, schema or return shape changes. The `MCP Cases` sheet is present and empty.

## Version

`0.6.0 → 0.6.1` (PATCH). No source change; `dist/` is byte-identical after a rebuild. A consumer's `ql-pipeline-ref` behaves exactly as before. Only the repository that calls its own workflow sees different behaviour, and for it the old behaviour was the defect.
