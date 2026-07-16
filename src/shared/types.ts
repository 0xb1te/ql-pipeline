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

export interface MergeConfig {
  readonly targetBranch: string;
  readonly method: MergeMethod;
  readonly deleteBranch: boolean;
  readonly requiredChecks: readonly string[];
}

export interface FixerConfig {
  readonly maxFixAttempts: number;
  readonly protectedPaths: readonly string[];
}

export interface PipelineConfig {
  readonly gates: GatesConfig;
  readonly merge: MergeConfig;
  readonly fixer: FixerConfig;
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
