# Integration guide

How another repo adopts ql-pipeline to govern its pull requests. ql-pipeline ships as a **GitHub reusable workflow** — you never vendor its code, only call it by reference.

## 1. Add the caller workflow

Create `.github/workflows/pr-governance.yml` in your repo:

```yaml
name: PR Governance

on:
  pull_request:
    types: [opened, synchronize, reopened]
  # Optional, and the subject of "Asking for another pass" below: lets a
  # comment re-run the pipeline with that comment as direction. The first
  # covers comments on the PR, the second replies inside a finding's thread.
  issue_comment:
    types: [created, edited]
  pull_request_review_comment:
    types: [created, edited]

concurrency:
  # The event belongs in the key as much as the number does. Without it the
  # pipeline's own verdict comment queues a run in this very group, and
  # `cancel-in-progress` kills the run that is posting it - concurrency is
  # evaluated before any job, so the marker guard in `resolve` declines the new
  # run seconds after it has already killed its parent. What that looks like is a
  # red `checks / ql-pipeline` on a pull request the engine approved.
  group: >-
    pr-pipeline-${{ github.event.pull_request.number || github.event.issue.number }}-${{
    github.event_name == 'pull_request' && 'commit' || 'comment' }}
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

This adds **three checks** to every PR, which run in order, and **two more** on a repository that can be previewed (see §8):

| # | Check | What it does | Red means |
|---|---|---|---|
| 1 | `checks / test` | Runs the configured **test** command for the PR's areas | Tests failed |
| 2 | `checks / build` | Runs the configured **build** command for the PR's areas | The change doesn't build |
| 3 | `checks / ql-pipeline` | AI review, verdict, and merge / fix / block | The PR was blocked, or a fix was pushed |
| 4 | `checks / preview` | On a green verdict, brings the PR's devops stack up on the preview host | The stack could not be brought up |
| 5 | `checks / preview-tester` | Drives the task's `MCP Cases` against that stack | A blocker case failed, or the MCP server was unreachable |

The `checks /` prefix is your calling job's id — rename the job and the prefix changes with it. Those exact strings are what you enter in branch protection.

`build` is skipped if `test` fails, so you get the first real failure without waiting for the rest. **`ql-pipeline` runs regardless** — that's deliberate: a failing test or build is a finding the fix agent can repair, and halting the chain on a red gate would mean broken builds never get auto-fixed.

- **Pin `@main` to a tag or SHA in production** once ql-pipeline has releases — `@main` tracks the latest commit, which is fine for trying it out but not for a repo whose merges depend on it staying stable.
- **The `permissions` block is not optional, and its absence is invisible.** A called workflow can never hold more than its caller, and ql-pipeline's jobs declare `contents`/`pull-requests`/`issues` write - they label PRs, comment, push fix commits and merge. GitHub's default `GITHUB_TOKEN` is read-only, so a caller without that block fails at **startup**: no jobs, no annotation, and no reason exposed through the API or the UI. It reads exactly like a missing secret, and has been misdiagnosed as one more than once. Granting it in the caller also keeps the widening to this one workflow - the alternative, flipping the repository-wide **Settings → Actions → General → Workflow permissions** default, hands write to every other workflow in the repo too.
- **One thing a caller cannot grant itself:** approving pull requests. **Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests"** is repository-level only, and a MERGE verdict calls the approve API. Without it the pipeline reviews and decides correctly, then fails at the last step.
- **The `concurrency` block is your responsibility, not ql-pipeline's.** A new commit pushed to a PR should cancel the in-flight run for the old one (including a stale fix-loop attempt) — the reusable workflow doesn't declare this for you since it's a property of *your* workflow, not the called one. Key it on `pull_request.number || issue.number` if you take the comment trigger: the two events describe the same PR with different fields, and a group that reads only the first collapses every comment-triggered run in the repo into one.
- **Key it on the event as well, or the pipeline cancels itself.** With the comment triggers on, a group keyed only by number also catches the pipeline's *own* verdict comment: posting it queues a run in that group, and `cancel-in-progress` kills the run that was posting. The marker guard cannot prevent it — that guard lives in the `resolve` job, and concurrency is evaluated before any job starts, so the new run is declined seconds after it has already killed its parent. The symptom is a red `checks / ql-pipeline` on a pull request the engine *approved*, because a cancelled check is not a green one. Adding `github.event_name` to the group keeps the intention the block was written for — a new commit supersedes the run for the previous commit — while a comment no longer supersedes a run that is mid-verdict. `ql-pipeline doctor` warns when a caller has the old shape.
- **Required secret for every job:** `GH_PACKAGES_TOKEN` — a token with read access to `0xb1te/ql-docs` and `0xb1te/ql-auth`. ql-pipeline installs `@0xb1te/house-client` and `@0xb1te/ql-auth-client` directly from those two private repositories, and your repo's `GITHUB_TOKEN` cannot read them: it is scoped to your repository alone. All three jobs install ql-pipeline, so all three need it. The workflow rewrites only those two repository URLs, so the token is never offered to any other `github.com` fetch. A read-only fine-grained PAT is enough.
- **Secret for the default Cursor provider:** `CURSOR_API_KEY`, used by both the reviewer and the fixer when `agent.provider` is `cursor` (the default). The workflow still installs the Cursor CLI on the runner — the fixer remains Cursor-only even if review uses another endpoint.
- **Secrets for `agent.provider: openai_compatible`:** `QL_PIPELINE_AGENT_API_KEY` (preferred) or `OPENAI_API_KEY` (fallback). These are bearer tokens for `POST {base_url}/chat/completions`. Never put them in `pipeline.config.yml`. A FIX verdict then escalates to a human instead of running the Cursor fixer.
- **Required secrets (unless `standards.enabled: false`):** `QL_HOUSE_API_URL`, `QL_AUTH_URL`, `QL_AUTH_CLIENT_ID`, `QL_AUTH_CLIENT_SECRET` — a `github_agent` client-credentials client registered in `ql-auth`, used to read the engineering standards from `house-api` for this review. Without them the `ql-pipeline` check fails with an explicit message rather than quietly reviewing against no standards.
  **Grant this client `review:*` (or `review:pr-feature`, `review:pr-fix`, `review:pr-bugfix`).** `HouseStandardsReader` opens every session with `route: "review:${pack}"` for a path under `workflow/review/pr-*`. That is the only tree `ql-pipeline` loads. A leftover `stage:N` mapping remains only so an old fixture still resolves; new reviews never request it.
- **Renamed in task 020:** `HOUSE_API_URL` is now `QL_HOUSE_API_URL`, bringing it under the same `QL_` prefix as every other QL-suite secret. **You do not have to act immediately** — both names are read and the prefixed one wins, so an existing consumer keeps working untouched. The run logs a deprecation warning while it is still on the old name. `CURSOR_API_KEY` and `GH_PACKAGES_TOKEN` keep their names deliberately: they identify third-party vendors, not QL components.

- **Optional secret:** `QL_PROXY_TOKEN`. Needed only when `QL_HOUSE_API_URL` and `QL_AUTH_URL` point at a `ql-proxy` exposure published with `--protect` — a shared secret checked at the edge before the request reaches either service. ql-pipeline sends it as `X-QL-Proxy-Token` on every call to both.

  **When the two addresses are separate exposures, they do not share a secret.** ql-proxy gives every protected exposure a secret of its own, so that a leaked value opens one address rather than all of them - which means a single `QL_PROXY_TOKEN` is refused at whichever of the two hops it does not belong to. The refusal surfaces as `ql-auth request failed with status 401`, which reads like a bad client id and is not. Set **`QL_AUTH_PROXY_TOKEN`** and **`QL_HOUSE_PROXY_TOKEN`** to the respective exposure secrets (`ql-proxy` reveals them per exposure); each falls back to `QL_PROXY_TOKEN`, so a fleet behind a single exposure sets neither and is unaffected. Omit it for a public or private-network address: an absent token means "nothing in front to satisfy", not "refuse to run". Note this is edge protection, *not* a replacement for the `ql-auth` client credentials — it gates who may reach the address, while the minted JWT still decides what they may read.
- **Optional secrets:** `QL_SPRINT_URL` and `QL_SPRINT_PROXY_TOKEN`. Set the first and the pipeline tells **ql-sprint** what it decided about each pull request, which reaches the operator in Telegram — merged, ready-to-merge, fixed, or blocked. Omit it and nothing is sent; a repository is governed exactly the same either way, and a fleet that runs no ql-sprint is not misconfigured for leaving it out.

  It reuses the `QL_AUTH_*` credentials the standards hop already needs, so a fleet that has those only adds the URL. `QL_SPRINT_PROXY_TOKEN` is the edge secret of a third `ql-proxy` exposure, on the same per-exposure principle as the other two — it falls back to `QL_PROXY_TOKEN` and is simply absent when ql-sprint is published unprotected.

  **A failed notification never fails a governance run.** By the time it is sent, the review has already landed on the pull request; a messenger that cannot deliver must not undo it. The run logs a warning and carries on.

- **Optional secret:** `GH_TOKEN`. Omit it and the workflow falls back to the default `GITHUB_TOKEN` — but note the consequence: **commits pushed with the default token do not trigger new workflow runs**, so an auto-fix commit will not re-run the pipeline on its own. For the fix loop to close automatically (fix → re-review → merge), supply a PAT or GitHub App token as `GH_TOKEN`. With the default token the fix still lands on the PR; it just waits for the next push or a manual re-run to be re-reviewed.

### Asking for another pass

Add the comment triggers and **a comment re-runs all three checks**. That is the conversational half of the loop: the pipeline reviews, complains, fixes what it can and answers each thread it opened; you read the result and say what to do differently, and it goes again.

Two events, because GitHub files the two kinds of comment separately — `issue_comment` for a comment on the PR, `pull_request_review_comment` for a reply inside the thread of a particular finding. Take both and either place works; take neither and the pipeline only ever runs on a push.

- **Only people can ask.** Comments written by a bot — `github-actions[bot]`, an App, ql-pipeline's own verdicts and its replies inside finding threads — are declined before anything is checked out. Without that guard the pipeline's answer to a finding would start the run that produced the next answer, and the PR would never come to rest. The guard runs ahead of everything else, on both events: `pull_request_review_comment` arrives carrying a full pull request, so a check placed any later would never see those replies.
- **The comment is not read as a command.** There is no `/fix` syntax and no keyword to learn. The run happens because you spoke; *what* you said reaches the reviewer and the fixer as direction (task 026).
- **`issue_comment` also fires for comments on plain issues, and either event can land on a closed PR.** All of those are declined in the `resolve` job, which posts a one-line notice saying which and leaves the PR's checks untouched. A declined run is green and empty, not a failure.
- **`issue_comment` always runs the copy of your caller workflow that is on the default branch.** Never the copy on the PR branch — so adding this trigger does nothing until it is merged, and you cannot test the change to it on the PR that makes it. This surprises everyone once.

### Fork pull requests

PRs from forks are routed, gated, and reviewed, but **never auto-fixed** — a fork's branch lives in another repository that the base repo's token cannot push to. Such a PR gets its complaint and a `needs-human` label instead of a fix commit. This holds for a comment-triggered pass as well: the resolve job carries the fork flag through, so commenting on a fork PR re-reviews it and still never pushes.

A PR whose fork was **deleted** has no branch left to check out, so the run declines outright rather than failing three checks that never had a chance.

## 2. Branch protection

Add whichever of the three checks you want enforced as **required status checks** on your target branch — `checks / test`, `checks / build`, `checks / ql-pipeline`. ql-pipeline approves and merges through the normal GitHub API, so branch protection is the actual enforcement layer; the pipeline works with it, never around it.

Note the relationship with `merge.required_checks` in your config (§4): that field controls whether the *pipeline* treats a stage's failure as blocking, while branch protection controls whether *GitHub* blocks the merge button. They're independent, and it's reasonable to set both. If you drop `build` from `required_checks` but mark `checks / build` as required in branch protection, the pipeline will happily approve a PR that GitHub then refuses to merge — pick one story and stick to it.

## 3. Conventional commits

Every PR must have at least one commit — or, failing that, a PR title — matching:

```
<type>(<area>): <description>
type ::= feat | fix | refactor | perf | chore | docs | test | ci | build | revert
area ::= frontend | backend | mobile | ios | android | infrastructure | tooling | docs
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
> **`max_chars_per_area` is per area, and there is also a total ceiling.** The whole prompt goes to `cursor-agent` as one argv element, and Linux refuses a single argument over 131072 bytes with `spawn E2BIG`. A per-area cap cannot bound that on its own - a PR touching two areas carries twice it. ql-pipeline therefore clamps the assembled prompt to 120000 bytes, trimming the standards (never the diff or the rules) and saying so in the prompt when it does. Lowering `max_chars_per_area` still controls how much each area contributes before that clamp applies.

