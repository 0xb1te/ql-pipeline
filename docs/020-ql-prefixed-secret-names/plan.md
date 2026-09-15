# Task 020 — Rename `HOUSE_API_URL` to `QL_HOUSE_API_URL`

| | |
|---|---|
| **Status** | In progress |
| **Goal** | Bring the house-api origin secret under the `QL_` prefix every other QL-suite secret uses, without turning a rename into a red check on every governed repo. |

## Why

`QL_AUTH_URL`, `QL_AUTH_CLIENT_ID`, `QL_AUTH_CLIENT_SECRET`, `QL_PROXY_TOKEN` and
`QL_PIPELINE_AGENT_API_KEY` all carry the prefix. `HOUSE_API_URL` names a QL suite
component (`house-api`, served by ql-docs) and does not. `CURSOR_API_KEY` and
`GH_PACKAGES_TOKEN` stay unprefixed deliberately: they name third-party vendors, so
`QL_` continues to mean "a QL suite component".

## The hazard this plan exists to avoid

Consumers call the reusable workflow at `@main`, so they pick up a rename the moment it
merges — before anyone has created the new secret. `secrets: inherit` forwards whatever
exists; a renamed secret is simply absent, and `readHouseCredentialsFromEnv` throws
`missing environment variable(s) required to read standards from house-api`. A bare
rename turns every governed repo's `ql-pipeline` check red at its next PR.

So both names are read, new one wins, and the run says so when it falls back.

## Design

`readHouseCredentialsFromEnv` reads `QL_HOUSE_API_URL ?? HOUSE_API_URL` and reports
which one it used on a new `houseApiUrlSource` field. It does not print: architecture
invariant 1 keeps this function pure, so `runGovern` owns the `logger.warn`. The
workflow declares and forwards both names; the code decides precedence, not YAML.

## Neurons read

- `standards.reader.houseCredentials` — reads the four variables
- `entrypoint.cli.governCommand` — calls it, and names the four in its escalation comment
- `entrypoint.cli.scaffoldCommands` / `scaffold.core.doctor` — name them in operator checklists

## Neurons added / changed

| Neuron | Change |
|---|---|
| `standards.reader.houseCredentials` | `HouseCredentials.houseApiUrlSource`; reads the new name first, falls back to the old |
| `entrypoint.cli.governCommand` | Warns once on the legacy name; escalation text names `QL_HOUSE_API_URL` |
| `entrypoint.cli.scaffoldCommands` | Checklist text names `QL_HOUSE_API_URL` |
| `scaffold.core.doctor` | Comment names `QL_HOUSE_API_URL` (doctor still cannot read secrets) |

## R4 note

`.github/workflows/pr-pipeline.yml` is an R4-protected path. The repo owner asked for
this rename directly in the session that produced this plan; the change to that file is
additive (a new `QL_HOUSE_API_URL` secret alongside the retained `HOUSE_API_URL`).

## Out of scope

- Renaming `CURSOR_API_KEY` or `GH_PACKAGES_TOKEN` (they are not QL components)
- Removing the `HOUSE_API_URL` fallback — a follow-up, once consumers have migrated
- `docs/013-house-backed-standards/plan.md`, which records what was true at the time

## Exit criteria

1. `QL_HOUSE_API_URL` alone works.
2. `HOUSE_API_URL` alone still works, and the run warns that it is deprecated.
3. Both set: the new name wins.
4. Neither set: the error names `QL_HOUSE_API_URL`.
5. `pnpm run typecheck && pnpm run lint && pnpm run build && pnpm test` green; `dist/` rebuilt.
