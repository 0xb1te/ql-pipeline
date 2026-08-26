# The `ql-pipeline` CLI

Adopt the pipeline in a repository and keep the files it manages current.

The pipeline **engine** does not need this CLI — consumers reference the reusable workflow by ref, so improvements to routing, review, and fixing reach every repo on their next PR automatically. What does not auto-update is the consumer-side scaffolding: the caller workflow, the config, and the Cursor rules. That is what this CLI installs and maintains.

## Install

`ql-pipeline` is a private package installed straight from its GitHub repository — no registry, no publishing pipeline:

```bash
pnpm add -D github:0xb1te/ql-pipeline
```

Pin a tag in production repos so an upstream change never surprises you:

```bash
pnpm add -D github:0xb1te/ql-pipeline#v0.1.0
```

Installing from git runs the package's `prepare` script, which builds it — you need Node 20+ and network access to GitHub, nothing else.

> **Do you need a registry?** Not to start. Move to GitHub Packages later if you want semver ranges (`^0.2.0`) or CI installs without SSH keys; the CLI is unaffected either way.

## Commands

### `ql-pipeline init`

Scaffolds the repository. Creates only what is missing — running it twice is safe, and running it on a partly-configured repo fills in the gaps without touching anything you already have.

```bash
pnpm ql-pipeline init
```

Writes:

| File | Mode |
|---|---|
| `.github/workflows/pr-governance.yml` | managed |
| `.github/pipeline.config.yml` | **yours** |
| `.cursor/rules/*.mdc` | managed |
| `.ql-pipeline/manifest.json` | managed |

It also appends `.standards/` to `.gitignore` if absent, and prints the steps it cannot do for you: adding the two repository secrets, filling in your real build commands, and cloning the standards for your editor.

### `ql-pipeline upgrade`

Refreshes managed files to the installed version.

```bash
pnpm update ql-pipeline && pnpm ql-pipeline upgrade
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
pnpm ql-pipeline doctor
```

```
[  ok  ] caller workflow: present and calling ql-pipeline
[  ok  ] pipeline config: valid, target branch "main"
[ warn ] gates: no area has build or test commands configured, so those checks will pass vacuously
          → set gates.<area>.build / .test in the pipeline config
[ warn ] standards: not checked out locally (CI clones them itself, so this only affects your editor)
          → git clone git@github.com:0xb1te/prompt-utils.git .standards
[  ok  ] cursor rules: 7 rule(s) installed
```

`fail` exits 1; `warn` exits 0.

**What it cannot check:** whether `CURSOR_API_KEY` and `STANDARDS_TOKEN` are set. Those are GitHub Actions secrets, which a local CLI has no business reading — it says so rather than implying a clean bill of health it cannot give.

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
pnpm add -D github:0xb1te/ql-pipeline
pnpm ql-pipeline init
git clone git@github.com:0xb1te/prompt-utils.git .standards
# …add secrets, edit gates, open one PR and watch it…
pnpm ql-pipeline doctor

# whenever ql-pipeline gains something you want
pnpm update ql-pipeline
pnpm ql-pipeline upgrade
```
