# ql-pipeline — Specification

The canonical statement of what this project must do, and where each requirement is implemented and proven. Design rationale lives in the per-task plans under `docs/NNN-*/`; this document is the contract those plans serve.

**Status: fully implemented.** Every requirement below maps to shipping code and a test. What is *not* yet verified is stated plainly in §6.

---

## 1. Purpose

A versioned DevOps pipeline that governs pull requests automatically: it interprets each PR's conventional commits, applies the rule set for the area that changed, gates the PR behind build and test, reviews it with AI, and then **merges**, **fixes**, or **blocks** it — merging only into the branch its configuration designates.

## 2. Core requirements

| # | Requirement | Where it lives | Proven by |
|---|---|---|---|
| **R1** | Versioned as a repository, so pipeline behaviour can be developed and improved like code | this repo; rules and prompts are data, not code | `rules/*.rules`, `prompts/*.md` |
| **R2** | A set of rules applied **dynamically per PR**, selected by what the PR changed | [`src/router/router.ts`](../src/router/router.ts), [`src/rules/rule-resolver.ts`](../src/rules/rule-resolver.ts) | `tests/router/router.test.ts`, `tests/rules/rule-resolver.test.ts` |
| **R3** | Merge / block / fix PRs into the branch **designated by config** | [`src/verdict/verdict.ts`](../src/verdict/verdict.ts), [`src/merger/target-branch.ts`](../src/merger/target-branch.ts) | `tests/verdict/verdict.test.ts`, `tests/merger/target-branch.test.ts` |
| **R4** | Detect the change type by **interpreting the conventional commit**, `<type>(<area>)` | [`src/commit-parser/commit-parser.ts`](../src/commit-parser/commit-parser.ts) | `tests/commit-parser/commit-parser.test.ts` (100% branch coverage) |
| **R6** | Review against the **house engineering standards** (the ql-docs workflow docs), not just generic rules | [`src/standards/standards-resolver.ts`](../src/standards/standards-resolver.ts) | `tests/standards/standards-resolver.test.ts` |
| **R7** | Detect areas from the **monorepo layout** (`apps/*frontend*`, `apps/*backend*`), so a mislabelled commit can't narrow review scope | [`src/router/area-paths.ts`](../src/router/area-paths.ts) | `tests/router/area-paths.test.ts` |
| **R5** | **Build and test before approving**, so nothing that crashes reaches production | [`src/router/gate-runner.ts`](../src/router/gate-runner.ts), [`src/verdict/required-checks.ts`](../src/verdict/required-checks.ts) | `tests/router/gate-runner.test.ts`, `tests/verdict/required-checks.test.ts` |
| **UC1** | A clean `feat(frontend)` PR is reviewed, found mergeable, approved and **auto-merged** | end-to-end through [`src/main.ts`](../src/main.ts) | `tests/integration/pipeline-flow.test.ts` → "UC1" |
| **UC2** | A flawed `feat(backend)` PR gets a **complaint**, a **Cursor CLI fix commit**, and is **re-reviewed until resolved** | [`src/fixer/`](../src/fixer/) | `tests/integration/pipeline-flow.test.ts` → "UC2 full loop" |

### Areas and types

```
<type>(<area>): <description>

type ::= feat | fix | refactor | perf | chore | docs | test | ci | build | revert
area ::= frontend | backend | mobile | ios | android | infrastructure | docs
```

A PR where neither any commit nor the PR title matches is **unroutable** and fails closed with an explanatory comment — the AI never reviews a change the pipeline cannot route.

### Area detection

Areas come from two sources, unioned:

1. **Conventional-commit headers** — the primary signal, and the one that decides routability.
2. **Changed paths** — `apps/*frontend*/**` → `frontend`, `apps/*backend*/**` → `backend` by default, configurable per area.

Path detection is deliberately **additive, not a substitute**. Commit hygiene stays mandatory (a PR with no parseable header is still unroutable), but a PR labelled `feat(frontend)` that also edits `apps/api-backend/` cannot thereby dodge the backend rules and standards.

### Engineering standards

Beyond `rules/*.rules`, the reviewer is given the organisation's own workflow documentation for the areas a PR touches — read live from `house-api` at review time, never vendored or checked out, so it is always current.

