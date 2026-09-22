# 049 — Summary

## What Shipped

The preview environment contract, enforced. A repository with `apps/*frontend*` or `apps/*backend*` must carry `infrastructure/docker/environments/devops/docker-compose.yml` with exactly one entry service named `edge`, no published host ports, and an `env.example` beside it. A product repository that fails any of that fails its pull request **before review**, with one comment naming every violation and the ql-docs node the rules live in.

| Surface | What it does now |
|---|---|
| `checks / ql-pipeline` | Structural refusal after R4 and before the gates are read: comment, `setFailed`, return. No `needs-human` label — an author fixes a missing folder, a person does not adjudicate it |
| R4 escalation | Carries the preview verdict beside the task-artifact findings, so a person reviewing a governance change sees it too |
| `ql-pipeline doctor` | A `preview environment` line: *not required*, *satisfies the contract*, or `FAIL` with the violations and the contract pointer |

Applicability is decided by the configured `areas.paths` globs through the router's own `matchesGlob`, so a repository that has told the pipeline where its apps live is measured against that. A repository with no product apps — this one — is unaffected.

## What Was Verified

| | |
|---|---|
| Full suite | **810 passed**, 57 files (was 784; 26 added) |
| Typecheck / lint / neurons | green |
| Harness validator | line-for-line identical to a clean `main` worktree, 24 pre-existing errors |
| `dist/` | rebuilt and committed |
| Live | the govern run on this pull request — a repository with no `apps/` — is the "unaffected" case, and its log carries the `not required` line (`TASK049-27`) |

## Decisions Worth Knowing Later

- **A hard gate, not a `must` finding.** A finding reaches the verdict only after the gates are read and the review has run; a repository that cannot be previewed would still spend a review, and could be argued back toward MERGE by an attempt cap. Nothing downstream can work without the folder, so nothing downstream is spent on it. Do not soften this into the finding path without also moving it after the review — that is the exact shape rejected.
- **Computed before R4, refused after it.** So an escalation carries it and a governance pull request still gets its human hop. Same ordering `042` settled for task artifacts.
- **No opt-in.** Unlike `task-artifacts`, the check applies only where a product exists, and that is exactly the set the deploy job and the tester cannot serve without the folder.
- **The contract node is named by stage folder and title**, never by number, because ql-docs has not settled whether the node absorbs slot 14 or takes 15. `PREVIEW_CONTRACT_NODE` is the one string every message reads.

## Follow-Ups

- **ql-docs owes the node this cites.** Its task is open. Until it lands, the citation points at a stage folder whose contract node does not yet exist; the rules enforced here are the eight in that task's brief.
- **Task 050** stacks on this branch, adds the preview deploy job, and takes `0.7.0`.
