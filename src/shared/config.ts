import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import {
  AREAS,
  type Area,
  type FixerConfig,
  type GateCommands,
  type GatesConfig,
  type MergeConfig,
  type MergeMethod,
  type PipelineConfig,
} from './types.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const MERGE_METHODS: readonly MergeMethod[] = ['squash', 'merge', 'rebase'];

const DEFAULT_MERGE_METHOD: MergeMethod = 'merge';
const DEFAULT_DELETE_BRANCH = true;
const DEFAULT_REQUIRED_CHECKS: readonly string[] = ['build', 'test', 'ai-review'];
const DEFAULT_MAX_FIX_ATTEMPTS = 3;
// These are paths inside the CONSUMER repo being governed, not ql-pipeline's
// own tree — a consumer never has ql-pipeline's rules/ or prompts/ folders,
// only its own .github/ overrides (plan.md §4.8). ql-pipeline's own
// pipeline.config.yml (used for dogfooding) explicitly overrides this to
// list its own rules/, prompts/, pipeline.config.yml, and .github/workflows/
// instead, since there it *is* the repo being governed.
const DEFAULT_PROTECTED_PATHS: readonly string[] = [
  '.github/workflows/',
  '.github/pipeline.config.yml',
  '.github/pipeline-rules/',
];

export function loadConfig(path: string): PipelineConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (cause) {
    throw new ConfigError(`could not read pipeline config at "${path}": ${String(cause)}`);
  }
  return parseConfig(raw, path);
}

export function parseConfig(raw: string, sourceLabel = '<config>'): PipelineConfig {
  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (cause) {
    throw new ConfigError(`could not parse "${sourceLabel}" as YAML: ${String(cause)}`);
  }
  return validateConfig(data, sourceLabel);
}

function fail(sourceLabel: string, detail: string): never {
  throw new ConfigError(`invalid pipeline config in "${sourceLabel}": ${detail}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string, sourceLabel: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(sourceLabel, `"${label}" must be a mapping`);
  }
  return value;
}

function assertString(value: unknown, label: string, sourceLabel: string): string {
  if (typeof value !== 'string') {
    fail(sourceLabel, `"${label}" must be a string`);
  }
  return value;
}

function assertNonEmptyString(value: unknown, label: string, sourceLabel: string): string {
  const result = assertString(value, label, sourceLabel);
  if (result.length === 0) {
    fail(sourceLabel, `"${label}" must be a non-empty string`);
  }
  return result;
}

function assertBoolean(value: unknown, label: string, sourceLabel: string): boolean {
  if (typeof value !== 'boolean') {
    fail(sourceLabel, `"${label}" must be a boolean`);
  }
  return value;
}

function assertPositiveInteger(value: unknown, label: string, sourceLabel: string): number {
  if (typeof value !== 'number') {
    fail(sourceLabel, `"${label}" must be a number`);
  }
  if (!Number.isInteger(value) || value < 1) {
    fail(sourceLabel, `"${label}" must be a positive integer`);
  }
  return value;
}

function assertArrayOfStrings(value: unknown, label: string, sourceLabel: string): string[] {
  if (!Array.isArray(value)) {
    fail(sourceLabel, `"${label}" must be an array of strings`);
  }
  const result: string[] = [];
  for (const item of value) {
    result.push(assertString(item, label, sourceLabel));
  }
  return result;
}

function validateConfig(data: unknown, sourceLabel: string): PipelineConfig {
  const root = assertRecord(data, '<root>', sourceLabel);

  return {
    gates: validateGates(root['gates'], sourceLabel),
    merge: validateMerge(root['merge'], sourceLabel),
    fixer: validateFixer(root['fixer'], sourceLabel),
  };
}

function validateGates(value: unknown, sourceLabel: string): GatesConfig {
  if (value === undefined) {
    return {};
  }
  const rawGates = assertRecord(value, 'gates', sourceLabel);

  const gates: Partial<Record<Area, GateCommands>> = {};
  for (const [key, rawCommands] of Object.entries(rawGates)) {
    if (!AREAS.includes(key as Area)) {
      fail(sourceLabel, `"gates.${key}" is not a recognized area (expected one of ${AREAS.join(', ')})`);
    }
    const area = key as Area;
    const commandsRecord = assertRecord(rawCommands, `gates.${key}`, sourceLabel);

    const build = commandsRecord['build'];
    const test = commandsRecord['test'];
    if (build !== undefined) {
      assertNonEmptyString(build, `gates.${key}.build`, sourceLabel);
    }
    if (test !== undefined) {
      assertNonEmptyString(test, `gates.${key}.test`, sourceLabel);
    }

    gates[area] = {
      ...(typeof build === 'string' ? { build } : {}),
      ...(typeof test === 'string' ? { test } : {}),
    };
  }
  return gates;
}

function validateMerge(value: unknown, sourceLabel: string): MergeConfig {
  const merge = assertRecord(value, 'merge', sourceLabel);

  const targetBranch = assertNonEmptyString(merge['target_branch'], 'merge.target_branch', sourceLabel);

  const rawMethod = merge['method'];
  const method = rawMethod === undefined
    ? DEFAULT_MERGE_METHOD
    : assertNonEmptyString(rawMethod, 'merge.method', sourceLabel);
  if (!MERGE_METHODS.includes(method as MergeMethod)) {
    fail(sourceLabel, `"merge.method" must be one of ${MERGE_METHODS.join(', ')}`);
  }

  const rawDeleteBranch = merge['delete_branch'];
  const deleteBranch = rawDeleteBranch === undefined
    ? DEFAULT_DELETE_BRANCH
    : assertBoolean(rawDeleteBranch, 'merge.delete_branch', sourceLabel);

  const rawRequiredChecks = merge['required_checks'];
  const requiredChecks = rawRequiredChecks === undefined
    ? DEFAULT_REQUIRED_CHECKS
    : assertArrayOfStrings(rawRequiredChecks, 'merge.required_checks', sourceLabel);

  return {
    targetBranch,
    method: method as MergeMethod,
    deleteBranch,
    requiredChecks,
  };
}

function validateFixer(value: unknown, sourceLabel: string): FixerConfig {
  if (value === undefined) {
    return {
      maxFixAttempts: DEFAULT_MAX_FIX_ATTEMPTS,
      protectedPaths: DEFAULT_PROTECTED_PATHS,
    };
  }
  const fixer = assertRecord(value, 'fixer', sourceLabel);

  const rawMaxAttempts = fixer['max_fix_attempts'];
  const maxFixAttempts = rawMaxAttempts === undefined
    ? DEFAULT_MAX_FIX_ATTEMPTS
    : assertPositiveInteger(rawMaxAttempts, 'fixer.max_fix_attempts', sourceLabel);

  const rawProtectedPaths = fixer['protected_paths'];
  const protectedPaths = rawProtectedPaths === undefined
    ? DEFAULT_PROTECTED_PATHS
    : assertArrayOfStrings(rawProtectedPaths, 'fixer.protected_paths', sourceLabel);

  return { maxFixAttempts, protectedPaths };
}
