# AGENT.md — Instructions for AI agents working on ql-pipeline

You are working on **ql-pipeline**: a versioned, self-contained DevOps pipeline that governs pull requests, shipped as a **GitHub reusable workflow** other repos call by reference. It interprets conventional commits to detect the change area, applies that area's rule set (`rules/<area>.rules`), reviews the PR with AI, gates it behind build + tests, and then **merges**, **fixes** (via a Cursor CLI fix agent that pushes corrective commits), or **blocks** the PR. Full design: [docs/001-first-task-base-project/plan.md](docs/001-first-task-base-project/plan.md).

## Before you touch anything

1. Read [RULES.md](RULES.md) — it is binding and wins over this file on conflict.
2. Read the `plan.md` of the task you are working on (`docs/NNN-*/plan.md`). If no approved plan covers your work, **stop and write one first** (rule R1).
3. Check `pipeline.config.yml` and the relevant `rules/*.rules` before changing behavior — most behavior changes belong in config/rules (data), not in `src/` (code).

## Project map

| Path | What it is | May you edit it? |
|---|---|---|
| `docs/NNN-*/` | Task folders: plans, decisions | Yes — this is where work starts |
| `src/` | Pipeline implementation (TypeScript, Node 20, strict) | Yes, with tests |
| `tests/` | Unit/integration tests | Yes — required for any `src/` change |
| `rules/*.rules` | Rule sets applied to incoming PRs (shipped defaults) | Only with explicit human approval (R4) |
| `prompts/*` | Reviewer/fixer prompt templates for Cursor CLI | Only with explicit human approval (R4) |
| `pipeline.config.yml` | Default/fallback pipeline config | Only with explicit human approval (R4) |
| `.github/workflows/` | Reusable workflow, dogfood caller, self-check CI | Only with explicit human approval (R4) |
| `docs/integration-guide.md` | Consumer-repo adoption guide | Yes, keep in sync with the `workflow_call` contract |

## How to work

- **Branch**: `task/NNN-short-slug`. Never push to `main`.
- **Commits**: conventional format, `<type>(<area>): description`. Pipeline work is `infrastructure`; documentation is `docs`. Example: `feat(infrastructure): add commit parser with area routing`.
- **Verify before PR**: `npm run lint && npm run typecheck && npm test` must be green locally. If you changed runtime behavior, exercise it (run the affected module against a fixture PR diff), don't just rely on unit tests.
- **PR description**: link the task folder, state what changed and how you verified it. If you touched R4-protected paths, say so prominently.

## Architecture invariants (do not break)

1. **Decision logic is pure.** `commit-parser`, `router`, and `verdict` take data in, return data out — no network, no GitHub API, no filesystem. I/O belongs in `shared/`, `merger/`, `fixer/`.
2. **Rules are data.** Reviewer behavior changes by editing `.rules` files, not by hardcoding checks in `src/reviewer`.
3. **The loop must terminate.** Any code path in the fix loop must respect `max_fix_attempts` (3) and end in MERGE or BLOCK — never in silent retry.
4. **Findings must be grounded.** Reviewer findings that cite files/lines not in the diff, or rule IDs that don't exist, are discarded, not repaired.
5. **The pipeline never edits its own laws.** The fixer's checkout is hard-reverted on `rules/`, `prompts/`, `pipeline.config.yml`, and `.github/workflows/` before any commit — structurally, not just by prompt instruction (RULES.md R4.2).
6. **Reviewer is read-only, structurally.** The reviewer runs from a checkout it has no reason to write to; if it does, the run hard-fails to BLOCK rather than silently trusting output from a reviewer that just proved it can mutate state.
7. **Fail closed.** Unparseable commits, malformed AI verdicts, gate crashes → BLOCK with an explanatory comment, never MERGE by default.
8. **This is a reusable workflow, not a library to vendor.** Consumer repos call `.github/workflows/pr-pipeline.yml` via `uses:`; they never copy `src/` or `rules/` into their own tree. Keep the `workflow_call` inputs/secrets contract stable — it's a public interface once another repo depends on it.

## Behavioral expectations

- If a plan is ambiguous or two rules conflict, ask in the task/PR thread instead of guessing.
- Report failures honestly: failing tests, skipped steps, and partial work are stated plainly in the PR.
- Never store or echo secrets; provider keys (`CURSOR_API_KEY`) and the GitHub token exist only as GitHub Actions secrets.
- Keep changes inside the task's scope; anything out-of-scope you notice goes into the PR description or a new task proposal, not into the diff.

## Quick reference

- Conventional commit grammar and allowed areas: [RULES.md](RULES.md) R2.
- Verdict semantics (MERGE / FIX / BLOCK): [plan.md §4.5](docs/001-first-task-base-project/plan.md).
- Complaint format and fix-agent contract, incl. protected-path revert: [plan.md §4.6](docs/001-first-task-base-project/plan.md).
- Reusable workflow contract (`workflow_call` inputs/secrets, consumer caller snippet): [plan.md §4.8](docs/001-first-task-base-project/plan.md).
