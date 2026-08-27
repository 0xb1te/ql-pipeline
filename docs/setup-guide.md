# Setup guide — turning ql-pipeline on for a repository

The shortest path from nothing to a governed PR. Full configuration reference: [integration-guide.md](integration-guide.md).

Budget about 20 minutes, most of it waiting for the first run.

## The fast path

The CLI does steps 2–4 for you:

```bash
pnpm add -D github:0xb1te/ql-pipeline -w   # in a pnpm workspace, add -w — see docs/cli.md
pnpm ql-pipeline init                      # workflow + config + cursor rules + .gitignore
pnpm ql-pipeline doctor                    # tells you exactly what is still missing
```

Then do step 1 (the two secrets — nothing can do that for you), fill in your real build commands, and go to step 4b. Keep it current later with `pnpm update ql-pipeline && pnpm ql-pipeline upgrade` — see [cli.md](cli.md).

The manual steps below are the same thing done by hand, and explain what each file is for.

---



## Step 1 — Create the two secrets

In the repository you want governed: **Settings → Secrets and variables → Actions → New repository secret**.


| Secret            | Value                                                                     | Why                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CURSOR_API_KEY`  | Your Cursor API key                                                       | Powers both the AI review and the auto-fix agent                                                                                                                           |
| `STANDARDS_TOKEN` | A PAT (or GitHub App token) with **read** access to `0xb1te/prompt-utils` | The engineering standards live in that private repo. A workflow's default token can only read the repo it runs in, so without this the pipeline cannot load your standards |


> For an organisation, set both once as **organisation** secrets and share them with the relevant repos rather than repeating them per repository.

**On** `STANDARDS_TOKEN` **scope:** a fine-grained PAT limited to `0xb1te/prompt-utils` with *Contents: Read-only* is enough. Don't reuse a broad token here.

## Step 2 — Add the caller workflow

Create `.github/workflows/pr-governance.yml`:

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
      STANDARDS_TOKEN: ${{ secrets.STANDARDS_TOKEN }}
```



## Step 3 — Add the pipeline config

Create `.github/pipeline.config.yml`. Only `merge.target_branch` is required; everything else has a default.

```yaml
gates:
  frontend:
    build: "npm ci && npm run build"
    test: "npm run test -- --ci"
  backend:
    build: "./gradlew assembleDebug"
    test: "./gradlew test"

merge:
  target_branch: main
```

Set the gate commands to whatever your repo actually uses. An area with no entry is simply ungated.

## Step 4 — Watch one real PR before enforcing anything

**Do not mark the checks required yet.** Open a small PR against your target branch with a proper conventional-commit header:

```
feat(backend): add health endpoint
```

You should see three checks appear, in order:

```
checks / test          the test gate for the PR's areas
checks / build         the build gate (skipped if tests fail)
checks / ql-pipeline   AI review, verdict, merge / fix / block
```

and on the PR itself: an `area:backend` label and a summary comment naming the areas, target branch, gate results, whether the review ran, and the decision.

Read the `ql-pipeline` job log. It states which rule files and which standards documents it loaded — that is the fastest way to confirm your standards are actually reaching the reviewer.

## Step 4b — Give Cursor the same rules the pipeline reviews against

The pipeline is the review side. `[templates/cursor-rules/](../templates/cursor-rules/)` is the **write** side — copy-paste Cursor rules that point at the same `prompt-utils` checklists, so work is produced against the standards it will later be judged by.

```bash
cp -r /path/to/ql-pipeline/templates/cursor-rules/.cursor .

# Clone the standards where Cursor can read them — the SAME path CI uses
git clone git@github.com:0xb1te/prompt-utils.git .standards
echo '.standards/' >> .gitignore
```

Using `.standards/` locally is deliberate: it is exactly where the workflow checks `prompt-utils` out during review, so every path reference in the rules resolves identically in your editor and in CI.

See [templates/cursor-rules/README.md](../templates/cursor-rules/README.md) for what each rule covers.

## Step 5 — Enforce

Once a real PR has been through the loop and you're happy with the findings: **Settings → Branches → Branch protection** → require whichever of `checks / test`, `checks / build`, `checks / ql-pipeline` you want to gate merges on.

---



## What to expect on a governed PR

- **Labels** `area:<area>` per matched area; `needs-human` when the pipeline won't decide alone.
- **A summary comment** on every run.
- **A request-changes review** when there's something to fix or block, one inline comment per finding.
- **Bot commits** `fix(<area>): resolve pipeline complaint (attempt N) [bot]` when the fix agent repairs something.
- **Nothing at all** on PRs targeting a branch other than the configured `target_branch`.



## Reading the decision


| Decision  | Means                                                                               |
| --------- | ----------------------------------------------------------------------------------- |
| **MERGE** | No blocking findings. Approved and merged; advisory findings ride along as comments |
| **FIX**   | Blocking findings, all auto-fixable, attempts remaining. A fix commit is pushed     |
| **BLOCK** | Something needs a person. Labelled `needs-human`                                    |




## Troubleshooting the first run


| Symptom                                                              | Cause                                                                    | Fix                                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `ql-pipeline` fails with "engineering standards could not be loaded" | `STANDARDS_TOKEN` missing or can't read `0xb1te/prompt-utils`            | Fix the token's scope, or set `standards.enabled: false` to run without standards                        |
| "This PR could not be routed"                                        | No commit *and* not the PR title matches `<type>(<area>): <description>` | Reword a commit or the PR title                                                                          |
| No checks appear at all                                              | The PR targets a branch other than `merge.target_branch`                 | Expected — the pipeline governs only its configured branch                                               |
| Everything is red on a PR touching `.github/`                        | Self-protection: PRs touching pipeline governance always go to a human   | Expected. Review it yourself                                                                             |
| A fix commit lands but nothing re-reviews it                         | Commits pushed with the default `GITHUB_TOKEN` don't trigger new runs    | Supply a PAT/App token as `GH_TOKEN` so the loop closes automatically                                    |
| Review cost higher than expected                                     | The standards are large (~14k tokens frontend, ~24k backend)             | Lower `standards.max_chars_per_area`, or drop `ai-review` from `merge.required_checks` on low-risk repos |




## If your layout isn't `apps/*frontend*` / `apps/*backend*`

Area detection reads both your commit headers and the paths a PR touches. Override the path mapping:

```yaml
areas:
  paths:
    frontend: ["apps/*frontend*/**", "packages/ui/**"]
    backend: ["apps/*backend*/**", "services/**"]
```