2. Lower `max_chars_per_area` — trailing sections are dropped whole, never mid-rule, and both layers name what they removed.

Whenever either layer cuts, the run log names the dropped sections and the PR summary carries a **Standards coverage** line:

```
standards: frontend.standards (workflow/review/pr-bugfix/frontend.md)
  [per-area cap] dropped 52112 chars, 28 sections: 04 — Routing & Lazy Loading, 05 — Guards, ... (+18 more)
prompt: standards cut further to fit the prompt ceiling, dropped 18344 chars, 6 sections: ...
```

This matters for reading a verdict. `Findings: 0` against a whole standards
document and `Findings: 0` against a gutted one are not the same claim, and
before the sections were named there was no way to tell them apart.

3. Split the document into numbered slices — `frontend-1.md`, `frontend-2.md`,
   … beside the whole file. ql-pipeline reviews the diff once per pass, packing
   as many slices into each pass as the budget carries, so nothing is dropped.
   `${area}.md` still wins when present; an area that fits is never even probed
   for slices, and a PR whose standards already fit still runs a single pass.

   Slices must be flat siblings, **not** a `frontend/` folder: house-api cannot
   reach a document two or more levels below a route's entry node.

   Findings are merged across passes and deduplicated, and a failure in any
   pass escalates the PR rather than reporting a partial verdict.