| Area | Documents | Why |
|---|---|---|
| `frontend` | `workflow/rules/stage-2-mockup/checklist.md`, `stage-5-frontend/checklist.md` | Two stages own the frontend — stage 2 the visible surface, stage 5 the non-visual architecture — and a PR under `apps/*frontend*` can be either |
| `backend` | `workflow/rules/stage-4-backend/{backend,sql}/checklist.md`, `stage-6-tests/backend/checklist.md` | Layers, schema, and the six-path test strategy |
| `mobile`, `ios`, `android` | `workflow/rules/stage-5-frontend/checklist.md` | Mobile apps are the frontend packaged with Capacitor; no separate native codebase, no dedicated mobile checklist upstream |
| `infrastructure` | `workflow/rules/stage-8-deployment/checklist.md` | Provisioning, secrets, release promotion |
| `docs` | — | The workflow has no documentation checklist, so `rules/docs.rules` covers this area alone |

Only the `checklist.md` files are loaded. The `PROMPT.md` and `CREATE-*.md` files in the same tree are **code-generation** instructions — feeding them to a reviewer would tell it how to write code rather than how to judge it.

**These mappings are the area rules.** `rules/*.rules` deliberately contains only `_common.rules` (properties of the pull request itself — secrets, commit hygiene, suppressed checks) and `docs.rules` (the one uncovered area). Restating an architectural requirement in both places would create two definitions that can drift apart, and the reviewer would cite whichever it read first.

Standards are cited like rules, as `<area>.standards#<section>`, and are subject to the same grounding requirement. Loading is fail-closed: if `standards.enabled` is true and a configured document is missing, the PR is escalated rather than reviewed without it — a review that silently ignores the standards is worse than no review, because the repo would believe it happened.

## 3. Locked design decisions

Decided 2026-07-16 (see [001/plan.md §8](001-first-task-base-project/plan.md)); the whole implementation depends on these.

| # | Decision |
|---|---|
| D1 | **GitHub Actions** as the CI platform |
| D2 | **TypeScript on Node 20**, strict mode |
| D3 | **Cursor CLI (`cursor-agent`) performs both the review and the fix** — one AI vendor, one auth surface (`CURSOR_API_KEY`), two prompt templates and two invocation modes |
| D4 | Ships as a **reusable workflow** (`workflow_call`) that consumer repos call by reference; they never vendor the code |
| D5 | **Merge commit** (not squash), preserving intermediate bot fix commits |
| D6 | **`max_fix_attempts: 3`** before escalating to a human |

## 4. Pipeline contract

### 4.1 Check topology

The pipeline reports **three checks** on a PR, one per GitHub Actions job, in this order:

| # | Check | Command | Purpose |
|---|---|---|---|
| 1 | `test` | `main.js gate --stage test` | The test gate for the PR's areas |
| 2 | `build` | `main.js gate --stage build` | The build gate for the PR's areas |
| 3 | `ql-pipeline` | `main.js govern` | AI review, verdict, and merge / fix / block |

`build` runs only if `test` passed — first real failure, fastest feedback. **`ql-pipeline` runs even when a gate failed** (it is skipped only if the run is cancelled), because a broken build is a finding the fix agent can repair; halting the chain on a red gate would silently drop that capability.

Gate jobs hand their outcomes to the pipeline job as **artifacts** (`gate-report-<stage>`), validated on read. A report that is absent means "that stage did not report" — which is *not* the same as passing, and never invents a finding. A report that is present but corrupt fails closed: the pipeline will not merge a PR when it cannot tell whether the tests passed.

Every job routes independently rather than inheriting a decision from another job, so each check reports the truth about the PR in front of it. Routing costs one API call.

### 4.2 Ordered steps

Normative — several steps exist specifically to run *before* a later one.

1. **Read PR context** — number, title, head ref/SHA, base ref, fork status.
2. **Governance pre-check** — if the PR's base branch could not possibly be a configured target, exit cleanly. Costs zero API calls and zero AI spend on PRs this pipeline has no authority over. *(Every job.)*
3. **Route** — parse the PR's commits; union the areas found. Fall back to the PR title only when *no* commit parses. Unroutable ⇒ fail closed. *(Every job.)*
4. **Resolve the target branch** — per-area overrides may apply; areas disagreeing is a conflict that escalates to a human. If the PR's base isn't the resolved target, exit cleanly. *(Every job.)*
5. **Gates** — each stage job runs only its own commands, for the matched areas, and writes a report. *(Jobs 1 and 2.)*
6. **Label** the PR `area:<area>` for each matched area. *(Job 3.)*
7. **Self-protection** — a PR touching `rules/`, `prompts/`, the pipeline config, or workflows always routes to a human. Checked structurally, *before the AI is consulted*: the AI's judgment must never be the enforcement mechanism for its own constitution. *(Job 3.)*
8. **Collect gate reports** — failures become findings; a stage outside `required_checks` yields advisory findings instead of blocking ones. *(Job 3.)*
9. **AI review** — skipped when a required gate already failed or when `ai-review` isn't required. Otherwise `cursor-agent` runs read-only against the resolved rules, and every finding must cite a real file, line, and rule ID or it is discarded. *(Job 3.)*
10. **Verdict** — MERGE, FIX, or BLOCK (§5). *(Job 3.)*
11. **Audit comment** — areas, target branch, gate results, whether the review ran, finding count, and the decision. The decision trail is reconstructible from the PR alone. *(Job 3.)*
12. **Act** — merge (SHA-pinned), or post a complaint and run the fix agent, or block with `needs-human`. *(Job 3.)*

