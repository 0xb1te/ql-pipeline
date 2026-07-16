# Task 002 — Phase 1: Skeleton

| | |
|---|---|
| **Status** | 🟢 Approved (part of the phase 1–5 build-out approved in Task 001) |
| **Parent** | [docs/001-first-task-base-project/plan.md](../001-first-task-base-project/plan.md) §7 "Phase 1 — Skeleton" |

## Scope

Project scaffolding only — no routing, review, or fix logic yet (that's Tasks 003–005). Concretely:

- TypeScript/Node 20 project setup (strict mode, ESM, ESLint flat config, Vitest).
- `src/shared/` foundation: domain types (`types.ts`), a logger, and a config loader — genuinely complete and tested, not stubs, since everything downstream depends on them and they're self-contained enough to finish now.
- No placeholder folders for `commit-parser/`, `router/`, `reviewer/`, `verdict/`, `fixer/`, `merger/` yet — they're created in the phase that actually implements them, so nothing sits half-finished.
- Real, concrete rule sets for all 7 areas + `_common.rules`.
- Real prompt templates for the reviewer and fixer (both consumed by Cursor CLI per Task 001's decisions).
- `pipeline.config.yml` default/fallback config.
- `.github/workflows/self-check.yml`: this repo's own CI (lint, typecheck, test).

## Exit criteria (from the parent plan)

`npm run build && npm test` green. Rule sets are concrete and checkable (one rule per line, per RULES.md R6.2) — reviewed by @0xb1te at the next checkpoint.

## Notes

- Package manager: npm (lockfile committed).
- Module system: ESM (`"type": "module"`), `tsc` for build (no bundler needed — this runs inside CI via `node`, it isn't published).
- Test runner: Vitest (native TS/ESM, no transform step).
