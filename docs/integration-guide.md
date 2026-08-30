# Integration guide

How another repo adopts ql-pipeline to govern its pull requests. ql-pipeline ships as a **GitHub reusable workflow** — you never vendor its code, only call it by reference.

## 1. Add the caller workflow

Create `.github/workflows/pr-governance.yml` in your repo:

```yaml
name: PR Governance

on:
  pull_request:
    types: [opened, synchronize, reopened]

concurrency:
  group: pr-pipeline-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  checks:
    uses: 0xb1te/ql-pipeline/.github/workflows/pr-pipeline.yml@main
    secrets:
      CURSOR_API_KEY: ${{ secrets.CURSOR_API_KEY }}
      # Read access to the engineering-standards repo. Required: it is
      # private, and the default GITHUB_TOKEN is scoped to this repo only.
      STANDARDS_TOKEN: ${{ secrets.STANDARDS_TOKEN }}
```

This adds **three checks** to every PR, which run in order:

| # | Check | What it does | Red means |
|---|---|---|---|
| 1 | `checks / test` | Runs the configured **test** command for the PR's areas | Tests failed |
| 2 | `checks / build` | Runs the configured **build** command for the PR's areas | The change doesn't build |
| 3 | `checks / ql-pipeline` | AI review, verdict, and merge / fix / block | The PR was blocked, or a fix was pushed |

The `checks /` prefix is your calling job's id — rename the job and the prefix changes with it. Those exact strings are what you enter in branch protection.

`build` is skipped if `test` fails, so you get the first real failure without waiting for the rest. **`ql-pipeline` runs regardless** — that's deliberate: a failing test or build is a finding the fix agent can repair, and halting the chain on a red gate would mean broken builds never get auto-fixed.

- **Pin `@main` to a tag or SHA in production** once ql-pipeline has releases — `@main` tracks the latest commit, which is fine for trying it out but not for a repo whose merges depend on it staying stable.
- **The `concurrency` block is your responsibility, not ql-pipeline's.** A new commit pushed to a PR should cancel the in-flight run for the old one (including a stale fix-loop attempt) — the reusable workflow doesn't declare this for you since it's a property of *your* workflow, not the called one.
- **Required secret:** `CURSOR_API_KEY`, used by both the reviewer and the fixer. The workflow installs the Cursor CLI on the runner itself; you don't need to.
- **Required secret:** `STANDARDS_TOKEN` — a PAT or GitHub App token with **read** access to `0xb1te/ql-docs`. The engineering standards live there, it's a private repo, and a workflow's default `GITHUB_TOKEN` can only read the repo it runs in. Without it the `ql-pipeline` check fails with an explicit message rather than quietly reviewing against no standards. (Set `standards.enabled: false` in your config if you genuinely want to run without them.)
- **Optional secret:** `GH_TOKEN`. Omit it and the workflow falls back to the default `GITHUB_TOKEN` — but note the consequence: **commits pushed with the default token do not trigger new workflow runs**, so an auto-fix commit will not re-run the pipeline on its own. For the fix loop to close automatically (fix → re-review → merge), supply a PAT or GitHub App token as `GH_TOKEN`. With the default token the fix still lands on the PR; it just waits for the next push or a manual re-run to be re-reviewed.

### Fork pull requests

PRs from forks are routed, gated, and reviewed, but **never auto-fixed** — a fork's branch lives in another repository that the base repo's token cannot push to. Such a PR gets its complaint and a `needs-human` label instead of a fix commit.

## 2. Branch protection

Add whichever of the three checks you want enforced as **required status checks** on your target branch — `checks / test`, `checks / build`, `checks / ql-pipeline`. ql-pipeline approves and merges through the normal GitHub API, so branch protection is the actual enforcement layer; the pipeline works with it, never around it.

Note the relationship with `merge.required_checks` in your config (§4): that field controls whether the *pipeline* treats a stage's failure as blocking, while branch protection controls whether *GitHub* blocks the merge button. They're independent, and it's reasonable to set both. If you drop `build` from `required_checks` but mark `checks / build` as required in branch protection, the pipeline will happily approve a PR that GitHub then refuses to merge — pick one story and stick to it.

## 3. Conventional commits

Every PR must have at least one commit — or, failing that, a PR title — matching:

```
<type>(<area>): <description>
type ::= feat | fix | refactor | perf | chore | docs | test | ci | build | revert
area ::= frontend | backend | mobile | ios | android | infrastructure | docs
```

