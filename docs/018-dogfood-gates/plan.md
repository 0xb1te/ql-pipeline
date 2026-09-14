# Task 018 — Make ql-pipeline's own gates runnable

| | |
|---|---|
| **Status** | Approved by the repo owner in session 2026-09-14; implemented |
| **Goal** | Let ql-pipeline gate its own PRs. Its `infrastructure` gate runs Terraform tooling that is neither installed nor relevant, so every PR to this repo fails its own test gate. |

## Why

`pipeline.config.yml` is two things at once, and the two have been in conflict:
this repo's **live configuration**, and a **worked example of the schema**. The
example won, and the live half stopped working.

Per R2.1 all pipeline work is area `infrastructure`. That area's gate is:

```yaml
  infrastructure:
    build: "terraform validate"
    test: "tflint && checkov -d ."
```

ql-pipeline is TypeScript on Node. `tflint` is not installed on the runner and
would have nothing to say about this repo if it were. So every PR here does
this:

```
[info] infrastructure/test: FAILED (tflint && checkov -d .)
[error] /bin/sh: 1: tflint: not found
##[error]1 test gate(s) failed: infrastructure
```

and then, because a required gate failed:

```
[info] skipping AI review: a required gate failed, so there is no point
       reviewing code that fails to build
```

So the repo whose entire purpose is governing pull requests **has never
actually reviewed one of its own**. PR #6 and PR #7 show the same four-check
signature: `build-lint-test` green, `checks / test` and `checks / ql-pipeline`
red, `checks / build` skipped.

The failure is loud but easy to read as "dogfooding is just noisy here", which
is how it survived. It is not noise — it is the pipeline's own verdict never
being formed.

## In scope

Point the two areas that this repo actually routes to at commands that exist:

```yaml
  infrastructure:
    build: "pnpm install --frozen-lockfile && pnpm run build"
    test:  "pnpm install --frozen-lockfile && pnpm run typecheck && pnpm run lint && pnpm test"
```

`typecheck` and `lint` join `test` deliberately. The gate result is what feeds
MERGE/BLOCK, so a gate that only ran `pnpm test` would let the pipeline approve
a PR that does not compile. `self-check.yml` runs the same four steps; the
duplication is the point — one is CI, the other is the pipeline's own evidence.

`pnpm install` resolves this repo's private git dependencies because
`pr-pipeline.yml` configures the `GH_PACKAGES_TOKEN` URL rewrite globally
(`.github/workflows/pr-pipeline.yml`, "Authenticate ql-pipeline's private git
dependencies") **before** the gate step runs, in all three jobs.

`docs` keeps `build: "true"` / `test: "true"` — a docs PR has nothing to build,
and `true` is a real command that really succeeds.

The five placeholder areas (`frontend`, `backend`, `mobile`, `ios`, `android`)
move into a comment block. They are not this repo's gates — there is no
frontend or Android code here, and `areas.paths` maps them to `apps/*frontend*`
and `apps/*backend*` trees that do not exist. Live, they are a trap: one commit
headed `feat(frontend)` would route to `npm ci && npm run build` and fail the
same way `infrastructure` does today. Commented, they still document the shape.

The schema's worked example does not depend on them either way:
`docs/integration-guide.md` §4 already carries two complete `gates:` blocks of
its own.

## Out of scope

- Every other key in the file. This task fixes what cannot run; it does not
  re-tune what can.
- `rules/*`, `prompts/*`, `.github/workflows/*` — untouched.

## R4

`pipeline.config.yml` is R4-protected: changes need explicit human approval, and
the PR must say so prominently. The repo owner asked for this change directly in
session on 2026-09-14. The PR description flags it.

Note the ordering consequence: because this PR touches a protected path it
routes to a human and will not auto-merge — correct, and unchanged by this task.

## Exit criteria

1. `infrastructure` build and test gates run commands that exist in this repo.
2. A PR to ql-pipeline reaches the AI review instead of skipping it on a failed
   gate — the first time this repo reviews its own code.
3. No placeholder gate can fire for an area this repo has no code for.
4. `pnpm run typecheck && pnpm run lint && pnpm run build && pnpm test` green.
5. Config parses: `src/shared/config.ts` loads it without error.