## 5. Verdict rules

| Condition | Decision |
|---|---|
| No `must`/`security` findings | **MERGE** — `should` findings ride along as advisory comments |
| All blocking findings auto-fixable, attempts remaining | **FIX** |
| Any non-auto-fixable finding, or attempts exhausted | **BLOCK** — label `needs-human` |

## 6. Safety properties

Each is a guarantee the implementation must keep, not a best effort.

| Property | How it is guaranteed |
|---|---|
| **Fail closed** | Unroutable commits, malformed AI verdicts, crashed gates, unreadable config — all end in a failed check, never a merge. Chaos-tested in `tests/integration/chaos-safety.test.ts`. |
| **The loop terminates** | Fix attempts are counted from `[bot]`-suffixed commit history and capped at `max_fix_attempts`; exhaustion is a BLOCK, never a retry. |
| **The pipeline cannot rewrite its own laws** | Protected paths are enforced twice: a PR touching them routes to a human, and any fix-agent edit to them is hard-reverted via `git checkout --` before a commit is made. A prompt can be ignored; a revert cannot. |
| **The reviewer is read-only** | The tree is snapshotted before and after the review; any difference fails the run. An unreadable snapshot counts as modified — unverifiable is never treated as safe. |
| **Only the reviewed revision merges** | The head SHA is re-checked before merging and pinned on the merge API call, so a commit racing the run cannot be merged unreviewed. |
| **Findings are grounded** | Findings citing a file, line, or reference id (rule file *or* standards document) that doesn't exist are discarded, not repaired — the hallucination guard on the reviewer itself. |
| **Standards are applied or the PR is stopped** | If standards are enabled and a configured document cannot be loaded, the PR escalates to a human. The pipeline never quietly reviews against fewer standards than the repo has declared. |
| **The agent never commits** | The fix agent only produces a working-tree diff. The pipeline decides what is staged (exactly the paths the agent touched, never build artifacts), writes the commit message, and pushes. |
| **Fork PRs are never falsely "fixed"** | A fork's branch cannot be pushed to with the base repo's token; such PRs are reviewed and complained about, then escalated. |
| **Untrusted content never reaches a shell** | PR diffs and complaints are passed to `cursor-agent` as a single argv element via `spawn`; agent-created filenames are staged through a git pathspec file. Only trusted config strings run through a shell. |
| **A stage that didn't report never counts as passing** | Gate reports cross the job boundary as validated artifacts. Absent ⇒ that stage is unknown, and no finding is invented. Corrupt ⇒ the run fails closed rather than merging on an unverified build. |

## 7. Configuration surface

`merge.target_branch` is required. Everything else defaults — see [`pipeline.config.yml`](../pipeline.config.yml) for the annotated schema and [integration-guide.md §4](integration-guide.md) for consumer setup.

Consumers override rules per area with `.github/pipeline-rules/<area>.rules`, which **fully replaces** that area's shipped rules. `_common.rules` always applies and is not overridable.

## 8. What is not verified

Honest statement of the remaining gap:

- **No live GitHub Actions run against a real PR.** Every module is unit- and integration-tested with fakes at the true I/O boundaries (shell, `cursor-agent`, GitHub API), and `main.ts`'s guard chain is smoke-tested against real webhook payloads — but the workflow itself has not executed on GitHub's runners.
- **No live `cursor-agent` review or fix invocation end-to-end.** The CLI's real contract (flags, JSON envelope, and its habit of wrapping JSON in prose) was established by running it directly during Phase 3 and is encoded in the parser and its regression fixtures; a full review-and-fix cycle against a real PR has not been run.

Both need infrastructure outside the development environment: an authenticated `gh`, a repository with real PRs, and Cursor API usage. They are the natural next step before this governs production traffic.
