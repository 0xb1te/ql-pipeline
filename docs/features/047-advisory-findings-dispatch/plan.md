# 047 — Plan

## The Behaviour Being Changed

`src/verdict/verdict.ts`, pre-change:

```ts
if (blocking.length === 0) {
  return { kind: 'MERGE', advisoryFindings };
}
```

and `src/cli/govern-command.ts:696`:

```ts
if (decision.kind === 'MERGE') { ...executeMergeDecision...; return; }
```

which sits **above** `recordComplaint` (`:729`) and `runFix` (`:801`). So a `should` finding was computed, posted as an inline comment by the merge path, and then nothing looked at it again. No agent of any provider ever saw one.

That is structural, not a misconfiguration — which is why ql-desktop #103 could report seven advisory findings across two runs with nobody assigned to any of them.

## The Fix

When `blocking` is empty, dispatch over the advisory set instead of merging, subject to four guards:

```ts
const dispatchable = advisoryFindings.filter((f) => !f.rule.startsWith('gate#'));

if (
  input.fixAdvisory &&
  dispatchable.length > 0 &&
  dispatchable.length === advisoryFindings.length &&
  dispatchable.every((f) => f.autoFixable) &&
  input.attemptsSoFar < input.maxFixAttempts
) {
  return { kind: 'FIX', findings: dispatchable, advisoryFindings: [] };
}
return { kind: 'MERGE', advisoryFindings };
```

Returning `FIX` is what makes this a small change rather than a large one: the complaint review, the threads, the pickup announcement, attempt counting, the fork guard, the provider guard and the retrigger are all the existing path, untouched.

### Every guard falls back to MERGE, never BLOCK

Deliberate, and recorded as an invariant on the neuron. A `should` finding never blocked a pull request and must not start now. When the attempts are spent, or a finding cannot be auto-fixed, it goes back to being a comment — which is exactly what it was before this task.

### Two kinds of advisory finding

`gateFindings` (`src/verdict/required-checks.ts:29`) sets `severity: requiredChecks.includes(outcome.gate) ? 'must' : 'should'`, with `autoFixable: true` and `rule: 'gate#<area>-<gate>'`.

So a failed gate the repository left out of `required_checks` arrives as an auto-fixable `should` — indistinguishable from a review nit by severity alone. But the two mean opposite things:

- The review judged its finding minor.
- An operator *configured* that gate not to block. That is an instruction: report it, do not act on it.

Dispatching on the second would quietly overrule the only explicit thing the repository said about that gate. Excluded by the `gate#` prefix.

**A mixed set declines entirely** rather than dispatching the reviewable half, because `FIX` empties `advisoryFindings` and the merge path is the only thing that posts it — a split would report the gate nowhere at all.

### How the exclusion was found

Not by reasoning about it first. The first implementation dispatched on everything, and `tests/verdict/required-checks.test.ts` went red on a test whose name states the intent outright: *"a failed non-required gate rides along as advisory and still merges."* That test now passes unchanged, which is the evidence the exclusion is right rather than convenient.

## Config

`fixer.fix_advisory`, boolean, default **true**. Refused with a clear message rather than coerced if it is not a boolean. Documented in the shipped `pipeline.config.yml` sample.

Default-on is a behaviour change for every consumer, which is why it is a config key at all: a repository that would rather read its own nits sets it to `false` and gets the previous behaviour exactly.

## Neurons

`verdict.decision.verdict` — rewritten. The old `invariants` entry said *"should-severity findings never factor into the decision itself"*, which this makes false; it is replaced by the two that are now true (never BLOCK; never dispatch a configured-advisory gate finding). `owns` gains the two-kinds distinction and the reasons for the mixed-set and empty-advisory choices.

No signal added, renamed or removed — `decidePipelineOutcome` changes its input shape, not its identity (**KH-10** N/A).

## Test Plan

Nine new cases on the advisory path plus three on config parsing. The ones carrying the design:

- **`leaves a failed non-required gate alone`** — the configured-advisory exclusion.
- **`declines the whole set when a gate finding is mixed in`** — the no-split rule.
- **`merges rather than blocks once the attempts are spent`** — the invariant that matters most.
- **`leaves the blocking path untouched`** — a `must` finding still decides alone, with advisory riding along.

Every pre-existing verdict test keeps its meaning. The one advisory-only case already used `autoFixable: false`, so the new guard declines it and its assertion is unchanged — the existing suite therefore validates that the new default breaks nothing.

`tests/integration/pipeline-flow.test.ts` and `chaos-safety.test.ts` pass `fixAdvisory` from their own `CONFIG` rather than a literal, so they exercise the real default.

## Explicitly Out Of Scope

- **The `ql_agents` attempt-counting hazard.** `countFixAttempts` reads `[bot]`-suffixed commits, which `runFix` writes and ql-agents does not. Under that provider the counter reads 0 forever and the cap never trips. Survivable while only blocking findings dispatched; more exposed now. Filed separately rather than fixed here, because the fix is a change to how attempts are counted and belongs with its own tests.
- **MCP surface.** No tool, schema or return shape changes; the `MCP Cases` sheet is present and empty.

## Version

`0.4.0 → 0.5.0` (MINOR). A new config key and a changed default behaviour, additive in shape — every existing config parses unchanged. On `0.x` a minor bump is the right home for a behaviour change of this size, and the key exists so the previous behaviour is one line away.
