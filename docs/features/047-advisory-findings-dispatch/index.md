# 047 — Advisory Findings Get An Agent Too

## What

A `should` finding now dispatches a fix agent instead of sitting in a thread that belongs to nobody.

When nothing blocks but advisory findings stand, `decidePipelineOutcome` returns `FIX` over those findings instead of `MERGE`. That reuses the whole existing path — the complaint review, the threads, the pickup announcement, attempt counting, the fork and provider guards, and the retrigger on push.

New config key `fixer.fix_advisory`, on by default.

## Why It Matters

The behaviour this replaces was structural, not a misconfiguration. `runGovern` returns inside `if (decision.kind === 'MERGE')` at `govern-command.ts:696`, which is *above* `recordComplaint` (`:729`) and `runFix` (`:801`). So a `should` finding was computed, posted as an inline comment, and then nothing in the pipeline ever looked at it again.

ql-desktop [#103](https://github.com/0xb1te/ql-desktop/pull/103) is the case: seven findings across two runs, every one of them `should`, none of them assigned to anybody. They were eventually fixed by hand.

## An Advisory Finding Still Never Blocks

Every guard on the new path falls back to **MERGE**, never to BLOCK:

| Situation | Verdict |
|---|---|
| Attempts spent | MERGE, findings reported as before |
| Any advisory finding is not `autoFixable` | MERGE |
| `fixer.fix_advisory: false` | MERGE |
| A gate finding is mixed in | MERGE |

A `should` finding was a comment before this and goes back to being one the moment there is nothing left to try. What changes is that somebody is assigned to it — not whether it stands in the way.

## The Distinction That Took The Longest

Two different things produce a `should` finding, and only one of them is an invitation to send an agent.

- **The review** calls a finding `should` because it judged it minor.
- **`required_checks`** makes a *failed gate* `should` because an operator left that gate out of the required list. That is an instruction — "report this, do not act on it".

`gateFindings` builds both from the same shape, with `autoFixable: true`, so the first implementation dispatched on both. That was caught by an existing test whose name states the intent outright: *"a failed non-required gate rides along as advisory and still merges."*

Gate findings are excluded by their `gate#` rule prefix, and the existing test passes unchanged — which is the evidence the exclusion is right rather than convenient. A mixed set declines **entirely** rather than dispatching the reviewable half: `FIX` empties `advisoryFindings`, and the merge path is the only thing that posts it, so a split would report the gate nowhere at all.

## What Will Not Change

- Blocking findings decide first and exactly as before. A `must` finding still produces the same FIX or BLOCK, and advisory findings still ride along beside it.
- `max_fix_attempts` bounds the advisory path identically. Without it, a review that raises a fresh nit each pass would dispatch on every pass forever.
- A repository that would rather read its own nits sets `fixer.fix_advisory: false` and gets the old behaviour exactly.

## Status

| Gate | Closed | Date |
|---|---|---|
| Gate 1 — plan approved | `YES` | `2026-09-22` |
| Gate 2 — result approved | `pending` | `—` |
| Gate 3 — verified in production | `pending` | `—` |

- **Branch:** `features/047-advisory-findings-dispatch`, cut from `main` at `9b340e1`
- **Task:** [Advisory findings dispatch an agent too](https://app.notion.com/p/Advisory-findings-dispatch-an-agent-too-3e3d2993e9a981af91f8ee9fc0090b26) on `QL Desktop-sprint-2`
- **Gate note:** Gate 3 is a governed PR whose review raises only advisory findings — ql-desktop #103 is exactly that, and reopening it after this merges is the intended check.

## Known Hazard, Filed Separately

`countFixAttempts` counts commits whose header ends `[bot]`, which `runFix` writes. `runAgentsFix` does not commit — **ql-agents does**, with its own message — so under the `ql_agents` provider the counter reads 0 forever and `max_fix_attempts` never trips. That was survivable while only blocking findings dispatched; it matters more now that advisory ones do. It does not affect ql-desktop, which uses the default `cursor` provider.
