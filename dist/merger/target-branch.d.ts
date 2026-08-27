import type { Area, MergeConfig } from '../shared/types.js';
export type TargetBranchResolution = {
    readonly ok: true;
    readonly targetBranch: string;
} | {
    readonly ok: false;
    readonly reason: string;
};
/**
 * Resolves which branch this PR is configured to merge into, honouring the
 * optional per-area overrides (plan.md §4.7). A PR whose matched areas
 * disagree — e.g. a commit touching both `mobile` (→ release/mobile) and
 * `backend` (→ main) — is a conflict the pipeline refuses to guess at:
 * merging into either branch would silently drop half the change from the
 * other, so it fails closed and asks for a human.
 */
export declare function resolveTargetBranch(areas: readonly Area[], merge: MergeConfig): TargetBranchResolution;
/**
 * Whether this pipeline run governs a PR at all. The pipeline merges into
 * the branch its config designates; a PR aimed somewhere else is simply
 * outside its authority, and is left untouched rather than blocked (a
 * failing check on an unrelated PR would be noise, not safety).
 */
export declare function governsPullRequest(prBaseRef: string, targetBranch: string): boolean;
/**
 * A cheap pre-check answering "could this PR possibly be governed?" without
 * knowing its areas yet. Resolving the exact target branch needs the PR's
 * commits (to know its areas), but if the base branch isn't the default
 * target *or* any per-area override, no area combination could ever select
 * it — so an unrelated PR can be dropped before spending a single API call
 * or a token of AI review on it.
 */
export declare function couldGovernPullRequest(prBaseRef: string, merge: MergeConfig): boolean;
