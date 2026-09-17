# The `ql-pipeline` CLI

Adopt the pipeline in a repository and keep the files it manages current.

The pipeline **engine** does not need this CLI — consumers reference the reusable workflow by ref, so improvements to routing, review, and fixing reach every repo on their next PR automatically. What does not auto-update is the consumer-side scaffolding: the caller workflow, the config, and the Cursor rules. That is what this CLI installs and maintains.

## Running the CLI

`ql-pipeline` is a private package, served straight from its GitHub repository — no registry, no publishing pipeline. Run it with `pnpm dlx`, which fetches it into a temporary environment, runs it, and installs nothing into the repository you point it at:

```bash
pnpm dlx github:0xb1te/ql-pipeline init
```

Pin a commit in production repos so an upstream change never surprises you:

```bash
pnpm dlx github:0xb1te/ql-pipeline#55ca4f1 init
```

`dist/` ships committed in the repository — fetching never needs to run a build script, just Node 20+ and network access to GitHub. This is deliberate: recent pnpm versions block git-hosted packages from running lifecycle scripts by default (`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`), which would otherwise break the install entirely. See [docs/011-committed-dist/plan.md](011-committed-dist/plan.md) if you're wondering why a TypeScript repo has compiled JS in git.

`doctor` and `upgrade` run the same way. A pnpm workspace needs nothing special for any of them: `dlx` never writes to a `package.json`, so the root-or-package question `pnpm add` has to ask never comes up.

pnpm caches what `dlx` fetched, so a second run takes under a second where the first takes several. That cache is also the one thing to know about `upgrade`: an unpinned run can refresh your managed files to a version older than today's `main`. `pnpm --config.dlx-cache-max-age=0 dlx …` forces a re-fetch.

### Do not add ql-pipeline to a governed repository's dependencies

A repository governed by the pipeline does not need ql-pipeline installed, and installing it can break that repository's own CI.

**It buys nothing.** The caller workflow `init` scaffolds is a single `uses:` line naming the reusable workflow by ref. Each of that workflow's three jobs checks `0xb1te/ql-pipeline` out into `.ql-pipeline/` and builds it there. Your repository's own `node_modules` is never read by any of them.

**It costs you your lockfile.** ql-pipeline depends on `@0xb1te/house-client` and `@0xb1te/ql-auth-client`, which are `github:` specs pointing into `0xb1te/ql-docs` and `0xb1te/ql-auth` — both private, and owned by an account that is probably not the one that owns your repository. A devDependency writes those two specs into *your* lockfile, and from then on every `pnpm install` in your repository needs git credentials for two foreign private repositories. On a GitHub runner the job's `GITHUB_TOKEN` is scoped to your repository alone and cannot clone either of them, so any workflow of your own that installs dependencies stops working — including a deploy that runs `pnpm install --frozen-lockfile` after it has already applied infrastructure.

If you want the bin on `PATH` anyway — a repository that already gives its jobs credentials for those two repos before they install, and wants the shorter `pnpm ql-pipeline …` — then take it on deliberately:

```bash
pnpm add -D github:0xb1te/ql-pipeline      # plain repository
pnpm add -D github:0xb1te/ql-pipeline -w   # pnpm workspace — without -w, pnpm refuses with ERR_PNPM_ADDING_TO_ROOT
```

Everywhere else, `pnpm dlx` is the answer.

> **Do you need a registry?** Not to start. Move to GitHub Packages later if you want semver ranges (`^0.2.0`) or CI installs without SSH keys; the CLI is unaffected either way.

## Commands

### `ql-pipeline init`

Scaffolds the repository. Creates only what is missing — running it twice is safe, and running it on a partly-configured repo fills in the gaps without touching anything you already have.

```bash
pnpm dlx github:0xb1te/ql-pipeline init
```

Writes:

| File | Mode |
|---|---|
| `.github/workflows/pr-governance.yml` | managed |
| `.github/pipeline.config.yml` | **yours** |
| `.cursor/rules/*.mdc` | managed |
| `.ql-pipeline/manifest.json` | managed |

It also appends `.standards/` to `.gitignore` if absent, and prints the steps it cannot do for you: adding the repository secrets, filling in your real build commands, and optionally cloning the standards for your editor.

### `ql-pipeline upgrade`

Refreshes managed files to the version it fetches and runs.

```bash
pnpm dlx github:0xb1te/ql-pipeline upgrade
```

**The guarantee: it never silently discards your work.**