3. Remove `ai-review` from `merge.required_checks` on low-risk repos, which skips the review entirely.

**Fail-closed.** If `enabled` is true and a configured document can't be loaded — a wrong path, a route the `github_agent` client doesn't carry, or `house-api`/`ql-auth` being unreachable — the `ql-pipeline` check fails and says exactly what went wrong. It will not review against a subset and report success.

## 4d. The preview environment contract

If your repository contains `apps/*frontend*` or `apps/*backend*` (by the same `areas.paths` globs as §4b), it must also carry a bootable preview stack at:

```
infrastructure/docker/environments/devops/
  docker-compose.yml
  env.example
```

The pipeline checks that folder **structurally, before review**, on every governed pull request, and fails the PR outright when it is missing or malformed — one comment naming every violation, `checks / ql-pipeline` red, no `needs-human` label. What it reads off the compose file:

- exactly one HTTP entry service, and it is named `edge`;
- no `ports:` on any service — the router reaches the stack over the shared preview network, and published ports collide the moment two previews run at once;
- an `env.example` beside it, which the stack boots from unedited.

Whether the stack actually comes up is the preview deploy's question, not this check's. The rules themselves are written once, in ql-docs `workflow/rules/stage-8-deployment/` — the *Preview environment contract* node — and every message the pipeline posts points there rather than restating them.

