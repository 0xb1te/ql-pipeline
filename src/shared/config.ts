// @neuron shared.core.config
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import {
  AGENT_PROVIDERS,
  AREAS,
  REQUIRED_CHECKS,
  type Area,
  type AreaPathsConfig,
  type AgentConfig,
  type AgentPhase,
  type AgentPhaseConfig,
  type AreasConfig,
  type FixerConfig,
  type GateCommands,
  type GatesConfig,
  type MergeConfig,
  type MergeMethod,
  type PipelineConfig,
  type PreviewConfig,
  type RequiredCheck,
  type StandardsConfig,
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
const DEFAULT_REQUIRED_CHECKS: readonly RequiredCheck[] = ['build', 'test', 'ai-review'];
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

/**
 * The house monorepo convention: product code lives in `apps/<name>-frontend`
 * and `apps/<name>-backend`. Detecting areas from the paths a PR touches
 * means a commit labelled `feat(frontend)` that also edits backend code
 * still gets the backend rules applied to it.
 */
const DEFAULT_AREA_PATHS: AreaPathsConfig = {
  frontend: ['apps/*frontend*/**'],
  backend: ['apps/*backend*/**'],
};

/**
 * Review criteria live in ql-docs `workflow/review/pr-*`. Pipeline never
 * maps extra document paths: `resolveStandards` uses the pack convention.
 * `docs` is accepted in YAML for older consumer configs and ignored.
 */
const DEFAULT_STANDARDS: StandardsConfig = {
  enabled: true,
  root: '.standards',
  docs: {},
  maxCharsPerArea: 140_000,
};

// @signal loadConfig
export function loadConfig(path: string): PipelineConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (cause) {
    throw new ConfigError(`could not read pipeline config at "${path}": ${String(cause)}`);
  }
  return parseConfig(raw, path);
}

// @signal parseConfig
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
    agent: validateAgent(root['agent'], sourceLabel),
    areas: validateAreas(root['areas'], sourceLabel),
    standards: validateStandards(root['standards'], sourceLabel),
    preview: validatePreview(root['preview'], sourceLabel),
  };
}

/**
 * On, with the house convention for where the MCP server lives. A repository whose backend
 * service or port differs says so here; one with no preview host registered turns it off. Two
 * hours is long enough to review a pull request and short enough that a forgotten preview is
 * not a machine held for a day - and the host's own ceiling still applies on top.
 */
const DEFAULT_PREVIEW: PreviewConfig = {
  enabled: true,
  ttlMinutes: 120,
  protect: true,
  mcp: { service: 'backend', port: 8080, path: '/mcp', readyTimeoutSeconds: 180 },
};

function validatePreview(value: unknown, sourceLabel: string): PreviewConfig {
  if (value === undefined) {
    return DEFAULT_PREVIEW;
  }
  const preview = assertRecord(value, 'preview', sourceLabel);

  const rawEnabled = preview['enabled'];
  const rawTtl = preview['ttl_minutes'];
  const rawProtect = preview['protect'];
  const rawMcp = preview['mcp'];

  let mcp = DEFAULT_PREVIEW.mcp;
  if (rawMcp !== undefined) {
    const record = assertRecord(rawMcp, 'preview.mcp', sourceLabel);
    const rawService = record['service'];
    const rawPort = record['port'];
    const rawPath = record['path'];
    const rawReady = record['ready_timeout_seconds'];
    const path = rawPath === undefined ? mcp.path : assertNonEmptyString(rawPath, 'preview.mcp.path', sourceLabel);
    if (!path.startsWith('/')) {
      fail(sourceLabel, '"preview.mcp.path" must start with "/"');
    }
    mcp = {
      service: rawService === undefined ? mcp.service : assertNonEmptyString(rawService, 'preview.mcp.service', sourceLabel),
      port: rawPort === undefined ? mcp.port : assertPositiveInteger(rawPort, 'preview.mcp.port', sourceLabel),
      path,
      readyTimeoutSeconds:
        rawReady === undefined
          ? mcp.readyTimeoutSeconds
          : assertPositiveInteger(rawReady, 'preview.mcp.ready_timeout_seconds', sourceLabel),
    };
  }

  return {
    enabled: rawEnabled === undefined ? DEFAULT_PREVIEW.enabled : assertBoolean(rawEnabled, 'preview.enabled', sourceLabel),
    ttlMinutes: rawTtl === undefined ? DEFAULT_PREVIEW.ttlMinutes : assertPositiveInteger(rawTtl, 'preview.ttl_minutes', sourceLabel),
    protect: rawProtect === undefined ? DEFAULT_PREVIEW.protect : assertBoolean(rawProtect, 'preview.protect', sourceLabel),
    mcp,
  };
}

