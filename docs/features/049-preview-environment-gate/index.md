# 049 — Fail A Pull Request Whose Repository Cannot Be Previewed

## What

The preview environment contract, enforced rather than advised. A repository that contains `apps/*frontend*` or `apps/*backend*` must carry `infrastructure/docker/environments/devops/docker-compose.yml`, and that file must be structurally sound: exactly one entry service named `edge`, no published host ports on any service, and an `env.example` beside it. A pull request on a product repository that fails any of that **fails before review**, with a comment naming every violation and the ql-docs node the rules live in.

The same verdict is reported by `ql-pipeline doctor`, so an author finds out before opening a pull request rather than on it.

## Why

Two tasks downstream of this one can only work against that folder. The preview deploy job hands it to ql-proxy as the build root; the automated tester reaches the application's MCP server inside the stack it boots. A repository without it cannot be deployed for review or tested by an agent, and a contract nobody enforces decays the first week nobody looks.

It is checked structurally, before a model is asked anything, for the same reason RULES.md R4 is: whether a folder exists and its compose file names an `edge` service is not a matter of opinion, and a reviewer is the wrong enforcement mechanism for a rule that cannot be argued with.

## What The User Will See

- **A product repository with no devops folder** gets one comment on its pull request — *This repository cannot be previewed, so this pull request fails before review* — listing what is missing, and the `checks / ql-pipeline` check goes red. No `needs-human` label: nobody has to adjudicate a missing folder, its author adds it.
- **A product repository with a malformed folder** gets every violation in that one comment, not the first one found.
- **`ql-pipeline doctor`** gains a `preview environment` line: *not required* for a repository with no product apps, *satisfies the preview environment contract*, or `FAIL` with the violations and a pointer to the contract node.
- **An R4 escalation** on a product repository also carries the preview verdict, so a person summoned to review a governance change sees that the repository cannot be previewed while they are already looking.

## What Will Not Change

- **A repository with neither `apps/*frontend*` nor `apps/*backend*` is unaffected**, whatever else it lacks. ql-pipeline itself has no `apps/` directory and passes untouched — this pull request is the first proof.
- Which directories count as product apps is decided by the existing `areas.paths` globs, not by a second list. A repository that has told the pipeline where its apps live is measured against that.
- The rules are **not restated here**. They are written once, in ql-docs `workflow/rules/stage-8-deployment/` — the *Preview environment contract* node, which absorbs `14-preview-database-seeding`. Both the pull request comment and the doctor line cite it by path.
- The task-artifact check, the R4 guard, the gates, the review and the verdict are untouched. This adds one structural check beside the two that already run before the AI.

## Status

| Gate | Closed | Date |
|---|---|---|
| Gate 1 — plan approved | `YES` | `2026-09-22` |
| Gate 2 — result approved | `pending` | `—` |
| Gate 3 — verified in production | `pending` | `—` |

- **Branch:** `features/049-preview-environment-gate-3e1d29`, cut from `main` at `2e358fd`
- **Task:** [Fail a PR whose app repo has no devops preview environment](https://app.notion.com/p/Fail-a-PR-whose-app-repo-has-no-devops-preview-environment-3e1d2993e9a981f68f9dd7561bff07a9) on `QL Desktop-sprint-2`
- **Depends on:** the ql-docs preview environment contract node, which this cites in every message and whose rules it enforces. That node's task is still open; the rules enforced here are the eight its brief specifies, and the citation names the node by stage folder and title so it stays correct whichever number ql-docs settles on.
- **Sibling:** [050 — Deploy a green PR to a temporary URL](../050-preview-deploy-job/index.md) shares `src/cli/govern-command.ts` with this and lands after it.
- **Gate note:** delivered from a written brief that pre-scoped the work. Gate 1 is recorded as closed on that brief; Gate 2 is the pull request. Gate 3 was meant to be this pull request's own govern run, but `dogfood.yml` passes no `ql-pipeline-ref`, so that run checked ql-pipeline out at `main` and executed `0.5.1` against this branch — its log carries `task artifacts: complete` and no preview line (`TASK049-27`, `WARN`). Gate 3 is therefore the first governed run after this merges, which should log `preview environment: not required — no apps/*frontend* or apps/*backend* directory`.
