// @neuron merge.merger.targetBranch
import type { Area, MergeConfig } from '../shared/types.js';

export type TargetBranchResolution =
  | { readonly ok: true; readonly targetBranch: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Resolves which branch this PR is configured to merge into, honouring the
 * optional per-area overrides (plan.md §4.7). A PR whose matched areas
 * disagree — e.g. a commit touching both `mobile` (→ release/mobile) and
 * `backend` (→ main) — is a conflict the pipeline refuses to guess at:
 * merging into either branch would silently drop half the change from the
 * other, so it fails closed and asks for a human.
 */
// @signal resolveTargetBranch
export function resolveTargetBranch(areas: readonly Area[], merge: MergeConfig): TargetBranchResolution {
  const targets = new Map<string, Area[]>();

  for (const area of areas) {
    const branch = merge.targetBranchByArea[area] ?? merge.targetBranch;
    const existing = targets.get(branch);
    if (existing === undefined) {
      targets.set(branch, [area]);
    } else {
      existing.push(area);
    }
  }

  if (targets.size === 0) {
    return { ok: true, targetBranch: merge.targetBranch };
  }

  if (targets.size > 1) {
    const detail = [...targets.entries()].map(([branch, forAreas]) => `${forAreas.join('+')} → ${branch}`).join(', ');
    return {
      ok: false,
      reason: `this PR's areas resolve to more than one configured target branch (${detail}); split it into one PR per target branch`,
    };
  }

  return { ok: true, targetBranch: [...targets.keys()][0]! };
}

/**
 * Whether this pipeline run governs a PR at all. The pipeline merges into
 * the branch its config designates; a PR aimed somewhere else is simply
 * outside its authority, and is left untouched rather than blocked (a
 * failing check on an unrelated PR would be noise, not safety).
 */
// @signal governsPullRequest
export function governsPullRequest(prBaseRef: string, targetBranch: string): boolean {
  return prBaseRef === targetBranch;
}

/**
 * A cheap pre-check answering "could this PR possibly be governed?" without
 * knowing its areas yet. Resolving the exact target branch needs the PR's
 * commits (to know its areas), but if the base branch isn't the default
 * target *or* any per-area override, no area combination could ever select
 * it — so an unrelated PR can be dropped before spending a single API call
 * or a token of AI review on it.
 */
// @signal couldGovernPullRequest
export function couldGovernPullRequest(prBaseRef: string, merge: MergeConfig): boolean {
  return prBaseRef === merge.targetBranch || Object.values(merge.targetBranchByArea).includes(prBaseRef);
}
