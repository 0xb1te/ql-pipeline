# Task 004 — Phase 3: Review

| | |
|---|---|
| **Status** | 🟢 Approved (part of the phase 1–5 build-out approved in Task 001) |
| **Parent** | [docs/001-first-task-base-project/plan.md](../001-first-task-base-project/plan.md) §7 "Phase 3 — Review" |

## Scope

- **`src/reviewer/diff-grounding.ts`**: pure — indexes which (file, line) pairs really exist in a unified diff's new side, and applies the grounding requirement (file/line/rule must all be real) to reviewer findings.
- **`src/reviewer/response-parser.ts`**: pure — unwraps `cursor-agent`'s JSON envelope, extracts a JSON object from the model's free-form response text (tolerating preamble/postamble and markdown fences), and validates it against the `ReviewVerdict`/`Finding` schema.
- **`src/reviewer/cursor-runner.ts`**: impure — spawns `cursor-agent` with array args (never a shell string — the prompt carries PR diff content), and a read-only-guard helper (`git status --porcelain`) that fails closed if it can't be checked.
- **`src/reviewer/reviewer.ts`**: orchestrates the above into `runReview()` — builds the prompt, invokes the agent in `--mode ask` (read-only), retries once on a malformed response, verifies the checkout is still clean, grounds the findings.
- **`src/verdict/verdict.ts`**: pure — MERGE / FIX / BLOCK decision function, unifying gate failures and review findings into one input (a build break is just another finding, plan.md §4.3).
- **`src/merger/merger.ts`** + `GithubClient` extensions: approve (with advisory `should`-finding comments) → merge (configured method) → delete branch.
- **`src/main.ts`**: wired end-to-end — route → label → gates → (skip review and treat gate failures as findings if gates failed, otherwise review) → verdict → MERGE executes for real; FIX and BLOCK fail the check (no fixer exists yet — Phase 4).

## Real `cursor-agent` investigation

Before writing any of this, I ran the actually-installed `cursor-agent` CLI (already authenticated in this environment) a few times to learn its real contract rather than guess:

- Flags confirmed: `--print --output-format json --mode ask --trust`, auth via `CURSOR_API_KEY` or `--api-key`. `--mode ask` is read-only; the default (no `--mode`) has write/shell access, used later for the fixer with `--force` (Phase 4).
- Output envelope: `{"type":"result","is_error":bool,"result":"<model's text>",...}` — the payload we care about is a **string** inside `.result`, not a nested object.
- **Even with explicit instructions ("no text before or after, no markdown fences"), the model still wrapped the JSON in conversational text** in a live test: `"Reviewing the workspace to produce the JSON verdict.\n{\"verdict\": \"PASS\", \"findings\": []}"`. A vaguer prompt produced worse results — unquoted keys (`{verdict:PASS,findings:[]}`) that aren't valid JSON at all.
- This directly shaped the design: `extractJsonObject()` scans for a balanced `{...}` substring anywhere in the text (handling nested structures and braces inside string values correctly — a real bug caught in testing, see below) rather than requiring the whole response to be pure JSON. The captured preamble+JSON example above is a real regression fixture in `tests/reviewer/response-parser.test.ts`.

## Bugs caught during testing (worth knowing about)

1. **`diff-grounding.ts`**: `+++ /dev/null` (a deleted file's new-side marker) also starts with `+`, and wasn't matched by the file-header regex (which only handled `+++ b/path`) — so it fell through and was misread as an *added content line* in the *previous* file, leaking a phantom line into that file's index. Fixed by matching every `+++ ...` line unconditionally and special-casing `/dev/null`.
2. **Test fixture bug, not a code bug**: an integration-test diff had a finding citing line 4 while its single-line hunk only produced line 1 — a reminder that hand-written diff fixtures need to be checked against the actual hunk math, not assumed.

## Exit criteria (from the parent plan)

UC1 (clean frontend PR → build/test pass → AI review passes → MERGE) works end-to-end. Verified two ways:
- `tests/integration/pipeline-flow.test.ts` threads commit-parser → router → gate-runner → reviewer → verdict → merger together with fakes only at the true I/O boundaries (shell exec, cursor-agent invocation, GitHub API) — this is UC1 in full, plus the review-and-verdict portion of UC2 (flawed PR → FIX; exhausted attempts → BLOCK).
- `main.ts` smoke-tested the same way as Phase 2: the guard chain (`GITHUB_TOKEN` → config load → PR-context) still fails closed correctly with the new reviewer/verdict/merger wiring in place.

## Verification boundary

Unchanged in kind from Phase 2, now also covering the new modules: `main.ts`, `cursor-runner.ts`'s real `spawn` call, and `github-client.ts`'s new Octokit calls (`getPullRequestDetails`, `approveWithComments`, `mergePullRequest`, `deleteBranch`) are real I/O at the edges, correct against documented API contracts (verified `@octokit/rest`'s actual method signatures and parameter shapes directly against the installed package rather than assuming), but not exercised by the automated test suite — there's no authenticated `gh`, no real PR, and a live `cursor-agent` review call costs real time (~2 minutes) and tokens, which doesn't belong in a fast unit-test suite. `diff-grounding`, `response-parser`, `verdict`, `merger`, and the orchestration logic in `reviewer.ts` are fully unit- and integration-tested with injected fakes.
