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
    secrets: inherit
```

`secrets: inherit` forwards every secret the repository holds. Name them
individually only if you have a reason to withhold some: the set ql-pipeline
needs changes over time, and an explicit list means editing every governed
repo each time it does.

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
- **Required secret for every job:** `GH_PACKAGES_TOKEN` — a token with read access to `0xb1te/ql-docs` and `0xb1te/ql-auth`. ql-pipeline installs `@0xb1te/house-client` and `@0xb1te/ql-auth-client` directly from those two private repositories, and your repo's `GITHUB_TOKEN` cannot read them: it is scoped to your repository alone. All three jobs install ql-pipeline, so all three need it. The workflow rewrites only those two repository URLs, so the token is never offered to any other `github.com` fetch. A read-only fine-grained PAT is enough.
- **Secret for the default Cursor provider:** `CURSOR_API_KEY`, used by both the reviewer and the fixer when `agent.provider` is `cursor` (the default). The workflow still installs the Cursor CLI on the runner — the fixer remains Cursor-only even if review uses another endpoint.
- **Secrets for `agent.provider: openai_compatible`:** `QL_PIPELINE_AGENT_API_KEY` (preferred) or `OPENAI_API_KEY` (fallback). These are bearer tokens for `POST {base_url}/chat/completions`. Never put them in `pipeline.config.yml`. A FIX verdict then escalates to a human instead of running the Cursor fixer.
- **Required secrets (unless `standards.enabled: false`):** `HOUSE_API_URL`, `QL_AUTH_URL`, `QL_AUTH_CLIENT_ID`, `QL_AUTH_CLIENT_SECRET` — a `github_agent` client-credentials client registered in `ql-auth`, used to read the engineering standards from `house-api` for this review. Without them the `ql-pipeline` check fails with an explicit message rather than quietly reviewing against no standards.
  **Grant this client `review:*` (or `review:pr-feature`, `review:pr-fix`, `review:pr-bugfix`).** `HouseStandardsReader` opens every session with `route: "review:${pack}"` for a path under `workflow/review/pr-*`. That is the only tree `ql-pipeline` loads. A leftover `stage:N` mapping remains only so an old fixture still resolves; new reviews never request it.
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

# Which model runs which job. Omit the block entirely and cursor-agent
# uses whatever the CURSOR_API_KEY account defaults to.
#
# `model` is the fallback for every phase; `review.model` and `fix.model`
# override it per phase. Cursor values are cursor-agent --list-models slugs.
# agent:
#   provider: cursor
#   model: cursor-grok-4.6-xhigh-fast   # fallback for both phases
#   review:
#     model: cursor-grok-4.6-xhigh-fast
#   fix:
#     model: cursor-auto
#
# OpenAI-compatible review (review-only). Token comes from
# QL_PIPELINE_AGENT_API_KEY or OPENAI_API_KEY — never from this file.
# A FIX verdict escalates to a human; the fixer still requires cursor-agent,
# so `fix.model` is inert under this provider rather than an error.
# agent:
#   provider: openai_compatible
#   model: gpt-4.1
#   base_url: https://api.openai.com/v1
```

### What the runner gives your gate commands

The pipeline job provisions **Node and pnpm only** — there is no `setup-java`, `setup-go`, Terraform or Xcode step anywhere in the reusable workflow, because ql-pipeline has no way to know which of those your repo needs.

A gate command therefore gets whatever else the GitHub runner image happens to preinstall, at whatever version that image defaults to. That is usually fine, and occasionally a trap: `ubuntu-latest` ships several JDKs but defaults `JAVA_HOME` to one of them, which may not be the one your build requires.

Gate commands run through a shell, so the fix lives in the command itself rather than in ql-pipeline:

```yaml
gates:
  backend:
    build: "JAVA_HOME=$JAVA_HOME_21_X64 mvn -B -f apps/pom.xml -DskipTests package"
    test: "JAVA_HOME=$JAVA_HOME_21_X64 mvn -B -f apps/pom.xml test"
```

The runner image documents the variables it sets for each preinstalled toolchain. If your gate needs something the image does not ship at all, install it as part of the gate command.

### Choosing models per job

Review and fix are different jobs. Review reads the whole diff plus the house checklists and has to reason about them; a fix applies a complaint that has already been reasoned out. Pinning them separately lets a repo spend a strong model where judgement happens and a cheaper one where it does not:

| Key | Applies to | Falls back to |
|---|---|---|
| `agent.model` | both phases | the provider's own default |
| `agent.review.model` | the AI review | `agent.model` |
| `agent.fix.model` | the auto-fix agent | `agent.model` |

A phase naming no model sends no `--model` flag at all, leaving the choice to the provider. The resolved values are printed in the `ql-pipeline` job log (`agent: provider=… review model=…`), so you can confirm from a run which model actually answered.

Every key under `merge:`, `fixer:`, and `agent:` has the sensible default shown above and can be omitted. `gates:` has no fallback of its own — an area with no configured gate is simply ungated for that area, since ql-pipeline has no way to guess your build/test commands. `agent.provider` chooses Cursor CLI (default) or an OpenAI-compatible chat-completions URL; `agent.model` is the model slug for that provider. Tokens never live in this file.

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

The reviewer judges your code against ql-docs `workflow/review/pr-*`, not the build-stage trees and not the feature/hotfix/bugfix *process* checklists. Documents are read live from `house-api` at review time — never vendored, never checked out — so reviews always reflect the current packs.

Which pack loads is a convention, not a `standards.docs` map:

| PR | Pack | House route |
|---|---|---|
| `features/` branch, or a `feat` commit on an unnamed branch | `workflow/review/pr-feature/` | `review:pr-feature` |
| `hotfixes/` branch | `workflow/review/pr-fix/` | `review:pr-fix` |
| `bugfixes/` branch, or a `fix` commit that is not a hotfix | `workflow/review/pr-bugfix/` | `review:pr-bugfix` |

Every pack is self-contained: `checklist.md` (PR hygiene + type rules, cited as `review.standards`) plus one file per area the diff touches (`frontend.md`, `backend.md`, …, cited as `<area>.standards`). `standards.docs` in YAML is accepted for older configs and ignored.

The reviewer cites findings as `backend.standards#09-controllers` or `review.standards#MUST`, and they are held to the same grounding requirement as rule findings: a citation to a section or file that doesn't exist is discarded.

```yaml
standards:
  enabled: true            # false = review with rules only
  root: .standards         # a local checkout path, read only by `doctor` for your editor —
                            # `govern` never reads this path; it always goes to house-api
  max_chars_per_area: 120000
```

There is no per-caller way to point at a different standards source or pin a ref; `house-api` always serves the current `ql-docs` content its own operators configured it with.

**Cost — read this before enabling on a busy repo.** The checklists are large. A frontend PR sends ~31k tokens of standards, a backend PR ~24k, and a PR touching **both sends ~54k tokens** on top of the diff. That is the price of reviewing against your actual documented architecture rather than a generic rule list.

Ways to trim, in order of how much you lose:

1. Drop `stage-2-mockup/checklist.md` from `frontend` if that repo never does visual-surface work (saves ~17k tokens).
2. Lower `max_chars_per_area` — trailing sections are dropped whole, never mid-rule, and the truncation is stated in both the prompt and the run log.
3. Remove `ai-review` from `merge.required_checks` on low-risk repos, which skips the review entirely.

**Fail-closed.** If `enabled` is true and a configured document can't be loaded — a wrong path, a route the `github_agent` client doesn't carry, or `house-api`/`ql-auth` being unreachable — the `ql-pipeline` check fails and says exactly what went wrong. It will not review against a subset and report success.

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
