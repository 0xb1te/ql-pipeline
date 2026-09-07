# 016 — Review packs live in ql-docs

Sprint: [Centralize PR review packs in ql-docs](https://app.notion.com/p/Centralize-PR-review-packs-in-ql-docs-3d4d2993e9a981ec9dcaffc5a15fc55d) (`3d4d2993e9a981ec9dcaffc5a15fc55d`).

ql-pipeline used to decide *which* ql-docs pages a reviewer saw by looking up the PR's areas in `standards.docs` and opening the matching build-stage checklists (`workflow/rules/stage-2-…`, `stage-4-…`, and so on). That mixed three jobs: how to *build* a technique, how to *run* a feature/hotfix/bugfix, and how to *judge a pull request*. The first two stay where they are. The third now has its own tree.

What an operator sees after this change:

- A feature PR (`features/…`) is judged against `workflow/review/pr-feature`.
- A hotfix PR (`hotfixes/…`) is judged against `workflow/review/pr-fix`.
- A bugfix PR (`bugfixes/…`, or a plain `fix` on an unnamed branch) is judged against `workflow/review/pr-bugfix`.
- The `github_agent` client needs `review:*` (or the three `review:pr-*` routes), not `stage:1`–`stage:9`.
- Putting extra paths in `standards.docs` does nothing. The pack path is a convention.

What does **not** change:

- Gate, merge, and fix-loop behaviour.
- That standards still come from house-api in CI (or a local `.standards` clone for `doctor`).
- The Cursor authoring rules that still point at the build-stage trees when someone is *writing* code.

This repo does not own the pack text. That lives in ql-docs and must merge first so house-api can serve `workflow/review/`.
