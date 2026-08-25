# Task 008 — Modular checks

| | |
|---|---|
| **Status** | 🟢 Done |
| **Goal** | Split the single `govern` job into three independent GitHub checks — **test**, **build**, **ql-pipeline** — in that order, and modularize the code behind them. |

## Why

Everything the pipeline did lived in one job, so a PR got exactly **one** check. You couldn't see at a glance whether it was the tests, the build, or the AI review that failed; you had to open the run log. Branch protection could only require all-or-nothing.

## What changed

### Three jobs, three checks

| # | Check | Command it runs |
|---|---|---|
| 1 | `test` | `main.js gate --stage test` |
| 2 | `build` | `main.js gate --stage build` |
| 3 | `ql-pipeline` | `main.js govern --reports gate-reports` |

`build` runs only if `test` passed (`needs: test`) — fastest path to the first real failure. **`ql-pipeline` runs even when a gate is red**, guarded by `if: ${{ !cancelled() }}`.

### Code modularization

`main.ts` was a 290-line linear script. It is now a thin dispatcher over:

- **`src/cli/command.ts`** — argv → `Command`. Deliberately separate from `main.ts` so importing the parser can never execute the CLI as a side effect (which it did, briefly, and broke a test run).
- **`src/cli/bootstrap.ts`** — `createPipelineContext()` (credentials, config, PR, client) and `resolveRouting()` (the governance pre-check, routing, and target-branch resolution). Shared by all three jobs so they can't drift apart on setup.
- **`src/cli/gate-command.ts`** — run one stage, write its report.
- **`src/cli/govern-command.ts`** — everything after the gates.
- **`src/shared/gate-report.ts`** — the serialized contract between jobs.

## The design decision that mattered

**A red gate must not halt the chain.** The obvious wiring — `ql-pipeline` `needs: [test, build]` with default behaviour — skips the pipeline job whenever a gate fails. That would have quietly destroyed a core feature: a failing build is turned into a `must` finding and handed to the fix agent, which is exactly the "the AI will need to build so it does not crash on production" requirement. Under the obvious wiring, a broken build would get no complaint, no fix attempt, and no comment — just a red check and silence.

So the gate jobs **report** rather than **gate**: each writes a `gate-report-<stage>` artifact and the pipeline job reads them, reconstructing the same `GateOutcome[]` the single-job version had in memory. The chain's shape changed; the semantics did not.

Consequences worth stating:

- **Absent ≠ passed.** A skipped `build` job leaves no artifact. `readGateReports` treats that as "this stage did not report" and invents no finding — the pipeline never claims a build passed when it never ran.
- **Corrupt ⇒ fail closed.** A present-but-unparseable report escalates to a human. Merging while unable to tell whether the tests passed is exactly the failure mode the rest of the design exists to prevent.
- **Gate output is truncated to 4 000 characters, tail-first.** It rides into the reviewer prompt and into finding text, so an unbounded build log would blow up the prompt. Compilers and test runners put the real errors at the end.

## Other decisions

- **Each job routes independently** instead of one job routing and passing outputs downstream. It costs one API call per job, and in exchange every check reports the truth about the PR in front of it rather than inheriting a verdict from a job that may have been skipped.
- **Only `ql-pipeline` installs the Cursor CLI** and configures a git identity. The gate jobs need neither, and they're the ones on the critical path to first feedback.
- **The gate jobs' checks reflect reality; `required_checks` controls pipeline blocking.** These are now visibly two different things, so the integration guide states the interaction explicitly rather than leaving users to discover that a green-but-not-required stage can still let the pipeline approve.
- **Test before build**, per the requested order. Worth noting for adopters whose test command needs a build first — for those repos the build belongs inside the test command, or the two should be swapped in config.

## Cost

Three jobs mean three checkouts and three `npm ci && npm run build` of ql-pipeline itself (npm cache keyed on its lockfile absorbs most of it). That's the inherent price of independent checks; it buys per-stage visibility and per-stage branch protection.

## Verification

`npm run typecheck && npm run lint && npm run build && npm test` green — **311 tests across 29 files**.

Smoke-tested against real webhook payloads, not just fakes:
- `main.js` with no arguments prints usage and fails.
- `gate --stage test` on an out-of-scope PR logs why, writes a valid empty report, and exits 0.
- `govern --reports <dir>` reads that report directory and exits 0 on the same PR.
- The workflow's job graph was parsed and asserted: `test` (no deps) → `build` (`needs: test`) → `ql-pipeline` (`needs: [test, build]`, `if: !cancelled()`).

Verification boundary unchanged from [SPECIFICATION.md §8](../SPECIFICATION.md): no live Actions run, no live `cursor-agent` cycle.
