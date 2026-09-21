# 041 — Check The Task Folder, And Build The Tester That Reads It

## What

The ql-pipeline half of the automated-tester work whose standards landed in ql-docs:

1. **A structural check.** Before any model is asked anything, the pipeline verifies that the task folder the branch names carries `testing-plan.xlsx` and `seed.sql`.
2. **A review criterion.** The AI review now judges whether the feature a pull request adds is reachable over MCP, and whether the test plan covers that surface.
3. **The tester itself.** A reader for the pinned `MCP Cases` sheet, a client for the preview's MCP server, and a runner that drives every case and reports every failure in **one** comment.
4. **A fifth CI job**, `preview-tester`, committed and deliberately switched off.

## Why

A reviewer reads a diff and forms an opinion; nothing currently exercises the feature. This is the machinery that does — but it can only test what it can reach, against data that exists, using a plan it can parse. Points 1 and 2 are how those three preconditions stop being conventions that decay.

The one-comment rule is the part worth defending. A per-case comment turns a twenty-case plan into twenty notifications and hands the fix agent twenty separate prompts for what is usually one root cause. It also hides the failures that only make sense read together — three cases failing on the same absent fixture is one finding about seed data, not three about three tools.

## What The User Will See

- A pull request whose task folder is missing its test plan or seed data gets a finding saying which file, and where to copy it from. **Advisory by default.** It blocks only in a repository that has listed `task-artifacts` in `merge.required_checks`.
- The AI review starts flagging features that ship with no MCP surface, and MCP surfaces the test plan does not cover.
- Nothing else changes yet. The tester job is off.

## What Will Not Change

- **No pull request that passes today starts failing.** The artifact check ships advisory everywhere, by deliberate design — a check that blocks the day it lands turns every in-flight pull request red at once and hands every author the same repair job.
- The four existing jobs are untouched. `preview-tester` is `if: false` and cannot run.
- No new runtime dependency. The xlsx reader and the MCP client are written, not installed — this repository has four runtime dependencies and a spreadsheet library would have been the largest.

## Status

| Gate | Closed | Date |
|---|---|---|
| Gate 1 — plan approved | `pending` | `—` |
| Gate 2 — result approved | `pending` | `—` |
| Gate 3 — verified in production | `pending` | `—` |

- **Branch:** `features/041-mcp-tester-checks`, cut from `main` at `f35fba0`
- **Notion:** closes two cards on *QL Desktop-sprint-2* — `TESTERFEATURE: Require every feature to be reachable over MCP, and check it` (Part 3) and `TESTERFEATURE: Drive the preview over MCP and report every failure in one comment`.
- **Depends on:** `0xb1te/ql-docs#11`, which defines the `MCP Cases` sheet this parses and the artifacts this checks for. The column set is a shared contract; the two change together.
- **Gate note:** delivered from a written instruction that pre-scoped the work and chose the gated-job treatment for the tester. No Gate-1 or Gate-2 presentation-and-YES cycle was run, so neither is recorded as closed. `summary.md` is deliberately absent until a human says to ship.