`ql-pipeline doctor` reports the same verdict as a `preview environment` line, so you find out before opening a pull request. A repository with no product apps — a library, a docs repo, ql-pipeline itself — is unaffected and reports *not required*.

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
- **PRs on a product repository with no valid `infrastructure/docker/environments/devops/` folder** fail before review, with one comment listing what the preview environment contract found missing — see §4d.
- **PRs targeting any other branch** get nothing at all: no check, no comment, no label. The pipeline governs only its configured target branch.

## 7. Things worth knowing before you turn it on

- **Ignore your build output.** The pipeline runs your gate commands and then reviews the result, so make sure `node_modules/`, `dist/`, and similar build artifacts are in your `.gitignore`. They're excluded from fix commits either way — the fixer stages only the files the agent actually touched — but a clean ignore file keeps the review context clean too.
- **The first run is the honest test.** Point it at a low-stakes branch first and watch one real PR through the whole loop before making its check required on a branch you care about.
- **Auto-merge respects branch protection.** The pipeline merges through the normal API; if protection rejects the merge, the pipeline reports the failure rather than working around it.

## 8. Previews

On a repository that carries the preview environment contract folder (§4d), a **green** pull request — a MERGE verdict a person is about to judge — gets a live stack:

1. `checks / ql-pipeline` sets a `deploy-preview` flag on an `awaiting-human` verdict. Only then: a red, blocked, merged, fork or unpreviewable PR gets no job and no comment. Advisory findings do not hold it back — they never block a merge, so they do not block the preview that lets you weigh them.
2. `checks / preview` runs **on the self-hosted `ql-proxy` runner** and calls `ql-pipeline deploy-preview`: ql-proxy brings `infrastructure/docker/environments/devops/` up with `QL_TASK_FOLDER` set to the branch's task folder, so the database boots from that task's `seed.sql`; the application's MCP server is located on the host's container network and polled until it answers; one comment is posted with the URL, the access state, the minutes left and whether MCP answered.
3. `checks / preview-tester` drives the task's `MCP Cases` sheet against that server and reports every failure in one comment.
4. Closing the pull request runs `preview-teardown`, which tears the stack down at once. The host's reaper is the backstop.

