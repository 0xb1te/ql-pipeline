// @neuron verdict.decision.previewEnvironment
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { matchesGlob } from '../router/area-paths.js';
/**
 * Where an application repository keeps the compose stack a pull request preview boots from.
 *
 * Fixed, not configured. ql-docs' preview environment contract names this one folder so that
 * ql-proxy can bring it up and this pipeline can check it without either side asking the other
 * where to look. A configurable path would be a second source of truth for something the contract
 * already states, and the two would disagree exactly when somebody was in a hurry.
 */
export const PREVIEW_ENVIRONMENT_DIR = 'infrastructure/docker/environments/devops';
export const PREVIEW_COMPOSE_FILE = `${PREVIEW_ENVIRONMENT_DIR}/docker-compose.yml`;
export const PREVIEW_ENV_EXAMPLE = `${PREVIEW_ENVIRONMENT_DIR}/env.example`;
/** The one HTTP entry service the contract allows, and the name it must carry. */
export const PREVIEW_EDGE_SERVICE = 'edge';
/**
 * Where the rules live. Cited by every message here and restated by none of them: this pipeline
 * enforces the contract, ql-proxy builds against it, and the node is the only place it is written.
 * The node absorbs `14-preview-database-seeding`, which is why it is named by its stage folder and
 * title rather than by a number that ql-docs settles.
 */
export const PREVIEW_CONTRACT_NODE = 'ql-docs `workflow/rules/stage-8-deployment/` — *Preview environment contract* ' +
    '(the node that absorbs `14-preview-database-seeding`)';
/**
 * Whether the contract applies to this repository at all.
 *
 * Keyed off the same area-path globs the router uses to detect frontend and backend work, rather
 * than a second list of directory names, so a repository that has told the pipeline where its
 * apps live is measured against that and not against a convention it may not follow. A
 * repository with no matching directory - this one, a docs repository, a library - is unaffected.
 */
