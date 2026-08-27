import { type PipelineConfig, type RouteResult } from '../shared/types.js';
export interface RouteInput {
    readonly commitMessages: readonly string[];
    readonly prTitle: string;
}
/**
 * Determines how a PR should be routed: which areas it touches, which rule
 * files apply, and which gate commands to run. Prefers the union of areas
 * found across the PR's commits; a commit that doesn't match the grammar is
 * treated as noise (a "wip" commit, a merge commit) and skipped, as long as
 * at least one commit does parse. Only when zero commits parse does this
 * fall back to the PR title — and only when that also fails to parse is the
 * PR unroutable.
 */
export declare function determineRoute(input: RouteInput, config: PipelineConfig): RouteResult;
