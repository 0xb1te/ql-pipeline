// @neuron shared.core.types
// @signal Types
/**
 * Areas are the second grammar element of the conventional-commit header
 * this pipeline understands: `<type>(<area>): <description>`.
 */
export type Area =
  | 'frontend'
  | 'backend'
  | 'mobile'
  | 'ios'
  | 'android'
  | 'infrastructure'
  | 'docs';

export const AREAS: readonly Area[] = [
  'frontend',
  'backend',
  'mobile',
  'ios',
  'android',
  'infrastructure',
  'docs',
];

/**
 * The first grammar element of the conventional-commit header:
 * `<type>(<area>): <description>`.
 */
export type CommitType =
  | 'feat'
  | 'fix'
  | 'refactor'
  | 'perf'
  | 'chore'
  | 'docs'
  | 'test'
  | 'ci'
  | 'build'
  | 'revert';

export const COMMIT_TYPES: readonly CommitType[] = [
  'feat',
  'fix',
  'refactor',
  'perf',
  'chore',
  'docs',
  'test',
  'ci',
  'build',
  'revert',
];

export interface ParsedCommit {
  readonly type: CommitType;
  readonly area: Area;
  readonly description: string;
  readonly raw: string;
}

export interface GateCommands {
  readonly build?: string;
  readonly test?: string;
}

export type GatesConfig = Readonly<Partial<Record<Area, GateCommands>>>;

export type MergeMethod = 'squash' | 'merge' | 'rebase';

/**
 * The pipeline stages a repo can require before a PR is allowed to merge.
 * A stage left out of `merge.required_checks` still runs, but its failures
 * are advisory rather than blocking — except `ai-review`, which is skipped
 * outright when not required (there's no point paying for a review whose
 * findings can't block).
 */
export type RequiredCheck = 'build' | 'test' | 'ai-review';

export const REQUIRED_CHECKS: readonly RequiredCheck[] = ['build', 'test', 'ai-review'];

export interface MergeConfig {
  readonly targetBranch: string;
  /**
   * Optional per-area override of `targetBranch` (plan.md §4.7), e.g.
   * `{ mobile: 'release/mobile' }`. A PR whose matched areas resolve to
   * more than one target is a conflict the pipeline refuses to resolve.
   */
  readonly targetBranchByArea: Readonly<Partial<Record<Area, string>>>;
  readonly method: MergeMethod;
  readonly deleteBranch: boolean;
  readonly requiredChecks: readonly RequiredCheck[];
  /**
   * When true, a MERGE verdict approves the PR and labels it `ready-to-merge`
   * but never calls the merge API — a person makes the final call.
   *
   * For teams that want AI review without AI merge. Also the mode ql-sprint
   * requires: it drives this pipeline unattended across a whole sprint, and
   * the human gate is what stands between a wrong review and a wrong `main`.
   */
  readonly requireHumanApproval: boolean;
}

export interface FixerConfig {
  readonly maxFixAttempts: number;
  readonly protectedPaths: readonly string[];
}

/**
 * Path globs that imply an area on top of the conventional-commit header.
 * Projects following the `apps/<name>-frontend` / `apps/<name>-backend`
 * monorepo convention get their areas detected from the code a PR actually
 * touches, so a mislabelled commit cannot dodge an area's review rules.
 */
export type AreaPathsConfig = Readonly<Partial<Record<Area, readonly string[]>>>;

export interface AreasConfig {
  readonly paths: AreaPathsConfig;
}

/**
 * External engineering standards (the ql-docs workflow docs) injected
 * into the review as authoritative context alongside `rules/*.rules`.
 */
export interface StandardsConfig {
  readonly enabled: boolean;
  /** Where the standards repository is checked out, relative to the workspace. */
  readonly root: string;
  /** Accepted in YAML for older configs; ignored. Pack paths are a convention. */
  readonly docs: Readonly<Partial<Record<Area, readonly string[]>>>;
  /** Budget guard: standards are large, and they share the prompt with the diff. */
  readonly maxCharsPerArea: number;
}

export interface PipelineConfig {
  readonly gates: GatesConfig;
  readonly merge: MergeConfig;
  readonly fixer: FixerConfig;
  readonly areas: AreasConfig;
  readonly standards: StandardsConfig;
}

export interface AreaGate {
  readonly area: Area;
  readonly build?: string;
  readonly test?: string;
}

export interface RouteDecision {
  readonly types: readonly CommitType[];
  readonly areas: readonly Area[];
  readonly ruleFiles: readonly string[];
  readonly gates: readonly AreaGate[];
}

export type RouteResult =
  | { readonly ok: true; readonly decision: RouteDecision }
  | { readonly ok: false; readonly reason: string };

export interface GateOutcome {
  readonly area: Area;
  readonly gate: 'build' | 'test';
  readonly command: string;
  readonly passed: boolean;
  readonly output: string;
}

export type Severity = 'must' | 'should' | 'security';

export interface Finding {
  readonly severity: Severity;
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly problem: string;
  readonly suggestedFix: string | null;
  readonly autoFixable: boolean;
}

export interface ReviewVerdict {
  readonly verdict: 'PASS' | 'FAIL';
  readonly findings: readonly Finding[];
}
