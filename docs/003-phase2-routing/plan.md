# Task 003 — Phase 2: Routing

| | |
|---|---|
| **Status** | 🟢 Approved (part of the phase 1–5 build-out approved in Task 001) |
| **Parent** | [docs/001-first-task-base-project/plan.md](../001-first-task-base-project/plan.md) §7 "Phase 2 — Routing" |

## Scope

- **`src/commit-parser`**: pure grammar parser for a single conventional-commit header (`<type>(<area>): <description>`) plus a batch helper for a PR's full commit list. No fallback/policy logic here — that's routing.
- **`src/router`**: pure `determineRoute()` combining parsed commits (falling back to the PR title if no commit header parses) with `pipeline.config.yml` to produce a `RouteDecision` (matched types/areas, rule files to load, gate commands to run) or an "unroutable" result.
- **`src/router/gate-runner.ts`**: executes the build/test commands a `RouteDecision` names. Config-defined command strings run through a shell (they legitimately need `&&`/pipes and come from a trusted, R4-protected file, not PR content); the executor is injectable so unit tests never actually shell out.
- **`src/shared/github-client.ts`**: thin Octokit wrapper for the handful of calls Phase 2 needs (PR commits, PR title, add labels).
- **`src/main.ts`**: the entrypoint the reusable workflow runs — loads config, reads PR context, parses + routes, runs gates, labels the PR with its matched area(s). Fails closed (non-zero exit) on an unroutable PR or a failed gate; there's no verdict/merge/fix engine yet (Phases 3–4), so "gates passed and routed" is as far as this phase goes.
- **`.github/workflows/pr-pipeline.yml`**: the reusable workflow (`on: workflow_call`) per the contract in the parent plan §4.8, now with real steps — checkout consumer repo, checkout ql-pipeline at `inputs.ql-pipeline-ref`, install/build, run `main.ts`.

## Design notes

- **Lenient multi-commit parsing**: a PR commit that doesn't match the grammar (a "wip" commit, a merge commit) is skipped, not treated as fatal, as long as at least one commit in the PR *does* parse. Only when **zero** commits parse does the router fall back to the PR title; if that also fails to parse, the PR is unroutable → BLOCK. This matches real commit history (noise commits happen) without weakening the "every routed PR has a real conventional-commit signal" guarantee.
- **Shell usage boundary (RULES.md R5.4)**: gate commands from config are trusted strings and may use shell operators (`npm ci && npm run build`); PR-derived content (diffs, complaint JSON — Phase 3/4) must never be spliced into a shell string, and is passed as a distinct argv element instead. Both rules serve the same goal — untrusted PR content must never reach a shell parser — applied to two different, correctly-scoped inputs.
- Self-protection routing (R4 paths always → human) is explicitly **Phase 5**, not this phase — `RouteDecision` here only reflects area/gate matching.

## Exit criteria (from the parent plan)

A test PR gets correctly routed, gated, and labeled with its area. Commit parser and router carry the 100%-branch-coverage bar from RULES.md R3.2.

## Verification boundary

`gh` isn't authenticated in this environment and no real PR exists to run the reusable workflow against, so this phase is verified via unit tests (parser/router/gate-runner, all with injected fakes — no real shell/network calls) plus `npm run build`. The GitHub Actions YAML and the `github-client`/`main.ts` wiring are written correctly against the documented Octokit/Actions contracts but are not live-run in this session.
