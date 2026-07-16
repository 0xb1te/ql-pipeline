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
