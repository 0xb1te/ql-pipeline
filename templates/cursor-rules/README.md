# Cursor rules — house workflow

Copy-paste rules that make Cursor produce work matching the house methodology (`ql-docs`) and pass the [ql-pipeline](https://github.com/0xb1te/ql-pipeline) PR review.

These are the **write side**. ql-pipeline is the **review side**. Both read the same `ql-docs` checklists, so what Cursor is told to do here is exactly what the pipeline will check for later.

---

## Install into a project

```bash
# 1. Copy the rules in — the template mirrors the target layout, so this
#    drops straight into place as .cursor/rules/
cp -r /path/to/ql-pipeline/templates/cursor-rules/.cursor .

# 2. Make the standards readable by Cursor, at the SAME path CI uses
git clone git@github.com:0xb1te/ql-docs.git .standards

# 3. Keep the clone out of the repo
echo '.standards/' >> .gitignore
```

> **Why `.standards/`?** ql-pipeline checks `ql-docs` out to exactly that path when reviewing a PR. Using the same location locally means every `.standards/workflow/...` reference in these rules resolves identically in your editor and in CI — one set of paths, no translation.

Keep it current with `git -C .standards pull`.

## What each rule does

| File | Applies | Purpose |
|---|---|---|
| `00-house-workflow.mdc` | Always | The methodology, where the standards live, and which stage owns what |
| `01-task-format.mdc` | Always | **How to start a task** — routing it to the right stage, branch, scope, definition of done |
| `02-commits-and-prs.mdc` | Always | Conventional commits and PR rules ql-pipeline enforces |
| `10-frontend.mdc` | `apps/*frontend*/**` | Stage-2 / Stage-5 split and the anti-rewrite contract |
| `20-backend.mdc` | `apps/*backend*/**` | Stage-4 layered architecture |
| `21-sql-migrations.mdc` | migration files | Additive, backwards-compatible migrations |
| `22-testing.mdc` | test files | The six-path testing strategy |

Rules marked *Always* are small on purpose — they stay in context permanently. The area rules attach only when you touch matching files, so a frontend task never carries backend rules.

## If your layout differs

The area rules key off `apps/*frontend*` and `apps/*backend*`. If yours differs, edit the `globs:` line in each `.mdc` — and change `areas.paths` in your `.github/pipeline.config.yml` to match, so the pipeline routes the same way you do.