function validateAreas(value: unknown, sourceLabel: string): AreasConfig {
  if (value === undefined) {
    return { paths: DEFAULT_AREA_PATHS };
  }
  const areas = assertRecord(value, 'areas', sourceLabel);

  const rawPaths = areas['paths'];
  if (rawPaths === undefined) {
    return { paths: DEFAULT_AREA_PATHS };
  }

  return { paths: validateAreaKeyedStringArrays(rawPaths, 'areas.paths', sourceLabel) };
}

function validateStandards(value: unknown, sourceLabel: string): StandardsConfig {
  if (value === undefined) {
    return DEFAULT_STANDARDS;
  }
  const standards = assertRecord(value, 'standards', sourceLabel);

  const rawEnabled = standards['enabled'];
  const rawRoot = standards['root'];
  const rawDocs = standards['docs'];
  const rawMax = standards['max_chars_per_area'];

  return {
    enabled: rawEnabled === undefined ? DEFAULT_STANDARDS.enabled : assertBoolean(rawEnabled, 'standards.enabled', sourceLabel),
    root: rawRoot === undefined ? DEFAULT_STANDARDS.root : assertNonEmptyString(rawRoot, 'standards.root', sourceLabel),
    docs: rawDocs === undefined ? DEFAULT_STANDARDS.docs : validateAreaKeyedStringArrays(rawDocs, 'standards.docs', sourceLabel),
    maxCharsPerArea:
      rawMax === undefined
        ? DEFAULT_STANDARDS.maxCharsPerArea
        : assertPositiveInteger(rawMax, 'standards.max_chars_per_area', sourceLabel),
  };
}

/** Shared shape for `{ <area>: [string, ...] }` config blocks. */
function validateAreaKeyedStringArrays(
  value: unknown,
  label: string,
  sourceLabel: string,
): Partial<Record<Area, readonly string[]>> {
  const record = assertRecord(value, label, sourceLabel);

  const result: Partial<Record<Area, readonly string[]>> = {};
  for (const [key, entries] of Object.entries(record)) {
    if (!AREAS.includes(key as Area)) {
      fail(sourceLabel, `"${label}.${key}" is not a recognized area (expected one of ${AREAS.join(', ')})`);
    }
    const values = assertArrayOfStrings(entries, `${label}.${key}`, sourceLabel);
    for (const entry of values) {
      if (entry.length === 0) {
        fail(sourceLabel, `"${label}.${key}" entries must be non-empty strings`);
      }
    }
    result[key as Area] = values;
  }
  return result;
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

  const rawRequireHumanApproval = merge['require_human_approval'];
  const requireHumanApproval = rawRequireHumanApproval === undefined
    ? false
    : assertBoolean(rawRequireHumanApproval, 'merge.require_human_approval', sourceLabel);

  return {
    targetBranch,
    targetBranchByArea: validateTargetBranchByArea(merge['target_branch_by_area'], sourceLabel),
    method: method as MergeMethod,
    deleteBranch,
    requiredChecks: validateRequiredChecks(merge['required_checks'], sourceLabel),
    requireHumanApproval,
  };
}

function validateTargetBranchByArea(value: unknown, sourceLabel: string): Partial<Record<Area, string>> {
  if (value === undefined) {
    return {};
  }
  const raw = assertRecord(value, 'merge.target_branch_by_area', sourceLabel);

  const byArea: Partial<Record<Area, string>> = {};
  for (const [key, branch] of Object.entries(raw)) {
    if (!AREAS.includes(key as Area)) {
      fail(
        sourceLabel,
        `"merge.target_branch_by_area.${key}" is not a recognized area (expected one of ${AREAS.join(', ')})`,
      );
    }
    byArea[key as Area] = assertNonEmptyString(branch, `merge.target_branch_by_area.${key}`, sourceLabel);
  }
  return byArea;
}

function validateRequiredChecks(value: unknown, sourceLabel: string): RequiredCheck[] {
  if (value === undefined) {
    return [...DEFAULT_REQUIRED_CHECKS];
  }
  const names = assertArrayOfStrings(value, 'merge.required_checks', sourceLabel);

  const checks: RequiredCheck[] = [];
  for (const name of names) {
    if (!REQUIRED_CHECKS.includes(name as RequiredCheck)) {
      fail(sourceLabel, `"merge.required_checks" entries must be one of ${REQUIRED_CHECKS.join(', ')} (got "${name}")`);
    }
    checks.push(name as RequiredCheck);
  }
  return checks;
}

