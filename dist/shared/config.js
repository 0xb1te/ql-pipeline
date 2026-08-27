import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { AREAS, REQUIRED_CHECKS, } from './types.js';
export class ConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConfigError';
    }
}
const MERGE_METHODS = ['squash', 'merge', 'rebase'];
const DEFAULT_MERGE_METHOD = 'merge';
const DEFAULT_DELETE_BRANCH = true;
const DEFAULT_REQUIRED_CHECKS = ['build', 'test', 'ai-review'];
const DEFAULT_MAX_FIX_ATTEMPTS = 3;
// These are paths inside the CONSUMER repo being governed, not ql-pipeline's
// own tree — a consumer never has ql-pipeline's rules/ or prompts/ folders,
// only its own .github/ overrides (plan.md §4.8). ql-pipeline's own
// pipeline.config.yml (used for dogfooding) explicitly overrides this to
// list its own rules/, prompts/, pipeline.config.yml, and .github/workflows/
// instead, since there it *is* the repo being governed.
const DEFAULT_PROTECTED_PATHS = [
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
const DEFAULT_AREA_PATHS = {
    frontend: ['apps/*frontend*/**'],
    backend: ['apps/*backend*/**'],
};
/**
 * Default mapping onto the prompt-utils workflow documentation — the
 * authoritative definition of how code in each area should be structured.
 *
 * Only `checklist.md` files are loaded. The `PROMPT.md` and `CREATE-*.md`
 * files in the same trees are code-generation instructions: they would
 * tell a reviewer how to write code rather than how to judge it.
 *
 * `frontend` loads two stages because both own part of it — stage 2 owns
 * the visible surface, stage 5 the non-visual architecture — and a PR
 * under `apps/*frontend*` can legitimately be either kind of work.
 *
 * `mobile`/`ios`/`android` map to the frontend standard because in this
 * architecture mobile apps are the frontend packaged with Capacitor
 * (see `workflow/stage-7-deployment/07-capacitor-apps/`); there is no
 * separate native codebase and no dedicated mobile checklist upstream.
 *
 * `docs` is absent deliberately: the workflow has no documentation
 * checklist, so `rules/docs.rules` covers that area on its own.
 */
const DEFAULT_STANDARDS = {
    enabled: true,
    root: '.standards',
    docs: {
        frontend: ['workflow/stage-2-mockup/checklist.md', 'workflow/stage-5-frontend/checklist.md'],
        backend: [
            'workflow/stage-4-backend/backend/checklist.md',
            'workflow/stage-4-backend/sql/checklist.md',
            'workflow/stage-4-backend/tests/checklist.md',
        ],
        mobile: ['workflow/stage-5-frontend/checklist.md'],
        ios: ['workflow/stage-5-frontend/checklist.md'],
        android: ['workflow/stage-5-frontend/checklist.md'],
        infrastructure: ['workflow/stage-7-deployment/checklist.md'],
    },
    // Sized so no area truncates: frontend is the largest at ~124k
    // characters (stage 2 + stage 5). Lower it to cut review cost, at the
    // price of dropping trailing checklist sections.
    maxCharsPerArea: 140_000,
};
export function loadConfig(path) {
    let raw;
    try {
        raw = readFileSync(path, 'utf-8');
    }
    catch (cause) {
        throw new ConfigError(`could not read pipeline config at "${path}": ${String(cause)}`);
    }
    return parseConfig(raw, path);
}
export function parseConfig(raw, sourceLabel = '<config>') {
    let data;
    try {
        data = parseYaml(raw);
    }
    catch (cause) {
        throw new ConfigError(`could not parse "${sourceLabel}" as YAML: ${String(cause)}`);
    }
    return validateConfig(data, sourceLabel);
}
function fail(sourceLabel, detail) {
    throw new ConfigError(`invalid pipeline config in "${sourceLabel}": ${detail}`);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function assertRecord(value, label, sourceLabel) {
    if (!isRecord(value)) {
        fail(sourceLabel, `"${label}" must be a mapping`);
    }
    return value;
}
function assertString(value, label, sourceLabel) {
    if (typeof value !== 'string') {
        fail(sourceLabel, `"${label}" must be a string`);
    }
    return value;
}
function assertNonEmptyString(value, label, sourceLabel) {
    const result = assertString(value, label, sourceLabel);
    if (result.length === 0) {
        fail(sourceLabel, `"${label}" must be a non-empty string`);
    }
    return result;
}
function assertBoolean(value, label, sourceLabel) {
    if (typeof value !== 'boolean') {
        fail(sourceLabel, `"${label}" must be a boolean`);
    }
    return value;
}
function assertPositiveInteger(value, label, sourceLabel) {
    if (typeof value !== 'number') {
        fail(sourceLabel, `"${label}" must be a number`);
    }
    if (!Number.isInteger(value) || value < 1) {
        fail(sourceLabel, `"${label}" must be a positive integer`);
    }
    return value;
}
function assertArrayOfStrings(value, label, sourceLabel) {
    if (!Array.isArray(value)) {
        fail(sourceLabel, `"${label}" must be an array of strings`);
    }
    const result = [];
    for (const item of value) {
        result.push(assertString(item, label, sourceLabel));
    }
    return result;
}
function validateConfig(data, sourceLabel) {
    const root = assertRecord(data, '<root>', sourceLabel);
    return {
        gates: validateGates(root['gates'], sourceLabel),
        merge: validateMerge(root['merge'], sourceLabel),
        fixer: validateFixer(root['fixer'], sourceLabel),
        areas: validateAreas(root['areas'], sourceLabel),
        standards: validateStandards(root['standards'], sourceLabel),
    };
}
function validateAreas(value, sourceLabel) {
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
function validateStandards(value, sourceLabel) {
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
        maxCharsPerArea: rawMax === undefined
            ? DEFAULT_STANDARDS.maxCharsPerArea
            : assertPositiveInteger(rawMax, 'standards.max_chars_per_area', sourceLabel),
    };
}
/** Shared shape for `{ <area>: [string, ...] }` config blocks. */
function validateAreaKeyedStringArrays(value, label, sourceLabel) {
    const record = assertRecord(value, label, sourceLabel);
    const result = {};
    for (const [key, entries] of Object.entries(record)) {
        if (!AREAS.includes(key)) {
            fail(sourceLabel, `"${label}.${key}" is not a recognized area (expected one of ${AREAS.join(', ')})`);
        }
        const values = assertArrayOfStrings(entries, `${label}.${key}`, sourceLabel);
        for (const entry of values) {
            if (entry.length === 0) {
                fail(sourceLabel, `"${label}.${key}" entries must be non-empty strings`);
            }
        }
        result[key] = values;
    }
    return result;
}
function validateGates(value, sourceLabel) {
    if (value === undefined) {
        return {};
    }
    const rawGates = assertRecord(value, 'gates', sourceLabel);
    const gates = {};
    for (const [key, rawCommands] of Object.entries(rawGates)) {
        if (!AREAS.includes(key)) {
            fail(sourceLabel, `"gates.${key}" is not a recognized area (expected one of ${AREAS.join(', ')})`);
        }
        const area = key;
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
function validateMerge(value, sourceLabel) {
    const merge = assertRecord(value, 'merge', sourceLabel);
    const targetBranch = assertNonEmptyString(merge['target_branch'], 'merge.target_branch', sourceLabel);
    const rawMethod = merge['method'];
    const method = rawMethod === undefined
        ? DEFAULT_MERGE_METHOD
        : assertNonEmptyString(rawMethod, 'merge.method', sourceLabel);
    if (!MERGE_METHODS.includes(method)) {
        fail(sourceLabel, `"merge.method" must be one of ${MERGE_METHODS.join(', ')}`);
    }
    const rawDeleteBranch = merge['delete_branch'];
    const deleteBranch = rawDeleteBranch === undefined
        ? DEFAULT_DELETE_BRANCH
        : assertBoolean(rawDeleteBranch, 'merge.delete_branch', sourceLabel);
    return {
        targetBranch,
        targetBranchByArea: validateTargetBranchByArea(merge['target_branch_by_area'], sourceLabel),
        method: method,
        deleteBranch,
        requiredChecks: validateRequiredChecks(merge['required_checks'], sourceLabel),
    };
}
function validateTargetBranchByArea(value, sourceLabel) {
    if (value === undefined) {
        return {};
    }
    const raw = assertRecord(value, 'merge.target_branch_by_area', sourceLabel);
    const byArea = {};
    for (const [key, branch] of Object.entries(raw)) {
        if (!AREAS.includes(key)) {
            fail(sourceLabel, `"merge.target_branch_by_area.${key}" is not a recognized area (expected one of ${AREAS.join(', ')})`);
        }
        byArea[key] = assertNonEmptyString(branch, `merge.target_branch_by_area.${key}`, sourceLabel);
    }
    return byArea;
}
function validateRequiredChecks(value, sourceLabel) {
    if (value === undefined) {
        return [...DEFAULT_REQUIRED_CHECKS];
    }
    const names = assertArrayOfStrings(value, 'merge.required_checks', sourceLabel);
    const checks = [];
    for (const name of names) {
        if (!REQUIRED_CHECKS.includes(name)) {
            fail(sourceLabel, `"merge.required_checks" entries must be one of ${REQUIRED_CHECKS.join(', ')} (got "${name}")`);
        }
        checks.push(name);
    }
    return checks;
}
function validateFixer(value, sourceLabel) {
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
//# sourceMappingURL=config.js.map