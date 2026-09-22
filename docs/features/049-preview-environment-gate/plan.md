# 049 — Technical Plan

## Problem

ql-docs is writing a preview environment contract: every repository with `apps/*frontend*` or `apps/*backend*` carries a bootable compose stack under `infrastructure/docker/environments/devops/`, with one `edge` entry service, no published ports, and an `env.example` the stack boots from unedited. ql-proxy brings that folder up; the automated tester reaches the application inside it. Neither works for a repository that does not have it, and nothing today says so.

## Neurons Read

`verdict.decision.taskArtifacts` (the closest analogue: a structural check that manufactures a finding, fed by a listing rather than a disk), `entrypoint.cli.governCommand` (where structural checks run, and the order they run in relative to R4), `routing.router.areaPaths` (the glob matcher area detection already uses), `scaffold.core.doctor` and `entrypoint.cli.scaffoldCommands#runDoctor` (the check shape `doctor` reports in, and where its input is collected).

## Scope

### In scope

| Unit | Change |
|---|---|
| `src/verdict/preview-environment.ts` | **New neuron.** Applicability, the structural reading of the compose file, the verdict, the finding, and the one injectable filesystem reader both callers share |
| `src/cli/govern-command.ts` | `previewEnvironmentFindings` before R4; `previewEnvironmentRefusal` as the hard gate after it; the R4 comment carries the preview finding too |
| `src/scaffold/doctor.ts` | `DoctorInput.previewEnvironment` and a `preview environment` check |
| `src/cli/scaffold-commands.ts` | Collects the verdict against the configured area paths, falling back to the house convention when the config does not read |
| `tests/verdict/preview-environment.test.ts` | **New.** 21 cases on the pure checks and the reader |
| `tests/cli/govern-command.test.ts`, `tests/scaffold/doctor.test.ts` | The gate against a real temporary checkout; the doctor line |
| `docs/integration-guide.md` | §4d, what the contract asks of a consumer and where the rules live |

### Explicitly out of scope

- **Restating the rules.** They live in ql-docs and every message here points at them. The eight rules the contract brief specifies are enforced as far as they are structural; the rest (one frontend at `/`, no name-based virtual hosts, build contexts relative to the folder) are the deploy's and the reviewer's business.
- **Booting the stack.** Whether the compose file actually comes up is the deploy job's question — task 050 — and answering it here would put Docker in a governance job.
- **A configurable folder path.** The contract fixes it so ql-proxy and this pipeline agree without asking each other.

## Decisions

### A hard gate, not a finding

The brief says *fail*. The first instinct — a `must` finding, the way `task-artifacts` works — was rejected on reading `runGovern`: a finding rides into the verdict, which is reached only after the gate reports are read and the AI review has run. A repository that cannot be previewed would still spend a review, and `decidePipelineOutcome` can be argued from BLOCK back toward MERGE by an attempt cap or a config. Nothing downstream can work without the folder, so nothing downstream should be spent on it.

It is not an escalation either. `needs-human` exists for questions a person adjudicates. A missing folder is fixed by its author, so the pull request fails and says what is missing, exactly as an unroutable one does — comment, `setFailed`, return.

### Before R4, but refused after it

The verdict is *computed* ahead of the R4 check so an escalation can carry it — a person summoned to review a governance change should see the repository also cannot be previewed, rather than discover it on the next pull request. It is *refused on* after R4, so a governance pull request still gets the human hop it always gets and the person sees both. This is the same ordering `042` settled for task artifacts, for the same reason.

### Applicability keyed off `areas.paths`

The brief says the check keys off the area detection the pipeline already has. Taken literally: `requiresPreviewEnvironment` tests each `apps/<name>` against the configured `frontend` and `backend` globs through `matchesGlob`, the one glob implementation the router has. A repository that overrides `areas.paths` is measured against its own layout, and there is no second list of directory names to drift from the first.

### No opt-in, unlike `task-artifacts`

`041` shipped its check advisory-by-default because a standard arriving on every repository at once turns every open pull request red. This check applies only where a product exists — the set of repositories that have something to preview — and a product repository with no preview stack is exactly what the downstream tasks cannot handle. Advisory here would mean the deploy job runs against a folder that is not there.

### The reader lives in the neuron

`taskArtifacts` is pure and its caller reads the disk. Here two callers read the same folder — `govern` and `doctor` — and two readers of one folder is how they come to disagree about it. `readPreviewEnvironmentSnapshot` is one injectable signal with a declared `filesystem` effector; the four checks it feeds stay pure.

### The contract node is cited by stage and title, not number

The ql-docs task leaves the numbering open — absorb `14-preview-database-seeding` into slot 14, or take 15 and strike the provisional banner. A message that names `14-preview-environment-contract` is wrong the day ql-docs picks 15. `PREVIEW_CONTRACT_NODE` names the stage folder and the node's title and says it absorbs node 14, which is true either way.

## Contract Impact

- **Behaviour change for product repositories only.** A consumer with `apps/*backend*` and no devops folder starts failing on its next governed pull request. That is the feature. A consumer without product apps sees one new log line and a new passing doctor check.
- **`DoctorInput` gains a required field.** Only `collectDoctorInput` constructs it; no other caller.
- **No MCP surface change.** The `ql_pipeline_doctor` tool spawns the same CLI and reports one more line; its schema is unchanged.
- **`package.json` 0.5.1 → 0.6.0** (MINOR — feature). Task 050 stacks on this branch and takes 0.7.0.
- **Harness:** one new neuron, one new tract, edges into `routing.router` from `verdict.decision` (both ganglia updated). Validator output identical to `main`: 24 pre-existing errors, same lines.

## Verification

- `pnpm run typecheck`, `pnpm run lint`, `pnpm run neurons` — green.
- `pnpm test` — **810 passing across 57 files**, 26 added here.
- `python validate-harness.py .` diffed line by line against a clean `main` worktree: identical.
- This pull request is the live proof of the "unaffected" case: ql-pipeline has no `apps/` and its govern log should read `preview environment: not required`.

## Definition Of Done

The gate live before the review, the doctor line reporting the same verdict, every message pointing at the contract rather than restating it, and no repository without product apps changing behaviour.
