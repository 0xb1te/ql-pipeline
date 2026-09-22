// @neuron verdict.decision.verdict
import type { Finding } from '../shared/types.js';

export interface VerdictInput {
  /**
   * Union of every finding to weigh, regardless of where it came from —
   * a failed gate and an AI review finding are both just findings by the
   * time they reach this function (plan.md §4.3: "a build break is just
   * another fixable finding").
   */
  readonly findings: readonly Finding[];
  readonly attemptsSoFar: number;
  readonly maxFixAttempts: number;
  /** `fixer.fix_advisory`. When false this behaves exactly as it did before advisory fixing. */
  readonly fixAdvisory: boolean;
}

/**
 * `findings` is always and only the blocking set - it is what the fixer is given, and an advisory
 * finding handed to a fix agent would spend an attempt on something that was never in the way.
 * `advisoryFindings` rides alongside on every kind so that a caller can *report* them without being
 * able to confuse the two.
 *
 * MERGE carried them from the start. FIX and BLOCK dropped them on the floor: computed, counted in
 * the audit comment, and posted nowhere - so a pull request could say `Findings: 5` above three
 * readable ones.
 */
/** `verdict.decision.requiredChecks` builds every gate finding's rule from this. */
const GATE_RULE_PREFIX = 'gate#';

export type PipelineDecision =
  | { readonly kind: 'MERGE'; readonly advisoryFindings: readonly Finding[] }
  | { readonly kind: 'FIX'; readonly findings: readonly Finding[]; readonly advisoryFindings: readonly Finding[] }
  | {
      readonly kind: 'BLOCK';
      readonly reason: string;
      readonly findings: readonly Finding[];
      readonly advisoryFindings: readonly Finding[];
    };

/**
 * Pure decision function: MERGE, FIX, or BLOCK. `should`-severity findings
 * never factor into the decision — they ride along on MERGE as advisory
 * comments (plan.md §4.5).
 */
// @signal decidePipelineOutcome
export function decidePipelineOutcome(input: VerdictInput): PipelineDecision {
  const blocking = input.findings.filter((finding) => finding.severity === 'must' || finding.severity === 'security');
  const advisoryFindings = input.findings.filter((finding) => finding.severity === 'should');

  if (blocking.length === 0) {
    // Nothing blocks. An advisory finding still gets an agent, because the alternative - the
    // behaviour this replaced - was a thread that belonged to nobody: `runGovern` returns above
    // `recordComplaint` and `runFix` on a MERGE, so no agent of any provider ever saw one.
    //
    // Three guards, and each one falls back to MERGE rather than to BLOCK. A `should` finding
    // never blocked a pull request and must not start now: what changes is that somebody is
    // assigned to it, not whether it stands in the way.
    // A finding from a gate the repository left out of `required_checks` is advisory because
    // somebody configured it that way - "report this, do not act on it". An advisory finding
    // from the review is advisory because the reviewer judged it minor. Only the second is an
    // invitation to send an agent; dispatching on the first would quietly overrule the one
    // explicit instruction the repository gave about that gate.
    const dispatchable = advisoryFindings.filter((finding) => !finding.rule.startsWith(GATE_RULE_PREFIX));

    if (
      input.fixAdvisory &&
      dispatchable.length > 0 &&
      dispatchable.length === advisoryFindings.length &&
      // A finding no agent can fix would otherwise spend an attempt to change nothing.
      dispatchable.every((finding) => finding.autoFixable) &&
      // The same cap blocking findings get. Without it a review that raises a fresh nit on every
      // pass would dispatch on every pass, forever.
      input.attemptsSoFar < input.maxFixAttempts
    ) {
      // Reported as the findings being worked, not as advisory riding along - they are the
      // complaint now, and `advisoryFindings` staying empty is what stops them being posted twice.
      return { kind: 'FIX', findings: dispatchable, advisoryFindings: [] };
    }
    return { kind: 'MERGE', advisoryFindings };
  }

  const allAutoFixable = blocking.every((finding) => finding.autoFixable);
  if (!allAutoFixable) {
    return {
      kind: 'BLOCK',
      reason: 'one or more findings require a human (not auto-fixable)',
      findings: blocking,
      advisoryFindings,
    };
  }

  if (input.attemptsSoFar >= input.maxFixAttempts) {
    return {
      kind: 'BLOCK',
      reason: `max fix attempts (${input.maxFixAttempts}) reached`,
      findings: blocking,
      advisoryFindings,
    };
  }

  return { kind: 'FIX', findings: blocking, advisoryFindings };
}
