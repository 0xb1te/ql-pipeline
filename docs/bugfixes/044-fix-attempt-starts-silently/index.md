# 044 — A Fix Attempt Started With No Sign It Had Started

## What

On a `FIX` verdict the pipeline runs `cursor-agent` for several minutes. Until this change, nothing on the pull request said so.

The signal was technically present. `runGovern` posts the `### ql-pipeline summary` comment at `govern-command.ts:630` and does not call `runFix` until `:800`, so the line **`Decision: FIX (attempt 1 of 3)`** is written *before* the agent starts. It just never read as an announcement — it names a verdict, not an activity, and it pointed nowhere.

The summary now says a fix agent is starting, how many blocking findings it has, and links the Actions run. It also says that pushing cancels the attempt.

## Why It Matters

The gap between that comment and the `Attempt 1 of 3: pushed …` replies is the whole fix attempt, and during it the pull request looks abandoned. A person watching has no way to tell a running agent from a stuck job.

The cancellation is the sharper half. Consumers set `concurrency.cancel-in-progress: true`, so pushing to the branch kills a fix attempt mid-run. Nothing on the pull request records that — the run is simply cancelled and the thread replies never arrive. Announcing an attempt without saying it can be killed would have been a worse comment than none, so the warning ships with the announcement.

## Why It Is In This Comment And Not A New One

Because a second comment would not be a status update — it would be an instruction.

Pull-request comments are fed to the fix agent as human direction (`govern-command.ts:533`). Bugfix `043` had just stopped the pipeline's own comments from arriving there, and posting a fresh "working on it" comment each run would have walked straight back into it — either re-entering the agent's prompt, or needing the `043` marker to exempt it, at which point it is a comment nobody reads and the agent ignores.

The comment that is already posted, already stamped and already dropped by the guard is the right place.

## How It Was Found

Alongside `043`, reading `runGovern` end to end to answer who repairs a review finding. The ordering — summary at `:630`, fix at `:800` — is what showed that the pre-fix signal existed and was simply illegible.

## Why Wasn't This Caught

Nothing was broken, so nothing failed. `formatAuditSummary` rendered every field it was given, and its test suite asserted each one. The defect was a field that was never passed: no part of `src/` read `GITHUB_RUN_ID` or `GITHUB_SERVER_URL`, so the run this pipeline executes in was not a thing the code knew about at all.

That is invisible to a unit test by construction — you cannot assert the absence of a value nobody thought of.

**Prevention:** `actionsRunUrl` is a pure function over an env record with its own tests, including the null path, so the run URL is now a value the surface has rather than an ambient fact. `formatAuditSummary` stays pure — `auditSummary.yml` declares `pure: true` with empty receptors and effectors, and the environment is read in `bootstrap.ts`, which is the only place on this surface that reads `process.env` at all.

## What Will Not Change

- No new comment, no new label, no extra API call. One more paragraph in a comment that was already being posted.
- The verdict, the findings, the fix loop and the attempt counting are untouched.
- Outside Actions — a local run, a test — there is no run to link and the announcement simply carries no URL, rather than a link built from absent values.

## Status

| Gate | Closed | Date |
|---|---|---|
| Gate 1 — plan approved | `YES` | `2026-09-22` |
| Gate 2 — result approved | `pending` | `—` |
| Gate 3 — verified in production | `pending` | `—` |

- **Branch:** `bugfixes/044-fix-attempt-starts-silently-3e3d29`, cut from `main` at `7887f5d`
- **Task:** [A fix attempt starts with no sign it started](https://app.notion.com/p/A-fix-attempt-starts-with-no-sign-it-started-3e3d2993e9a981b2929bcd55928cfeac) on `QL Desktop-sprint-2`
- **Depends on:** `043` (merged as `7887f5d`). Both bump `package.json`; `043` took `0.3.1`, this takes `0.3.2`.
- **Gate note:** Gate 1 was presented in full and closed with an explicit YES before any source file was edited. Gate 3 needs a real `FIX` verdict to observe, which no run has produced since this merged.
