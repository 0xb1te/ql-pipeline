# Task 009 — House engineering standards

| | |
|---|---|
| **Status** | 🟢 Done |
| **Goal** | Make the reviewer judge code against the organisation's own workflow documentation (`prompt-utils`), and detect areas from the `apps/*frontend*` / `apps/*backend*` monorepo layout. |

## What the standards actually are

`0xb1te/prompt-utils` holds the house workflow, organised by stage:

```
workflow/
  stage-1-viability  stage-2-mockup  stage-3-openapi
  stage-4-backend/   ← backend/, sql/, tests/
  stage-5-frontend/  ← 01-components … 26-legal-compliance
  stage-6-integration  stage-7-deployment  stage-8-polish
  stage-9-marketing    stage-10-feature
```

Each stage contains two very different kinds of document, and the distinction drove the whole design:

- **`PROMPT.md` and `CREATE-*.md`** — instructions for *generating* code. Handing these to a reviewer would tell it how to write code, not how to judge it.
- **`checklist.md`** — the stage's quality gate, written as `- [ ]` requirements ("No file under `src/shared/ui/` was modified", "Every non-visual capability is provided through a stage-2-exposed seam"). **These are review criteria already.**

So the pipeline loads only the checklists. That was a judgement call, and it's the one that makes the feature work rather than produce noise.

## How the standards reach the runner

`prompt-utils` is a **private** GitHub repo, so vendoring a copy into ql-pipeline would go stale and a plain checkout won't authenticate. The workflow checks it out at review time into `.standards/`, using a `STANDARDS_TOKEN` secret, exactly as it already checks out ql-pipeline itself. Reviews therefore always reflect the current standards, with no sync step to forget.

The default `GITHUB_TOKEN` is scoped to the repo under review and **cannot** read another repository — so `STANDARDS_TOKEN` is genuinely required, not optional polish. This is stated in the integration guide rather than left to be discovered.

## Fail-closed on missing standards

If `standards.enabled` is true and a configured document can't be loaded, the PR **escalates to a human** instead of being reviewed without it.

This is the same principle as RULES.md R6.0: a review that silently ignores the standards is worse than no review, because the repository would believe the standards were applied. The failure message names the missing documents and the two ways to resolve it (fix the token, or turn standards off).

## Area detection from paths

Areas now come from the union of two signals:

1. **Conventional-commit headers** — still the only thing that decides routability.
2. **Changed paths** — `apps/*frontend*/**` → `frontend`, `apps/*backend*/**` → `backend`.

Path detection is **additive on purpose**. A PR whose commits all say `feat(frontend)` but which also edits `apps/api-backend/` gets backend rules and backend standards applied as well — the commit header cannot narrow what gets reviewed. It deliberately does *not* rescue a PR with no valid header: commit hygiene stays mandatory (RULES.md R2), and existing routability behaviour is unchanged.

A small glob matcher (`*` within a segment, `**` across segments, `?` one character) avoids adding a dependency for three patterns.

## Grounding generalised

Findings previously had to cite `<something>.rules#<id>`; the check was hardcoded to the `.rules` suffix. It now accepts **any loaded reference id**, so `backend.standards#09-controllers` grounds exactly like `backend.rules#no-string-concat-sql`, and both remain subject to the same discard-if-unreal guard.

## Verified against the real documents

Not just fixtures — the resolver was run against the actual local `prompt-utils` checkout:

| Areas | Loaded | Size |
|---|---|---|
| `frontend` | `frontend.standards` | 55,177 chars (~13.8k tokens) |
| `backend` | `backend.standards` | 94,123 chars (~23.6k tokens) |
| both | both | 149,782 chars (~37.4k tokens) |

**This caught a real defect.** The first budget (90,000 chars/area) silently truncated the backend standards, dropping trailing sections of the checklist the reviewer was supposed to apply. The default is now 120,000, which fits both areas whole with headroom. Truncation, when it does happen, cuts on a `## ` section boundary so no requirement is ever quoted half-way, and says so in both the prompt and the run log.

## A note on ql-pipeline conforming to the standards

ql-pipeline is **infrastructure tooling** — a TypeScript CLI and a reusable workflow — not an `apps/*` product application. The stage-4/stage-5 checklists describe Spring Boot backends and component-based frontends; they do not meaningfully apply to it, and pretending otherwise would produce meaningless findings.

Concretely: ql-pipeline's own PRs are `infrastructure` or `docs`, those areas have no standards documents configured, so its dogfood runs review against `rules/*.rules` alone and load no standards. What ql-pipeline does is **enforce** that architecture on the product repositories it governs. Its own conformance obligations are in [RULES.md](../../RULES.md).

## Verification

`npm run typecheck && npm run lint && npm run build && npm test` green — **345 tests across 31 files**. Plus the real-document resolution above, and the workflow's input/secret/step graph asserted by parsing the YAML.

Verification boundary unchanged from [SPECIFICATION.md §8](../SPECIFICATION.md): no live Actions run, no live `cursor-agent` cycle. Note that the standards materially enlarge the review prompt (~14–37k tokens), which is worth watching on the first real runs.
