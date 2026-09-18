# Task 024 — Add a `tooling` area to the commit grammar

| | |
|---|---|
| **Status** | In progress |
| **Goal** | Give build, type-check and test-harness work an area that routes it to a checklist written for it, instead of forcing it into a product area whose checklist does not apply. |

## Why

The area is not a label. `reviewPackEntries` turns it into `workflow/review/<kind>/<area>.md`, which is the checklist the AI reviewer judges the diff against. Choosing an area therefore chooses a standard.

Seven areas existed, all shaped for a frontend-plus-backend web app, and none of them for "how this repository is built and checked". So work of that shape gets filed under whichever product area its files happen to live in. A concrete recent case in ql-desktop: a three-line fix to a `tsconfig` module-resolution error went in as `fix(frontend)` because the file sat under `src/components/`. Governance routed it `frontend` from the header, added `backend` and `docs` from the changed paths, and loaded three product checklists to judge three lines of module resolution.

That is not a mislabelled commit. It is correct work reviewed against the wrong standard, and the reviewer's findings are worth less because of it.

## Scope

`tooling`: how the repository is built, type-checked, linted and tested — build and compiler configuration, linter configuration, test harness and fixtures, lockfiles, local dev scripts. Anything that changes how the repo is *checked*, without changing what the product *does*.

The boundary that will be got wrong is against `infrastructure`, so it is stated in one line everywhere it appears:

> `infrastructure` is how the product runs somewhere. `tooling` is how the repository is checked here.

A deploy workflow is the first. A `tsconfig` that decides which files get compiled is the second.

### Not in scope

- **No other new areas.** `desktop` and `cli` were considered and rejected: the existing `frontend`/`backend` split maps cleanly onto an Electron renderer and main process once it is written down, and every added area costs three review packs plus a line in every consumer's mental model. One addition, justified.
- **No change to `COMMIT_TYPES`.** `build`, `ci` and `test` already exist and already carry the right meaning; what was missing was anyone saying when to use them.
- **The overlap between `templates/cursor-rules/` and ql-docs' generated always-on set** — both now ship `00-house-workflow`, `01-task-format` and `02-commits-and-prs`. This task keeps them consistent on the area list rather than resolving the duplication, which wants its own decision. See Follow-ups.

## The ordering hazard

`AREAS` feeds `allReviewDocumentPaths()`, and `doctor` walks every area against every review kind and reports each missing `workflow/review/<kind>/<area>.md`. Adding `tooling` here **before** the packs exist upstream turns `ql-pipeline doctor` into three new missing-document lines for every governed repository at once.

So the packs land first: ql-docs `features/018-general-rules-and-mcp-install` ([#7](https://github.com/0xb1te/ql-docs/pull/7)) carries `pr-feature/tooling.md`, `pr-fix/tooling.md` and `pr-bugfix/tooling.md`. **That merges before this does.**

The packs are short and hand-written rather than quoted from a stage checklist, following `docs.md` — no build stage owns this material, so there is nothing to quote. `check_review_packs.py` only verifies files carrying a `=====` provenance marker, so it ignores them by design.

## Design

| File | Change |
|---|---|
| `src/shared/types.ts` | `'tooling'` into `Area` and `AREAS`, before `'docs'`. The doc comment gains why the area exists, the `infrastructure` boundary, and the ordering hazard above — the next person to add an area needs to find that before they add one, not after. |
| `tests/commit-parser/commit-parser.test.ts` | The hardcoded area list gains `tooling`, plus a new test asserting that list equals `AREAS`, so the two cannot drift. |
| `RULES.md` R2 | The grammar line, the area-picking rule, the `build`-not-`fix` rule, and a pointer to GR-02 as the source of truth. |
| `docs/integration-guide.md` | The grammar line consumers read. |
| `templates/cursor-rules/.cursor/rules/02-commits-and-prs.mdc` | The grammar line, plus the area and type tables — this is what a consumer's editor actually carries. |

No change to `areas.paths` defaults: path-based detection stays opt-in per consumer, so nothing starts routing to `tooling` by path until someone configures it. The header is the only way in for now, which is the conservative order.

## Exit criteria

- [ ] `parseCommitHeader('build(tooling): x')` returns area `tooling`.
- [ ] The commit-parser area list and `AREAS` are asserted equal.
- [ ] `pnpm typecheck && pnpm lint && pnpm build && pnpm test` green.
- [ ] Every place that spells the grammar out carries the same eight areas — `RULES.md`, `docs/integration-guide.md`, the Cursor template, and ql-docs GR-02.
- [ ] `doctor` reports no missing standards documents against a `.standards` checkout that has the three new packs.
- [ ] **Unchanged:** the seven existing areas parse exactly as before; no consumer config change is required.

## Follow-ups

- **ql-pipeline's `templates/cursor-rules/` duplicates ql-docs' generated always-on rules.** ql-docs now renders `00-house-workflow`, `01-task-format`, `02-commits-and-prs` (plus versioning and suite-MCP) from one source with a CI check. ql-pipeline ships its own hand-maintained copies of the first three. Two copies of the same rule with nothing comparing them is the exact failure that corrupted the review packs. The likely resolution is for ql-pipeline to keep only its glob-attached area rules (`10-frontend`, `20-backend`, `21-sql-migrations`, `22-testing`) and let ql-docs own the always-on set.
- **Those area rules reference stage folders ql-docs renamed** — `stage-8-polish` and `stage-10-feature`, now `stage-9-polish` and the flows. Wrong for some time; a bugfix of its own.
