# Task 016 — Load only `workflow/review/pr-*`

| | |
|---|---|
| **Status** | In progress |
| **Sprint** | https://app.notion.com/p/Centralize-PR-review-packs-in-ql-docs-3d4d2993e9a981ec9dcaffc5a15fc55d |
| **Goal** | Stop mapping areas onto build-stage checklists. Load the ql-docs review pack that matches the PR's kind. |

## Neurons read

- `standards.reader.standardsResolver` — used to concatenate `config.docs` paths per area
- `standards.reader.HouseStandardsReader` — opened `stage:N` from a `workflow/rules/stage-N-*` path
- `entrypoint.cli.governCommand` — called `resolveStandards` with no kind
- `entrypoint.cli.scaffoldCommands` — doctor walked `config.docs`
- `shared.core.config` — defaulted `standards.docs` to the stage checklists
- `scaffold.core.doctor` — reported a missing configured path

## Neurons added / changed

| Neuron | Change |
|---|---|
| `standards.reader.reviewKind` | **New.** `reviewKindFor(headRef, types)` |
| `standards.reader.standardsResolver` | Pack convention; ignores `config.docs` |
| `standards.reader.HouseStandardsReader` | Prefer `review:${pack}` for `workflow/review/` paths; keep `stage:N` for leftover fixtures |
| `entrypoint.cli.governCommand` | Passes the kind into `resolveStandards` |
| `entrypoint.cli.scaffoldCommands` | Doctor walks all three packs |
| `shared.core.config` | Default `docs` is `{}` |

## In scope

- `src/standards/review-kind.ts` and its tests
- `resolveStandards` / House reader / govern / doctor
- Setup, integration, and specification docs (`review:*`, no path map)
- Harness lockstep for the neurons above
- `docs/016-review-pr-packs/`

## Out of scope

- Rewriting Cursor authoring rules that point at `workflow/rules/` (those are for writing code)
- Stopping `govern` from also injecting `.rules` into the reviewer prompt
- Changing house-api or ql-auth
- The 014/015 cursor-model / openai-compatible work on the other checkout

## Verification

- `pnpm test` and `pnpm build`
- `validate-harness.py` against this surface
