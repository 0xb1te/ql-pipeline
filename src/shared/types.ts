// @neuron shared.core.types
// @signal Types
/**
 * Areas are the second grammar element of the conventional-commit header
 * this pipeline understands: `<type>(<area>): <description>`.
 *
 * An area selects which review checklist the PR is judged against, so it is a
 * claim about what kind of work this is — not about which folder the file sits
 * in. `tooling` exists because build and type-check configuration had nowhere
 * honest to go: naming a product area for it does not merely mislabel the
 * commit, it gets three lines of module resolution judged against the frontend
 * checklist.
 *
 * `infrastructure` is how the product runs somewhere; `tooling` is how the
 * repository is checked here. A deploy workflow is the first; a `tsconfig` that
 * decides which files get compiled is the second.
 *
 * Adding an area is not free: `allReviewDocumentPaths` requires a pack at
 * `workflow/review/<kind>/<area>.md` in ql-docs for every review kind, and
 * `doctor` reports each missing one against every consumer. The packs land
 * upstream before the area does.
 */
export type Area =
  | 'frontend'
  | 'backend'
  | 'mobile'
  | 'ios'
  | 'android'
  | 'infrastructure'
  | 'tooling'
  | 'docs';

export const AREAS: readonly Area[] = [
  'frontend',
  'backend',
  'mobile',
  'ios',
  'android',
  'infrastructure',
  'tooling',
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
 * The stages that actually run a command in their own job and report an outcome.
 * Named positively rather than derived from RequiredCheck by exclusion, so adding
 * a non-gate check below cannot silently widen what a GateReport may claim to be.
 */
export type GateStage = 'build' | 'test';

/**
 * The pipeline stages a repo can require before a PR is allowed to merge.
 * A stage left out of `merge.required_checks` still runs, but its failures
 * are advisory rather than blocking — except `ai-review`, which is skipped
 * outright when not required (there's no point paying for a review whose
 * findings can't block).
 *
 * `task-artifacts` is not a job: it is a structural check on the task folder the
 * branch names, and it is deliberately absent from the defaults. Listing it is how
 * a repository says its task folders already carry a test plan and seed data; until
 * then the check still runs and still reports, advisorily.
 */
export type RequiredCheck = GateStage | 'ai-review' | 'task-artifacts';

export const REQUIRED_CHECKS: readonly RequiredCheck[] = ['build', 'test', 'ai-review', 'task-artifacts'];

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
 * `ql_agents` does not name a model vendor, which is the point of it. It routes the fix to the
 * suite's own agent runner, where which coding agent actually runs is a descriptor on that side
 * rather than a code path here - so changing vendor stops being a change to this repository.
 */
export const AGENT_PROVIDERS = ['cursor', 'openai_compatible', 'ql_agents'] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

/** The two phases that spend a model: the AI review, and the auto-fix agent. */
export const AGENT_PHASES = ['review', 'fix'] as const;
export type AgentPhase = (typeof AGENT_PHASES)[number];

/**
 * Model selection for one phase. Resolved at parse time, so a reader never
 * has to re-apply the `agent.model` fallback itself and risk the two call
 * sites disagreeing about which model actually ran.
 */
export interface AgentPhaseConfig {
  /** Null means "no --model flag": the provider's own default for this key. */
  readonly model: string | null;
}

/**
 * Which model reviews (and, for `cursor`, auto-fixes) PRs.
 * `openai_compatible` is review-only — the fixer still requires cursor-agent.
 *
 * Review and fix are different jobs: review reads a large diff plus the
 * house checklists and must reason about them, while a fix applies a
 * complaint that has already been reasoned out. Pinning them separately
 * lets a repo spend a strong model where judgement happens and a cheaper
 * one where it does not.
 */
export interface AgentConfig {
  readonly provider: AgentProvider;
  /** Fallback for every phase that names no model of its own. */
  readonly model: string | null;
  /** Origin + version prefix, e.g. `https://api.openai.com/v1`. Null on `cursor`. */
  readonly baseUrl: string | null;
  readonly review: AgentPhaseConfig;
  readonly fix: AgentPhaseConfig;
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
  readonly agent: AgentConfig;
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
  readonly gate: GateStage;
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

/**
 * Stamped into every comment this pipeline writes, so a later run can recognise its own voice.
 *
 * Identity cannot do this job. The workflow acts as `secrets.GH_TOKEN` when one is set, and that
 * token belongs to a person — the same person who comments on the pull request. Once `GH_TOKEN`
 * is configured, the pipeline's comments and the operator's are written by the *same GitHub
 * account*, so "was this written by a bot?" has no answer, and "was this written by me?" would
 * decline the operator's own direction along with the pipeline's chatter.
 *
 * What the two do not share is what they say. An HTML comment renders as nothing, survives
 * GitHub's Markdown untouched, and is carried in the webhook payload the trigger reads — so the
 * guard can ask the one question that still separates them.
 *
 * Without this, a `GH_TOKEN` that finally closes the fix loop also makes every verdict comment
 * start another run that writes another verdict comment, forever.
 *
 * It lives here, rather than beside `stampAutomated` where it was introduced, because two
 * guards need it and one of them must stay pure. `shared/github-client.ts` already imports
 * `PrComment` from `shared/human-direction.ts`; that import is type-only and erases, so the
 * client has no runtime dependency on the formatter. Had the formatter imported this constant
 * back out of the client, that erasure would have reversed into a real one — a pure string
 * function pulling in `@actions/github` and the whole Octokit surface to read one string.
 */
export const AUTOMATION_MARKER = '<!-- ql-pipeline:automated -->';