A PR where neither any commit nor the title matches is unrouteable and fails the check immediately with an explanatory comment — the AI never reviews something it can't route.

## 4. Configuring gates, merge behavior, and the fix loop

Add `.github/pipeline.config.yml` (the path the caller snippet above uses by default; override via the `config-path` input if you keep it elsewhere):

```yaml
gates:
  frontend:
    build: "npm ci && npm run build"
    test: "npm run test -- --ci"
  backend:
    build: "npm ci && npm run build"
    test: "npm run test:unit"
  # An area with no entry here simply has no gate — that's valid, not an
  # error, for areas that don't apply to your repo (e.g. no android/ code).

merge:
  # Required — no safe default. The pipeline governs only PRs that target
  # this branch; a PR aimed anywhere else is left completely untouched
  # (no check, no comment), not failed.
  target_branch: main

  # Optional: override the target per area. A PR whose areas resolve to
  # more than one target branch is a conflict the pipeline refuses to
  # guess at — it escalates to a human instead.
  target_branch_by_area:
    mobile: release/mobile

  method: merge             # squash | merge | rebase (default: merge)
  delete_branch: true       # default: true

  # Which stages are enforced. Valid entries: build, test, ai-review.
  # A stage left out still runs, but its failures become advisory instead
  # of blocking — except `ai-review`, which is skipped entirely when not
  # required, since a review whose findings can't block is pure cost.
  # Drop `ai-review` here to run this as a gates-only pipeline.
  required_checks: [build, test, ai-review]   # default shown

  # Take the review without the merge. On a MERGE verdict the pipeline
  # approves the PR, attaches its advisory findings, labels it
  # `ready-to-merge` — and stops. The merge API is never called and the
  # branch is not deleted; a person makes the final call.
  # Unlike dropping `ai-review` from required_checks, you keep the review.
  require_human_approval: false   # default: false

fixer:
  max_fix_attempts: 3       # default: 3
  protected_paths:          # default shown — paths the fix agent can never touch,
    - .github/workflows/    # reverted structurally even if the agent edits them
    - .github/pipeline.config.yml
    - .github/pipeline-rules/
```

Every key under `merge:` and `fixer:` has the sensible default shown above and can be omitted. `gates:` has no fallback of its own — an area with no configured gate is simply ungated for that area, since ql-pipeline has no way to guess your build/test commands.

## 4b. Area detection and the `apps/*` convention

Areas come from two places, and the pipeline uses the **union**:

1. **Your conventional-commit headers** — `feat(backend): …`. This is what decides whether a PR is routable at all.
2. **The paths the PR touches** — by default `apps/*frontend*/**` → `frontend`, `apps/*backend*/**` → `backend`, matching the house monorepo layout.

Path detection is **additive**. A PR whose commits all say `feat(frontend)` but which also edits `apps/api-backend/` gets the backend rules *and* backend standards applied too — you cannot narrow what gets reviewed by how you word a commit. It does **not** rescue a PR with no valid commit header; that is still unroutable.

Override the mapping for any area if your layout differs:

```yaml
areas:
  paths:
    frontend: ["apps/*frontend*/**", "packages/ui/**"]
    backend: ["apps/*backend*/**"]
    infrastructure: ["infra/**", "terraform/**"]
```

Globs support `*` (within a path segment), `**` (across segments), and `?` (one character).

## 4c. Engineering standards

The reviewer judges your code against the organisation's own workflow documentation, not just the generic rule sets. The standards repository is checked out at review time — never vendored — so reviews always reflect the current standards.

Defaults — these mappings **are** the area rules; `rules/*.rules` deliberately does not restate them:

| Area | Documents loaded from `0xb1te/ql-docs` | Size |
|---|---|---|
| `frontend` | `workflow/rules/stage-2-mockup/checklist.md` + `stage-5-frontend/checklist.md` | ~128k chars (~32k tokens) |
| `backend` | `workflow/rules/stage-4-backend/{backend,sql}/checklist.md` + `stage-6-tests/backend/checklist.md` | ~100k (~25k tokens) |
| `mobile`, `ios`, `android` | `workflow/rules/stage-5-frontend/checklist.md` | ~58k (~14k tokens) |
| `infrastructure` | `workflow/rules/stage-8-deployment/checklist.md` | ~12k (~3k tokens) |
| `docs` | — (no upstream checklist; `rules/docs.rules` covers it) | — |

