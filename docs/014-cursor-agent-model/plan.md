# 014 — Plan: configurable Cursor CLI model

**Tracked as:** https://app.notion.com/p/Pin-ql-pipeline-cursor-agent-to-Grok-4-6-Extra-High-Fast-3d4d2993e9a981ea92d6f6e7ef1d3d5e

## Neurons read

- `review.reviewer.cursorRunner` — spawn had no `--model`
- `review.reviewer.reviewer#runReview` — default runner
- `fix.fixer.fixer#runFix` — same runner
- `shared.core.config#parseConfig` / `shared.core.types` — no agent block
- `entrypoint.cli.governCommand` — wires review/fix

## Neurons to change

- `shared.core.types` — `AgentConfig` on `PipelineConfig`
- `shared.core.config` — parse `agent.model`
- `review.reviewer.cursorRunner` — `cursorAgentArgs` + optional `--model`
- `review.reviewer.reviewer` / `fix.fixer.fixer` — thread `model`
- `entrypoint.cli.governCommand` — pass `config.agent.model`

## In scope

- Optional `agent.model` in `pipeline.config.yml`
- This repo pins `cursor-grok-4.6-xhigh-fast`
- Consumer template + integration-guide comment
- Tests for parse, argv, review/fix forwarding

## Out of scope

- New secrets
- Per-phase different models (review vs fix)
- Changing `CURSOR_API_KEY` itself
- Consumer repos' configs (they keep CLI default)

## Acceptance

1. Omit `agent` → no `--model` in argv (today's behaviour).
2. `agent.model: cursor-grok-4.6-xhigh-fast` → `--model cursor-grok-4.6-xhigh-fast` on review and fix.
3. Empty `agent.model` is a ConfigError.
4. Auth remains `CURSOR_API_KEY`.
