# 015 — Plan: OpenAI-compatible review provider

**Tracked as:** pending Sprint/Notion filing after Gate 2

## Neurons read

- `shared.core.types` — `AgentConfig` already has `provider`, `model`, `baseUrl`
- `shared.core.config#parseConfig` — pairing rules for cursor vs openai_compatible
- `review.reviewer.cursorRunner` — envelope and `CursorAgentRunner` shape
- `review.reviewer.reviewer#runReview` — injected runner, ask mode
- `review.reviewer.responseParser#parseReviewVerdict` — unwraps the cursor-agent envelope
- `entrypoint.cli.governCommand#runGovern` — wires review and fix
- `fix.fixer.fixer#runFix` — still Cursor-only

## Neurons to add

- `review.reviewer.openaiCompatibleRunner` — env key + HTTP reviewer factory

## Neurons to change

- `entrypoint.cli.governCommand` — inject the HTTP reviewer; skip fixer on openai_compatible; `shouldSkipCursorFixer`
- `shared.core.config` / `shared.core.types` — already parse provider/base_url; intent updated
- `review.reviewer.reviewer` — document the injected OpenAI-compatible runner

## In scope

- `agent.provider: cursor | openai_compatible` (default cursor)
- `agent.base_url` required only for openai_compatible; forbidden on cursor
- Review: `POST {base_url}/chat/completions` with bearer from env
- Wrap assistant text in `{ type, is_error: false, result }`
- FIX + openai_compatible → escalate to human
- Workflow secrets optional: `CURSOR_API_KEY`, `QL_PIPELINE_AGENT_API_KEY`, `OPENAI_API_KEY`
- Consumer template + integration-guide + this folder
- Tests for parse, runner envelope, HTTP error hygiene, missing key, fixer skip

## Out of scope

- Putting tokens in YAML
- Making the fixer speak HTTP
- Changing this repo's default off Cursor
- Stretching `agent.model` to mean a URL
- Per-phase different providers (review vs fix beyond the Cursor-only skip)

## Acceptance

1. Omit `agent` → provider `cursor`, model/baseUrl null (today's behaviour).
2. `provider: openai_compatible` without model or base_url is a ConfigError.
3. `base_url` on cursor is a ConfigError.
4. Review POST succeeds → stdout is a cursor-agent envelope `parseReviewVerdict` accepts.
5. HTTP error → stderr names the status only; body and key are not echoed.
6. Missing env key → honest message naming both variable names.
7. Agent/fix mode on the HTTP runner → exit 1, Cursor-only message.
8. FIX after openai_compatible review → escalate, no `runFix`.
9. This repo's `pipeline.config.yml` stays `provider: cursor` with the Grok slug.