| Situation | What happens |
|---|---|
| Managed file, untouched since we wrote it | Updated |
| Managed file, **you edited it** | **Left alone**, reported, with instructions |
| Managed file, missing | Created (it may be new in this version) |
| `pipeline.config.yml` (yours) | Never touched — not even with `--force` |
| No manifest entry to prove we wrote it | Treated as yours, left alone |

`--force` overwrites managed files you edited. It still will not touch `pipeline.config.yml`; that file holds your build commands and target branch, and losing it is not a recoverable inconvenience.

How it knows: `init` and `upgrade` record a content hash of every managed file in `.ql-pipeline/manifest.json`. A file whose current hash matches the recorded one is provably unmodified since we wrote it. Anything else — edited, or with no record at all — is assumed to be yours. Line endings are normalised first, because a Windows checkout rewriting LF to CRLF is not an edit.

Commit `.ql-pipeline/manifest.json`. Without it every upgrade conservatively refuses to touch anything.

### `ql-pipeline doctor`

Checks the setup and exits non-zero if anything is broken, so it can run in CI.

```bash
pnpm dlx github:0xb1te/ql-pipeline doctor
```

```
[  ok  ] caller workflow: present and calling ql-pipeline
[  ok  ] pipeline config: valid, target branch "main"
[  ok  ] gates: configured for frontend, backend
[ warn ] standards: not checked out locally (govern reads house-api instead, so this only affects your editor)
          → git clone git@github.com:0xb1te/ql-docs.git .standards
[  ok  ] cursor rules: 7 rule(s) installed
```

`fail` exits 1; `warn` exits 0.

**What it cannot check:** whether `GH_PACKAGES_TOKEN`, `CURSOR_API_KEY`, `QL_PIPELINE_AGENT_API_KEY`, `OPENAI_API_KEY`, `QL_HOUSE_API_URL`, `QL_AUTH_URL`, `QL_AUTH_CLIENT_ID`, and `QL_AUTH_CLIENT_SECRET` are set. Those are GitHub Actions secrets, which a local CLI has no business reading — it says so rather than implying a clean bill of health it cannot give. `doctor` also never calls `house-api` itself — it only checks a local `.standards/` checkout, which is optional and used only by your editor.

## CI commands

The reusable workflow runs these; you do not invoke them by hand.

```bash
ql-pipeline gate --stage test    # the "test" check
ql-pipeline gate --stage build   # the "build" check
ql-pipeline govern               # the "ql-pipeline" check
```

## Typical lifecycle

```bash
# once, per repository
pnpm dlx github:0xb1te/ql-pipeline init
# …add secrets, edit gates, open one PR and watch it…
pnpm dlx github:0xb1te/ql-pipeline doctor

# whenever ql-pipeline gains something you want
pnpm dlx github:0xb1te/ql-pipeline upgrade
```

Nothing in that lifecycle installs ql-pipeline into the repository, and nothing needs a separate update step: each `dlx` run fetches the version at the ref you name.

## MCP: driving `doctor`/`init`/`upgrade` from an agent

`ql-pipeline` ships a second bin, `ql-pipeline-mcp`, alongside the CLI: a stdio MCP server exposing these same three maintenance commands as tools an AI agent can call directly, instead of a person running them from a terminal.

```bash
pnpm dlx --package github:0xb1te/ql-pipeline ql-pipeline-mcp
```

`--package` is needed here and nowhere else in this document: `dlx` runs the bin that shares the package's name, and the MCP server is the second one.

It speaks newline-delimited JSON-RPC over stdio (`initialize`, `tools/list`, `tools/call`) — the same shape `house-api`'s own `apps/house-api/mcp/house-mcp.mjs` bridge uses. Point an MCP-capable agent at this command and it will see three tools:

| Tool | Same as | Arguments |
|---|---|---|
| `ql_pipeline_doctor` | `ql-pipeline doctor` | `root` (absolute path, optional) |
| `ql_pipeline_init` | `ql-pipeline init` | `root` (absolute path, optional) |
| `ql_pipeline_upgrade` | `ql-pipeline upgrade` | `root` (absolute path, optional), `force` (boolean, optional) |

Unlike the reusable workflow, which forwards to in-process code, this server spawns the already-built CLI (`dist/main.js`) as a child process per call — exactly what running the command from a terminal does — and returns its combined stdout/stderr and exit status as the tool result (`isError: true` on a non-zero exit). `gate` and `govern` are deliberately **not** exposed here: they are CI-triggered checks, not maintenance actions an agent should invoke ad hoc.
