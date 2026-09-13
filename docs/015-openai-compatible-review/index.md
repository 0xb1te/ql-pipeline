# 015 — Review PRs through an OpenAI-compatible endpoint

> Written 2026-09-07. Gate 1 approved in-session (operator confirmed an OpenAPI / OpenAI chat-completions compatible endpoint).

## What

ql-pipeline can send the AI review to any HTTP endpoint that speaks the OpenAI chat-completions API, instead of only spawning `cursor-agent`. This repository itself stays on the Cursor CLI. A consumer that wants another vendor sets `agent.provider: openai_compatible` plus a `base_url` and model.

## Why

014 pinned which Cursor model reviews and fixes. That still requires the Cursor CLI and `CURSOR_API_KEY`. Operators who already run an OpenAI-compatible gateway (OpenAI itself, a proxy, a self-hosted model) need review without stretching `agent.model` into a URL or putting a token in YAML. Review is a completion; a completion cannot write a fix commit, so auto-fix stays Cursor-only.

## Who It Is For

Operators of ql-pipeline and any consumer repo that wants review against an OpenAI-compatible `POST {base_url}/chat/completions` endpoint.

## What The User Will See

- This repo's PR review and auto-fix stay on Grok via Cursor (`provider: cursor`, `model: cursor-grok-4.6-xhigh-fast`).
- A consumer can set `agent.provider: openai_compatible`, `agent.model`, and `agent.base_url`. The workflow then POSTs the review prompt to `{base_url}/chat/completions` with a bearer token from `QL_PIPELINE_AGENT_API_KEY` or `OPENAI_API_KEY`.
- A FIX verdict after that review is labelled `needs-human` instead of pretending an HTTP completion can push a fix.
- Tokens never appear in `pipeline.config.yml`. A missing token fails the check with an honest message.

## What Will Not Change

- Prompt templates, gates, merge rules, or standards.
- This repo's default provider. It stays Cursor.
- The fixer. It still requires `cursor-agent`.
- No token in YAML, logs, or docs.

## Status

| Gate | Closed | Date |
|---|---|---|
| Gate 1 — plan approved | `yes` | `2026-09-07` |
| Gate 2 — result approved | `pending` | `YYYY-MM-DD` |
| Gate 3 — verified in production | `pending` | `YYYY-MM-DD` |

- **Branch:** `features/014-cursor-agent-model`
- **Tracked as:** pending Sprint/Notion filing after Gate 2
