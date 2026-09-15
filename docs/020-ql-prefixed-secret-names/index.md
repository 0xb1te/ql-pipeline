# 020 — `HOUSE_API_URL` becomes `QL_HOUSE_API_URL`

Every QL-suite secret carries a `QL_` prefix — `QL_AUTH_URL`, `QL_AUTH_CLIENT_ID`,
`QL_AUTH_CLIENT_SECRET`, `QL_PROXY_TOKEN`, `QL_PIPELINE_AGENT_API_KEY` — except the one
naming house-api. This gives it the prefix, so `QL_` consistently means "a QL suite
component".

`CURSOR_API_KEY` and `GH_PACKAGES_TOKEN` keep their names on purpose: they identify
third-party vendors, not QL components.

## What an operator has to do

Nothing, immediately. Both names are read and the prefixed one wins, so a repo that
still holds `HOUSE_API_URL` keeps working exactly as before — the `ql-pipeline` job just
logs a deprecation line naming the new spelling.

When convenient: add `QL_HOUSE_API_URL` with the same value, and delete `HOUSE_API_URL`.

## Why the fallback exists rather than a clean rename

Consumers call the reusable workflow at `@main`, so they pick a rename up the moment it
merges — before anyone has created the new secret. `secrets: inherit` forwards whatever
exists, so a renamed secret is simply absent and `govern` fails closed with "missing
environment variable(s)". A bare rename would turn every governed repo's check red at
its next PR, for a cosmetic change. See [plan.md](plan.md).

## What does not change

- Which four variables `govern` needs, or that all four are required unless
  `standards.enabled: false`.
- Gate, review, merge and fix-loop behaviour.
- `QL_AUTH_*`, `QL_PROXY_TOKEN`, `CURSOR_API_KEY`, `GH_PACKAGES_TOKEN`.

## Follow-up

Remove the `HOUSE_API_URL` fallback — `LEGACY_HOUSE_API_URL_VAR` in
`src/standards/house-credentials.ts`, its branch in `readHouseCredentialsFromEnv`, the
warning in `runGovern`, and the retained secret in `.github/workflows/pr-pipeline.yml` —
once every governed repo has migrated.