/**
 * On, because the alternative is what this changed. An advisory finding was reported into a
 * thread and then belonged to nobody - the verdict returned above the fix path, so no agent of
 * any provider ever saw one, however many were raised.
 */
const DEFAULT_FIX_ADVISORY = true;

function validateFixer(value: unknown, sourceLabel: string): FixerConfig {
  if (value === undefined) {
    return {
      maxFixAttempts: DEFAULT_MAX_FIX_ATTEMPTS,
      protectedPaths: DEFAULT_PROTECTED_PATHS,
      fixAdvisory: DEFAULT_FIX_ADVISORY,
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

  const rawFixAdvisory = fixer['fix_advisory'];
  if (rawFixAdvisory !== undefined && typeof rawFixAdvisory !== 'boolean') {
    throw new ConfigError(`fixer.fix_advisory must be a boolean in ${sourceLabel}`);
  }
  const fixAdvisory = rawFixAdvisory ?? DEFAULT_FIX_ADVISORY;

  return { maxFixAttempts, protectedPaths, fixAdvisory };
}

const DEFAULT_AGENT: AgentConfig = {
  provider: 'cursor',
  model: null,
  baseUrl: null,
  review: { model: null },
  fix: { model: null },
};

function validateAgent(value: unknown, sourceLabel: string): AgentConfig {
  if (value === undefined) {
    return DEFAULT_AGENT;
  }
  const agent = assertRecord(value, 'agent', sourceLabel);

  const rawProvider = agent['provider'];
  const provider = rawProvider === undefined
    ? 'cursor'
    : assertNonEmptyString(rawProvider, 'agent.provider', sourceLabel);
  if (!AGENT_PROVIDERS.includes(provider as AgentConfig['provider'])) {
    fail(sourceLabel, `"agent.provider" must be one of ${AGENT_PROVIDERS.join(', ')}`);
  }

  const rawModel = agent['model'];
  const model = rawModel === undefined || rawModel === null
    ? null
    : assertNonEmptyString(rawModel, 'agent.model', sourceLabel);

  const rawBaseUrl = agent['base_url'];
  const baseUrl = rawBaseUrl === undefined || rawBaseUrl === null
    ? null
    : assertHttpUrl(rawBaseUrl, 'agent.base_url', sourceLabel);

  // Resolved here, once, rather than at each call site: `govern` reads
  // `agent.review.model` and `agent.fix.model` directly and can no longer
  // forget to fall back to `agent.model`.
  const review = validateAgentPhase(agent['review'], 'review', model, sourceLabel);
  const fix = validateAgentPhase(agent['fix'], 'fix', model, sourceLabel);

  if (provider === 'openai_compatible') {
    // The review model is the one this provider actually spends, so the
    // requirement is on the resolved value: `agent.review.model` satisfies
    // it just as well as `agent.model` does.
    if (review.model === null) {
      fail(sourceLabel, '"agent.model" or "agent.review.model" is required when agent.provider is openai_compatible');
    }
    if (baseUrl === null) {
      fail(sourceLabel, '"agent.base_url" is required when agent.provider is openai_compatible');
    }
    // `agent.fix.model` is deliberately NOT rejected here. The fixer is
    // skipped on this provider (a FIX escalates to a human), so the key is
    // inert rather than wrong — and keeping it lets a repo switch providers
    // back and forth without rewriting its config each time.
  }

  if (provider === 'cursor' && baseUrl !== null) {
    fail(sourceLabel, '"agent.base_url" is only valid when agent.provider is openai_compatible');
  }

  return { provider: provider as AgentConfig['provider'], model, baseUrl, review, fix };
}

function validateAgentPhase(
  value: unknown,
  phase: AgentPhase,
  fallbackModel: string | null,
  sourceLabel: string,
): AgentPhaseConfig {
  if (value === undefined) {
    return { model: fallbackModel };
  }
  const record = assertRecord(value, `agent.${phase}`, sourceLabel);

  const rawModel = record['model'];
  if (rawModel === undefined || rawModel === null) {
    return { model: fallbackModel };
  }
  return { model: assertNonEmptyString(rawModel, `agent.${phase}.model`, sourceLabel) };
}

function assertHttpUrl(value: unknown, label: string, sourceLabel: string): string {
  const raw = assertNonEmptyString(value, label, sourceLabel);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail(sourceLabel, `"${label}" must be an absolute http(s) URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail(sourceLabel, `"${label}" must be an http or https URL`);
  }
  return raw.replace(/\/+$/, '');
}