// @signal requiresPreviewEnvironment
export function requiresPreviewEnvironment(appDirs, areaPaths) {
    const globs = [...(areaPaths.frontend ?? []), ...(areaPaths.backend ?? [])];
    return appDirs.some((dir) => {
        const normalized = dir.replace(/\\/g, '/').replace(/\/+$/, '');
        return globs.some((glob) => matchesGlob(normalized, glob));
    });
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * Every way the devops folder fails the contract, as sentences an author can act on.
 *
 * Cheap and structural by design: the compose file is parsed, never run. Whether the stack
 * actually boots is the deploy job's question, and answering it here would mean Docker in a
 * governance job. What can be read off the file is read: exactly one entry service named `edge`,
 * no published host ports anywhere, and an `env.example` the stack can boot from unedited.
 *
 * A missing compose file is reported alone. When the folder is absent everything in it is absent
 * too, and three sentences about one missing directory read as three problems.
 */
// @signal previewEnvironmentViolations
export function previewEnvironmentViolations(snapshot) {
    if (snapshot.composeText === null) {
        return [
            `\`${PREVIEW_COMPOSE_FILE}\` is missing. Every repository with an \`apps/*frontend*\` or ` +
                '`apps/*backend*` directory must carry a bootable preview stack there.',
        ];
    }
    const violations = [];
    let parsed;
    try {
        parsed = parseYaml(snapshot.composeText);
    }
    catch (cause) {
        parsed = undefined;
        violations.push(`\`${PREVIEW_COMPOSE_FILE}\` is not valid YAML: ${String(cause)}`);
    }
    if (violations.length === 0) {
        if (!isRecord(parsed)) {
            violations.push(`\`${PREVIEW_COMPOSE_FILE}\` is not a compose document (expected a mapping at the top level).`);
        }
        else {
            const services = parsed['services'];
            if (!isRecord(services) || Object.keys(services).length === 0) {
                violations.push(`\`${PREVIEW_COMPOSE_FILE}\` declares no \`services\`.`);
            }
            else {
                if (!isRecord(services[PREVIEW_EDGE_SERVICE])) {
                    violations.push(`\`${PREVIEW_COMPOSE_FILE}\` has no service named \`${PREVIEW_EDGE_SERVICE}\`. The contract routes ` +
                        'exactly one HTTP entry service per preview, and that is its name.');
                }
                const publishing = Object.entries(services)
                    .filter(([, service]) => isRecord(service) && service['ports'] !== undefined)
                    .map(([name]) => `\`${name}\``);
                if (publishing.length > 0) {
                    violations.push(`\`${PREVIEW_COMPOSE_FILE}\` publishes host ports on ${publishing.join(', ')}. A preview is reached ` +
                        'over the shared preview network by the router; a published port collides the moment two previews ' +
                        'run at once.');
                }
            }
        }
    }
    if (!snapshot.envExamplePresent) {
        violations.push(`\`${PREVIEW_ENV_EXAMPLE}\` is missing. It must list every variable the stack needs, with no real ` +
            'secret in it, and the stack must boot from it unedited - a preview that needs a hand-filled `.env` is ' +
            'a preview no CI job can bring up.');
    }
    return violations;
}
// @signal assessPreviewEnvironment
export function assessPreviewEnvironment(snapshot, areaPaths) {
    if (!requiresPreviewEnvironment(snapshot.appDirs, areaPaths)) {
        return { kind: 'not-required' };
    }
    const violations = previewEnvironmentViolations(snapshot);
    return violations.length === 0 ? { kind: 'valid' } : { kind: 'invalid', violations };
}
/**
 * The finding a repository earns for failing the contract, or null when it does not apply or is
 * satisfied.
 *
 * `must`, always, and with no opt-in: unlike a task folder's artifacts this is not a standard
 * arriving on every repository at once. It applies only where `apps/*frontend*` or
 * `apps/*backend*` exists, which is the set of repositories that have a product to preview, and
 * a product repository with no preview stack cannot be tested by anything downstream of this
 * check - the deploy job has nothing to bring up and the tester nothing to reach.
 *
 * autoFixable is false. A fix agent cannot invent a deployment topology, and an attempt spent
 * discovering that is an attempt the real findings needed.
 */
// @signal previewEnvironmentFinding
export function previewEnvironmentFinding(verdict) {
    if (verdict.kind !== 'invalid')
        return null;
    return {
        severity: 'must',
        rule: 'preview#environment',
        file: PREVIEW_COMPOSE_FILE,
        line: 1,
        problem: [
            `This repository has an \`apps/*frontend*\` or \`apps/*backend*\` directory but no valid preview ` +
                `environment under \`${PREVIEW_ENVIRONMENT_DIR}/\`, so no pull request preview can be brought up for it:`,
            '',
            ...verdict.violations.map((violation) => `- ${violation}`),
            '',
            `The rules are written once, in ${PREVIEW_CONTRACT_NODE}. This check enforces them and does not restate them.`,
        ].join('\n'),
        suggestedFix: null,
        autoFixable: false,
    };
}
const DISK = {
    exists: existsSync,
    listDirs: (path) => readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    read: (path) => readFileSync(path, 'utf-8'),
};
/**
 * Reads what the checks need off a checkout, and nothing more: the names under `apps/`, the
 * devops compose text, and whether `env.example` is beside it.
 *
 * The one signal in this unit that touches a disk. It is kept here rather than in each caller
 * because `govern` and `doctor` both ask the question, and two readers of one folder is how they
 * come to disagree about it.
 */
// @signal readPreviewEnvironmentSnapshot
export function readPreviewEnvironmentSnapshot(root, reader = DISK) {
    const appsDir = join(root, 'apps');
    const appDirs = reader.exists(appsDir) ? reader.listDirs(appsDir).map((name) => `apps/${name}`) : [];
    const composePath = join(root, PREVIEW_COMPOSE_FILE);
    return {
        appDirs,
        composeText: reader.exists(composePath) ? reader.read(composePath) : null,
        envExamplePresent: reader.exists(join(root, PREVIEW_ENV_EXAMPLE)),
    };
}
//# sourceMappingURL=preview-environment.js.map