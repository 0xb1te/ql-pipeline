# ql-pipeline

An AI-governed pull request pipeline, shipped as a reusable GitHub Actions workflow. It interprets conventional commits (`<type>(<area>): <description>`) to detect what changed, applies the matching per-area rule set, gates the PR behind build + test, reviews it with Cursor CLI, and then **merges**, **auto-fixes**, or **blocks** it — merging only into the branch its config designates.

- **What it must do:** [docs/SPECIFICATION.md](docs/SPECIFICATION.md) — the canonical contract, with every requirement mapped to its code and tests.
- **Adopting it in another repo:** [docs/integration-guide.md](docs/integration-guide.md).
- **Developing it:** [RULES.md](RULES.md) · [AGENT.md](AGENT.md).

## How a PR flows through it

```
PR opened / commit pushed
  ├─ targets a branch this pipeline doesn't govern? ──────────────► left untouched (no API calls, no AI spend)
  ├─ no conventional-commit header anywhere? ────────────────────► fail closed, explain why
  ├─ touches rules / prompts / config / workflows? ──────────────► needs-human (checked before the AI is consulted)
  ├─ build + test gates ─── required gate fails? ────────────────► findings, review skipped
  ├─ AI review (Cursor CLI, read-only) ── ungrounded findings ───► discarded
  └─ verdict
       ├─ MERGE ──► approve, merge (SHA-pinned), delete branch
       ├─ FIX ────► complaint + Cursor CLI fix commit ──► re-triggers this pipeline
       └─ BLOCK ──► complaint + needs-human
```

## Status

Feature-complete against the specification. Build-out and conformance tracked as tasks under `docs/`:

| Task | Scope | Status |
|---|---|---|
| [001](docs/001-first-task-base-project/plan.md) | Plan, rules, agent instructions | Done |
| [002](docs/002-phase1-skeleton/plan.md) | Skeleton: project setup, rule sets, prompts, config, CI | Done |
| [003](docs/003-phase2-routing/plan.md) | Routing: commit parser, router, gate runner, reusable workflow | Done |
| [004](docs/004-phase3-review/plan.md) | Review: Cursor CLI reviewer, verdict engine, merge engine | Done |
| [005](docs/005-phase4-fixloop/plan.md) | Fix loop: complaint format, Cursor CLI fixer, attempt counter | Done |
| [006](docs/006-phase5-hardening/plan.md) | Hardening: self-protection routing, audit trail, docs | Done |
| [007](docs/007-spec-conformance/plan.md) | Spec conformance: target-branch governance, rule overrides, required checks, and seven live-run bugs | Done |

263 tests across 24 files; the commit parser and verdict engine hold 100% branch coverage. **Not yet verified:** a live Actions run against a real PR, and a live `cursor-agent` review/fix cycle — see [SPECIFICATION.md §8](docs/SPECIFICATION.md).

## Repository layout

```
rules/*.rules              Per-area rule sets applied to incoming PRs (7 areas + _common)
prompts/*.md               Reviewer and fixer prompt templates (both run via Cursor CLI)
pipeline.config.yml        This repo's own config, and the annotated example of the schema
src/main.ts                Entrypoint: route → govern → self-protect → gate → review → decide → merge/fix/block
src/commit-parser/         Pure conventional-commit header parsing
src/router/                Pure routing decision, gate execution, self-protection check
src/rules/                 Rule resolution, including consumer per-area overrides
src/reviewer/              Cursor CLI review: prompt building, diff grounding, response parsing
src/verdict/               Pure MERGE / FIX / BLOCK engine and required-checks semantics
src/fixer/                 Attempt counting, complaint formatting, fix agent, protected-path revert
src/merger/                Target-branch resolution; approve + merge + delete-branch
src/shared/                Types, config, logger, GitHub client, exec, worktree snapshots, audit summary
tests/                     Mirrors src/; tests/integration/ holds the end-to-end and chaos-safety suites
.github/workflows/         pr-pipeline.yml (the reusable workflow) · dogfood.yml · self-check.yml
docs/                      SPECIFICATION.md, integration-guide.md, and one folder per task
```

## Development

```bash
npm ci && npm run typecheck && npm run lint && npm run build && npm test
```

Node 20+. `npm run test:coverage` reports branch coverage.
