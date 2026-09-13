# 014 — Pin which Cursor model reviews and fixes PRs

> Written 2026-09-07. Gate 1 approved in-session ("do it right now").

## What

ql-pipeline can name the Cursor CLI model used for AI review and auto-fix, instead of silently taking whatever default the CLI picks for the API key. This repository itself is set to Grok 4.6 Extra High Fast.

## Why

Review and fix already spawn `cursor-agent` with `CURSOR_API_KEY`, but never passed `--model`. Switching to Grok (or any other listed slug) was impossible from config. A hardcoded flag would lock every consumer; a config key lets this repo pin Grok and leaves others on the CLI default until they opt in.

## Who It Is For

Operators of ql-pipeline and any consumer repo that wants a pinned review/fix model.

## What The User Will See

- This repo's PR review and auto-fix run on Grok 4.6 Extra High Fast (`cursor-grok-4.6-xhigh-fast`), still billed to the existing `CURSOR_API_KEY`.
- Consumer repos that omit `agent.model` behave exactly as before.
- Setting `agent.model` in `pipeline.config.yml` is the one place to change the model later.

## What Will Not Change

- Prompt templates, gates, merge rules, or standards.
- No second token. Auth stays `CURSOR_API_KEY`.
- The CLI is still `cursor-agent`. This does not add another vendor.

## Status

| Gate | Closed | Date |
|---|---|---|
| Gate 1 — plan approved | `yes` | `2026-09-07` |
| Gate 2 — result approved | `pending` | `YYYY-MM-DD` |
| Gate 3 — verified in production | `pending` | `YYYY-MM-DD` |

- **Branch:** `features/014-cursor-agent-model`
- **Tracked as:** https://app.notion.com/p/Pin-ql-pipeline-cursor-agent-to-Grok-4-6-Extra-High-Fast-3d4d2993e9a981ea92d6f6e7ef1d3d5e
