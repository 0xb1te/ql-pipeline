# ql-pipeline

An AI-governed pull request pipeline, shipped as a reusable GitHub Actions workflow. It interprets conventional commits (`<type>(<area>): <description>`) to detect what changed, applies the matching per-area rule set, gates the PR behind build + test, and then reviews it with AI — merging, auto-fixing, or blocking based on the verdict.

Full design: [docs/001-first-task-base-project/plan.md](docs/001-first-task-base-project/plan.md).
Development process for this repo: [RULES.md](RULES.md) · [AGENT.md](AGENT.md).
**Adopting this in another repo? Start with [docs/integration-guide.md](docs/integration-guide.md).**

## Status

The Phase 1–5 build-out from Task 001's plan is complete, tracked as tasks under `docs/`:

| Task | Phase | Status |
|---|---|---|
| [001](docs/001-first-task-base-project/plan.md) | Plan, rules, agent instructions | Done |
| [002](docs/002-phase1-skeleton/plan.md) | Skeleton: project setup, rule sets, prompts, config, CI | Done |
| [003](docs/003-phase2-routing/plan.md) | Routing: commit parser, router, gate runner, reusable workflow | Done |
| [004](docs/004-phase3-review/plan.md) | Review: Cursor-CLI reviewer, verdict engine, merge engine | Done |
| [005](docs/005-phase4-fixloop/plan.md) | Fix loop: complaint format, Cursor CLI fixer, attempt counter | Done |
| [006](docs/006-phase5-hardening/plan.md) | Hardening: self-protection routing, audit trail, docs | Done |

The pipeline routes, labels, gates, AI-reviews, auto-merges clean PRs, auto-fixes fixable findings (up to a configured attempt limit before escalating to a human), and refuses to auto-merge or auto-fix changes to its own governance paths. What's genuinely unverified: a live run against a real GitHub PR and a live `cursor-agent` invocation end-to-end — see [docs/006-phase5-hardening/plan.md](docs/006-phase5-hardening/plan.md)'s closing note for exactly what that would take.

## Repository layout

```
rules/*.rules            Per-area rule sets applied to incoming PRs (frontend, backend, mobile, ios, android, infrastructure, docs)
prompts/*.md             Reviewer and fixer prompt templates (both run via Cursor CLI)
pipeline.config.yml      Default/fallback pipeline configuration — gates, merge settings, fix-loop limits
src/main.ts              Entrypoint the reusable workflow runs: route, self-protect, gate, review, decide, merge/fix/block
src/commit-parser/       Pure conventional-commit header parsing
src/router/              Pure routing decision, gate execution, and the self-protection check
src/reviewer/            Cursor-CLI review: prompt building, diff grounding, response parsing, orchestration
src/verdict/             Pure MERGE / FIX / BLOCK decision engine
src/fixer/               Attempt counting, complaint formatting, Cursor-CLI fix agent, protected-path revert
src/merger/              Approve + merge + delete-branch on a MERGE verdict
src/shared/              Domain types, config loader, logger, GitHub client, shared exec utility, audit summary
tests/                   Unit + integration tests for src/, mirroring its structure (tests/integration/ has the end-to-end and chaos-safety suites)
.github/workflows/       self-check.yml (this repo's CI); pr-pipeline.yml (the reusable workflow); dogfood.yml (calls it for this repo's own PRs)
docs/NNN-*/              One task folder per unit of work, each with its own plan.md
docs/integration-guide.md  How a consumer repo adopts the reusable workflow
```

## Development

```
npm ci
npm run typecheck
npm run lint
npm run build
npm test
```

Node 20+ required. See [RULES.md](RULES.md) for the commit/branch/PR conventions this repo follows, and [AGENT.md](AGENT.md) if you're an AI agent working on it.
