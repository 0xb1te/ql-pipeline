# RULES.md — Development rules for ql-pipeline

These rules govern how **this repository** (the pipeline itself) is developed — by humans and by AI agents alike. They are distinct from `rules/*.rules`, which are the rule sets the pipeline applies to *incoming PRs* once built.

> On approval of [plan.md](plan.md), this file moves to the repository root.

## R1 — Task workflow

1. **Every unit of work is a task.** A task lives in `docs/NNN-short-slug/` with a `plan.md` inside.
2. **Plan before code.** No implementation starts until the task's `plan.md` exists and has been approved by the repo owner. The plan states goal, scope, design, and exit criteria.
3. **One task, one PR** (small follow-up PRs to the same task are fine). The PR description links to the task folder.
4. Task numbers are sequential and never reused (`001`, `002`, …).

## R2 — Commits and branches

1. **Conventional commits are mandatory**, using exactly this grammar:
   ```
   <type>(<area>): <description>
   type ::= feat | fix | refactor | perf | chore | docs | test | ci | build | revert
   area ::= frontend | backend | mobile | ios | android | infrastructure | docs
   ```
   For work on the pipeline itself, use `infrastructure` (pipeline code, workflows, config) or `docs` (plans, rules, documentation).
2. **No direct pushes to `main`.** All changes arrive via PR from a feature branch named `task/NNN-short-slug`.
3. Bot/fix-agent commits carry the `[bot]` suffix in the description and must reference the complaint they resolve.
4. Commit descriptions are imperative, lowercase, no trailing period.

## R3 — Code quality

1. **TypeScript strict mode**; `any` is forbidden in `src/` (use `unknown` + narrowing).
2. Every module in `src/` ships with unit tests in `tests/`; the verdict engine and commit parser require **100% branch coverage** (they are the pipeline's brain — an untested branch is an unreviewed law).
3. Lint (`eslint`) and typecheck must pass locally before opening a PR; CI (`self-check.yml`) re-verifies.
4. Pure functions over side effects: decision logic (routing, verdicts) must be pure and testable without network or GitHub API access. All I/O lives at the edges (`shared/`, `merger/`, `fixer/`).
5. No dead code, no commented-out code, no TODOs without a linked task.

## R4 — Pipeline self-governance (the constitution clause)

1. Changes to `rules/*.rules`, `prompts/*`, `pipeline.config.yml`, or `.github/workflows/*` **always require explicit human approval** — the pipeline must never auto-merge changes to its own laws, and the fix agent must never edit these paths.
2. Every rule file carries a `version:` field; bump it on any semantic change and note the change in the PR description.
3. Prompt changes (`prompts/*`) must include a before/after example of reviewer or fixer output in the PR description.

## R5 — Security

1. No secrets, tokens, keys, or provider credentials in the repository — ever, including in tests, fixtures, and docs. Use GitHub Actions secrets.
2. Workflow tokens are least-privilege and fine-grained; the fix agent's token can write to PR branches only.
3. Dependencies are pinned (lockfile committed); new runtime dependencies require justification in the PR description.
4. Any code path that shells out (gate runner, Cursor CLI invocation) must pass arguments as arrays — never string-interpolated shell commands.

## R6 — Documentation

1. `README.md` stays current with the actual behavior of the pipeline; if a PR changes behavior, it updates the README in the same PR.
2. Every `rules/*.rules` file is self-documenting: each rule is one line, concrete, and checkable against a diff. Vague rules ("write good code") are rejected in review.
3. Decisions that reverse or amend an approved plan are recorded in the task folder as `decisions.md`, not silently applied.

## R7 — AI agents working on this repo

1. Agents follow [AGENT.md](AGENT.md) and this file; where they conflict, RULES.md wins.
2. Agents never merge, tag, or push to `main` directly; they open PRs like everyone else.
3. Agents state uncertainty instead of inventing behavior: if a plan is ambiguous, the agent asks in the PR/task thread rather than guessing.
