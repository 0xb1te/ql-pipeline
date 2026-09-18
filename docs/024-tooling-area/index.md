# 024 — A `tooling` area for the commit grammar

The commit header's area is not a label. `reviewPackEntries` turns it into
`workflow/review/<kind>/<area>.md`, the checklist the AI reviewer judges the diff against.
Choosing an area chooses a standard.

Seven areas existed — `frontend`, `backend`, `mobile`, `ios`, `android`, `infrastructure`,
`docs` — all shaped for a frontend-plus-backend web app, and none of them for *how this
repository is built and checked*. Work of that shape ends up filed under whichever product
area its files happen to sit in.

A recent case in ql-desktop: a three-line fix to a `tsconfig` module-resolution error went in
as `fix(frontend)`, because the file lived under `src/components/`. Governance routed it
`frontend` from the header, added `backend` and `docs` from the changed paths, and loaded
three product checklists to judge three lines of module resolution. Not a mislabelled commit —
correct work reviewed against the wrong standard.

`tooling` is the eighth area: build and compiler configuration, linters, test harness and
fixtures, lockfiles, dev scripts. Anything that changes how the repository is *checked*
without changing what the product *does*.

## The line people will get wrong

> `infrastructure` is how the product runs somewhere. `tooling` is how the repository is
> checked here.

A deploy workflow is the first. A `tsconfig` that decides which files get compiled is the
second. That sentence appears verbatim everywhere the area list does.

## What an operator has to do

Nothing. The seven existing areas parse exactly as before, no consumer config changes, and
path-based detection stays opt-in — nothing routes to `tooling` until someone writes it in a
commit header or maps it in `areas.paths`.

## Order matters

`AREAS` feeds `allReviewDocumentPaths()`, and `doctor` reports a missing
`workflow/review/<kind>/<area>.md` for every area × kind. Merging this before the packs exist
upstream would add three missing-document lines to every governed repository at once.

ql-docs [#7](https://github.com/0xb1te/ql-docs/pull/7) carries the three packs and **merges
first**. See [`plan.md`](plan.md).

## Also written down

Two things that were folklore rather than rules, and cost this session real time:

- **Which area a non-web repository uses.** Everyone already maps an Electron main process to
  `backend` and the renderer to `frontend` — it is visible in ql-desktop's history — but it
  was written nowhere, so each agent rediscovers it and some guess wrong. Now a table.
- **A type-check or build failure is a `build`, not a `fix`.** `fix` claims the product
  behaved wrongly; a compiler configuration rejecting a legal file is not the product
  misbehaving. It matters beyond pedantry: `build` and `ci` skip the build gate, because
  rebuilding to validate a build-config change is circular.