### What the repository needs

- The devops folder, valid under §4d.
- A **self-hosted runner** registered on the repository with the label `ql-proxy`, on the preview host — see ql-proxy's README, *Register the self-hosted runner*. Without one the `preview` job queues and never runs; set `preview.enabled: false` until it exists.
- Two **repository variables** (Settings → Secrets and variables → Actions → Variables): `QL_PROXY_HOME`, the built ql-proxy checkout on that host, and optionally `QL_PROXY_CONFIG`, which `ql-proxy.yml` it reads.
- `closed` in the caller's `pull_request.types`, so teardown fires. The scaffolded caller has it; add it by hand on an older one.

### Configuration

```yaml
preview:
  enabled: true              # default; off for a repo with the folder but no runner yet
  ttl_minutes: 120           # requested lifetime; the host clamps it to its own ceiling
  protect: true              # ask ql-proxy for the browser gate in front of the address
  mcp:
    service: backend         # the compose service that hosts the application's MCP server
    port: 8080               # its container port
    path: /mcp
    ready_timeout_seconds: 180
```

The MCP server is reached over the host's container network and **is never publicly routed** — the address is not printed anywhere on the PR. ql-docs `workflow/flows/app-mcp-surface.md` is the standard the application side follows.

### Two comments per preview

ql-proxy's own `up` announces the address — *Preview: … Cloudflare Access will ask who you are* — as `github-actions[bot]`, and the pipeline posts its own summary. That is deliberate: ql-proxy's comment carries no automation marker, so it must arrive as the bot (which the pipeline's comment trigger declines) and not as the person `GH_TOKEN` belongs to, whose comments start another run.

### The access token

Until ql-proxy's browser gate lands, previews are not gated by a token and the summary says so: Cloudflare Access is the only lock. Once ql-proxy honours `--protect` on `up` and prints the token, the summary prints it beside the URL — in the clear, on purpose: it opens a demo of an unmerged branch on a throwaway stack and nothing else.