Only the `checklist.md` files are used. The `PROMPT.md` and `CREATE-*.md` files in those trees are *code-generation* instructions — giving them to a reviewer would tell it how to write code, not how to judge it.

Mobile maps to the frontend checklist because in this architecture mobile apps are the frontend packaged with Capacitor (`workflow/rules/stage-8-deployment/07-capacitor-apps/`) — there is no separate native codebase upstream. If you do maintain native code, override `standards.docs` for those areas.

The reviewer cites standards findings as `backend.standards#09-controllers`, and they are held to the same grounding requirement as rule findings: a citation to a section or file that doesn't exist is discarded.

```yaml
standards:
  enabled: true            # false = review with rules only
  root: .standards         # where the workflow checks the standards repo out
  max_chars_per_area: 120000
  docs:
    frontend: ["workflow/rules/stage-5-frontend/checklist.md"]
    backend:
      - workflow/rules/stage-4-backend/backend/checklist.md
      - workflow/rules/stage-4-backend/sql/checklist.md
      - workflow/rules/stage-6-tests/backend/checklist.md
```

Point at a different standards repo or pin a ref from the caller workflow:

```yaml
    with:
      standards-repo: your-org/your-standards
      standards-ref: v2.1.0
```

**Cost — read this before enabling on a busy repo.** The checklists are large. A frontend PR sends ~31k tokens of standards, a backend PR ~24k, and a PR touching **both sends ~54k tokens** on top of the diff. That is the price of reviewing against your actual documented architecture rather than a generic rule list.

Ways to trim, in order of how much you lose:

1. Drop `stage-2-mockup/checklist.md` from `frontend` if that repo never does visual-surface work (saves ~17k tokens).
2. Lower `max_chars_per_area` — trailing sections are dropped whole, never mid-rule, and the truncation is stated in both the prompt and the run log.
3. Remove `ai-review` from `merge.required_checks` on low-risk repos, which skips the review entirely.

**Fail-closed.** If `enabled` is true and a configured document can't be loaded — usually a missing or under-scoped `STANDARDS_TOKEN` — the `ql-pipeline` check fails and says exactly which documents were missing. It will not review against a subset and report success.

## 5. Overriding rules per area

ql-pipeline ships default rule sets for all seven areas (`rules/*.rules` in the ql-pipeline repo — read them there to see what applies out of the box). To replace an area's rules entirely, add a file at:

```
.github/pipeline-rules/<area>.rules
```

e.g. `.github/pipeline-rules/backend.rules`. If present, it **fully replaces** ql-pipeline's shipped rules for that area (no partial merge — an all-or-nothing override avoids ambiguity about which rule "wins"). Areas you don't override keep the shipped defaults. `_common.rules` (secrets, hallucination grounding, commit hygiene) always applies and isn't overridable per-area.

## 6. What to expect on a PR

- **Labels:** `area:<area>` for every matched area; `needs-human` when the pipeline can't resolve something itself.
- **A summary comment** on every run: areas, target branch, gate results, whether the AI review ran, finding count, and the decision (MERGE / FIX / BLOCK).
- **A request-changes review** when there's something to fix or block, with one inline comment per finding plus a top-level summary (attempt N of your configured max).
- **Bot commits** on the PR branch look like `fix(<area>): resolve pipeline complaint (attempt N) [bot]`. Each one is meant to re-trigger the pipeline — see the `GH_TOKEN` note in §1 for why that needs a non-default token.
- **PRs that touch `.github/workflows/`, `.github/pipeline.config.yml`, or `.github/pipeline-rules/`** always route to `needs-human` regardless of anything else — the pipeline cannot approve changes to its own governance.
- **PRs targeting any other branch** get nothing at all: no check, no comment, no label. The pipeline governs only its configured target branch.

## 7. Things worth knowing before you turn it on

- **Ignore your build output.** The pipeline runs your gate commands and then reviews the result, so make sure `node_modules/`, `dist/`, and similar build artifacts are in your `.gitignore`. They're excluded from fix commits either way — the fixer stages only the files the agent actually touched — but a clean ignore file keeps the review context clean too.
- **The first run is the honest test.** Point it at a low-stakes branch first and watch one real PR through the whole loop before making its check required on a branch you care about.
- **Auto-merge respects branch protection.** The pipeline merges through the normal API; if protection rejects the merge, the pipeline reports the failure rather than working around it.
