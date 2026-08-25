# AGENT.md — Instructions for AI agents working on ql-pipeline

You are working on **ql-pipeline**: a versioned DevOps pipeline that governs pull requests, shipped as a **GitHub reusable workflow** other repos call by reference. It interprets conventional commits to detect the change area, applies that area's rule set, gates the PR behind build + test, reviews it with Cursor CLI, and then **merges**, **fixes** (a Cursor CLI agent pushes corrective commits), or **blocks** the PR.

**Read [docs/SPECIFICATION.md](docs/SPECIFICATION.md) first** — it is the canonical contract, with a table mapping every requirement to the code and tests that satisfy it.

## Before you touch anything

1. Read [RULES.md](RULES.md) — binding, and it wins over this file on conflict.
2. Read [docs/SPECIFICATION.md](docs/SPECIFICATION.md), especially §4 (the ordered pipeline contract) and §6 (safety properties). Several steps exist specifically to run *before* a later one; reordering them silently breaks a guarantee.
3. Read the `plan.md` of the task you're working on (`docs/NNN-*/plan.md`). If no approved plan covers your work, **stop and write one first** (RULES.md R1).
4. Check `pipeline.config.yml` and the relevant `rules/*.rules` before changing behaviour — most behaviour changes belong in config or rules (data), not in `src/` (code).

## Project map

| Path | What it is | May you edit it? |
|---|---|---|
| `docs/SPECIFICATION.md` | The canonical contract | Only alongside the change that makes it true |
| `docs/NNN-*/` | Task folders: plans, decisions | Yes — this is where work starts |
| `src/` | Pipeline implementation (TypeScript, Node 20, strict) | Yes, with tests |
| `tests/` | Unit + integration tests | Yes — required for any `src/` change |
| `rules/*.rules` | Rule sets applied to incoming PRs (shipped defaults) | Only with explicit human approval (R4) |
| `prompts/*` | Reviewer/fixer prompt templates for Cursor CLI | Only with explicit human approval (R4) |
| `pipeline.config.yml` | This repo's own config, and the worked example of the schema | Only with explicit human approval (R4) |
| `.github/workflows/` | Reusable workflow, dogfood caller, self-check CI | Only with explicit human approval (R4) |
| `docs/integration-guide.md` | Consumer adoption guide | Yes — keep in sync with the `workflow_call` contract and config schema |

## How to work

- **Branch**: `task/NNN-short-slug`. Never push to `main`.
- **Commits**: `<type>(<area>): description`. Pipeline work is `infrastructure`; documentation is `docs`.
- **Verify before PR**: `npm run typecheck && npm run lint && npm run build && npm test` must be green. If you changed runtime behaviour, exercise it — `main.ts` can be driven against a fake webhook payload via `GITHUB_EVENT_PATH`, which is how the governance guard was verified.
- **PR description**: link the task folder, state what changed and how you verified it. Say so prominently if you touched R4-protected paths.

## Architecture invariants (do not break)

1. **Decision logic is pure.** `commit-parser`, `router`, `verdict`, `rules`, and `merger/target-branch` take data in and return data out — no network, no GitHub API, no filesystem. I/O lives in `shared/`, `merger/merger.ts`, `reviewer/`, and `fixer/`.
2. **Rules are data.** Reviewer behaviour changes by editing `.rules` files, not by hardcoding checks in `src/reviewer`.
3. **The loop terminates.** Every path in the fix loop respects `max_fix_attempts` and ends in MERGE or BLOCK — never a silent retry.
4. **Findings are grounded.** Findings citing a file, line, or rule ID not present in the diff or the loaded rules are discarded, never repaired.
5. **The pipeline never edits its own laws.** Protected paths are enforced twice: a PR touching them routes to a human *before the AI is consulted*, and the fixer's tree is hard-reverted on those paths before any commit.
6. **The reviewer is read-only, structurally.** Its checkout is snapshotted before and after; any difference — or an unreadable snapshot — fails the run.
7. **Only the reviewed revision merges.** The head SHA is re-checked and pinned on the merge call.
8. **The agent never commits.** It produces a working-tree diff; the pipeline decides what is staged, what the message says, and whether to push.
9. **Fail closed.** Unparseable commits, malformed verdicts, crashed gates, unreadable config → BLOCK with an explanation, never MERGE by default.
10. **This is a reusable workflow, not a library to vendor.** Consumers call `.github/workflows/pr-pipeline.yml` via `uses:`; the `workflow_call` inputs/secrets contract is a public interface once another repo depends on it.

## Things that are easy to get wrong here

Learned the hard way; see [docs/007-spec-conformance/plan.md](docs/007-spec-conformance/plan.md).

- **Never check for a pristine working tree.** The build and test gates run before the reviewer and fixer, so the tree is legitimately dirty by then. Always compare a before/after snapshot (`src/shared/worktree.ts`).
- **ql-pipeline's own checkout lives inside the repo under review** (`.ql-pipeline/`), because `actions/checkout` cannot write outside the workspace. It's hidden via `.git/info/exclude`; don't assume the workspace contains only the consumer's files.
- **`actions/checkout` on `pull_request` defaults to a detached merge ref.** The workflow deliberately checks out the head *branch* so the fixer can push.
- **Cursor CLI wraps its JSON in prose** even when told not to. `response-parser.ts` extracts a balanced `{...}` from surrounding text — that's load-bearing, not defensive padding.

## Behavioural expectations

- If a plan is ambiguous or two rules conflict, ask in the task/PR thread instead of guessing.
- Report failures honestly: failing tests, skipped steps, and partial work are stated plainly.
- Never store or echo secrets; `CURSOR_API_KEY` and the GitHub token exist only as Actions secrets.
- Keep changes inside the task's scope; anything out-of-scope goes in the PR description or a new task proposal, not the diff.
