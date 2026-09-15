// @neuron entrypoint.cli.scaffoldCommands
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../shared/config.js';
import { AREAS } from '../shared/types.js';
import { REVIEW_KINDS } from '../standards/review-kind.js';
import { allReviewDocumentPaths, resolveStandards } from '../standards/standards-resolver.js';
import { runDoctorChecks, worstStatus } from '../scaffold/doctor.js';
import { MANIFEST_PATH, parseManifest, serializeManifest } from '../scaffold/manifest.js';
import { isWrite, nextManifest, planInit, planUpgrade, } from '../scaffold/plan.js';
// dist/cli/scaffold-commands.js -> the installed package root is two up.
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATES_ROOT = join(PACKAGE_ROOT, 'templates');
const CONFIG_PATH = '.github/pipeline.config.yml';
const CALLER_WORKFLOW_PATH = '.github/workflows/pr-governance.yml';
const CURSOR_RULES_DIR = '.cursor/rules';
const STANDARDS_IGNORE_ENTRY = '.standards/';
function packageVersion() {
    try {
        const raw = readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8');
        const parsed = JSON.parse(raw);
        return typeof parsed.version === 'string' ? parsed.version : '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
/** Paths are stored POSIX-style so a manifest written on Windows matches one written on Linux. */
function toPosix(path) {
    return path.split(sep).join(posix.sep);
}
/** The full set of files ql-pipeline scaffolds, discovered from the shipped templates. */
// @signal loadTemplates
export function loadTemplates() {
    const templates = [
        {
            dest: CALLER_WORKFLOW_PATH,
            mode: 'managed',
            content: readFileSync(join(TEMPLATES_ROOT, 'consumer', '.github', 'workflows', 'pr-governance.yml'), 'utf-8'),
        },
        {
            dest: CONFIG_PATH,
            mode: 'owned',
            content: readFileSync(join(TEMPLATES_ROOT, 'consumer', '.github', 'pipeline.config.yml'), 'utf-8'),
        },
    ];
    // Discovered rather than listed, so adding a rule to the template needs
    // no code change here.
    const rulesDir = join(TEMPLATES_ROOT, 'cursor-rules', '.cursor', 'rules');
    if (existsSync(rulesDir)) {
        for (const name of readdirSync(rulesDir).filter((entry) => entry.endsWith('.mdc')).sort()) {
            templates.push({
                dest: `${CURSOR_RULES_DIR}/${name}`,
                mode: 'managed',
                content: readFileSync(join(rulesDir, name), 'utf-8'),
            });
        }
    }
    return templates;
}
function readExisting(root, templates) {
    const existing = new Map();
    for (const template of templates) {
        const absolute = join(root, template.dest);
        if (existsSync(absolute)) {
            existing.set(template.dest, { content: readFileSync(absolute, 'utf-8') });
        }
    }
    return existing;
}
function readManifest(root) {
    const absolute = join(root, MANIFEST_PATH);
    if (!existsSync(absolute)) {
        return null;
    }
    const parsed = parseManifest(readFileSync(absolute, 'utf-8'));
    // A corrupt manifest means we cannot prove we wrote anything, which is
    // the conservative reading: nothing gets overwritten without --force.
    return parsed.ok ? parsed.manifest : null;
}
function writeFile(root, dest, content) {
    const absolute = join(root, dest);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, 'utf-8');
}
function applyActions(root, actions) {
    for (const action of actions) {
        if (isWrite(action)) {
            writeFile(root, action.dest, action.content);
        }
    }
}
/** Appends `.standards/` to .gitignore if absent. Never rewrites the file. */
// @signal ensureStandardsIgnored
export function ensureStandardsIgnored(root) {
    const absolute = join(root, '.gitignore');
    const current = existsSync(absolute) ? readFileSync(absolute, 'utf-8') : '';
    if (current.split(/\r?\n/).some((line) => line.trim() === STANDARDS_IGNORE_ENTRY)) {
        return 'already-present';
    }
    const prefix = current.length === 0 || current.endsWith('\n') ? '' : '\n';
    writeFileSync(absolute, `${current}${prefix}${STANDARDS_IGNORE_ENTRY}\n`, 'utf-8');
    return 'added';
}
function describe(action) {
    switch (action.kind) {
        case 'create':
            return `  created   ${action.dest}`;
        case 'update':
            return `  updated   ${action.dest}`;
        case 'overwrite-modified':
            return `  forced    ${action.dest} (your edits were discarded)`;
        case 'unchanged':
            return `  current   ${action.dest}`;
        case 'skip-owned':
            return `  yours     ${action.dest} (never overwritten)`;
        case 'skip-modified':
            return `  MODIFIED  ${action.dest} (edited locally — left alone)`;
    }
}
// @signal runInit
export function runInit(root) {
    const templates = loadTemplates();
    const actions = planInit({ templates, existing: readExisting(root, templates) });
    applyActions(root, actions);
    writeFile(root, MANIFEST_PATH, serializeManifest(nextManifest(packageVersion(), templates, actions)));
    const ignore = ensureStandardsIgnored(root);
    console.log('ql-pipeline init\n');
    for (const action of actions) {
        console.log(describe(action));
    }
    console.log(`  ${ignore === 'added' ? 'created  ' : 'current  '} .gitignore (${STANDARDS_IGNORE_ENTRY})`);
    const created = actions.filter((action) => action.kind === 'create').length;
    console.log(`\n${created} file(s) written.\n`);
    console.log('Next steps — none of these can be done for you:');
    console.log('  1. Add repository secrets:');
    console.log('     CURSOR_API_KEY');
    console.log('     QL_HOUSE_API_URL, QL_AUTH_URL, QL_AUTH_CLIENT_ID, QL_AUTH_CLIENT_SECRET');
    console.log('     (the govern job reads engineering standards from house-api with these;');
    console.log('      skip them only if you set standards.enabled: false)');
    console.log(`  2. Edit ${CONFIG_PATH} — set your real build and test commands`);
    console.log('  3. Optional — clone the standards for your editor:');
    console.log('     git clone git@github.com:0xb1te/ql-docs.git .standards');
    console.log('  4. Open one PR and watch it through before requiring the checks');
    console.log('\nThen run `ql-pipeline doctor` to verify the setup.');
}
// @signal runUpgrade
export function runUpgrade(root, force) {
    const templates = loadTemplates();
    const actions = planUpgrade({
        templates,
        existing: readExisting(root, templates),
        manifest: readManifest(root),
        force,
    });
    applyActions(root, actions);
    writeFile(root, MANIFEST_PATH, serializeManifest(nextManifest(packageVersion(), templates, actions)));
    console.log(`ql-pipeline upgrade → v${packageVersion()}\n`);
    for (const action of actions) {
        console.log(describe(action));
    }
    const written = actions.filter(isWrite).length;
    const modified = actions.filter((action) => action.kind === 'skip-modified');
    console.log(`\n${written} file(s) written.`);
    if (modified.length > 0) {
        console.log(`\n${modified.length} managed file(s) were edited locally and left untouched. Review them against the` +
            ' current template, then either re-apply your changes elsewhere or run `ql-pipeline upgrade --force`' +
            ' to discard them.');
    }
}
async function collectDoctorInput(root) {
    const workflowsDir = join(root, '.github', 'workflows');
    let callerWorkflowPresent = false;
    let callerWorkflowReferencesPipeline = false;
    if (existsSync(workflowsDir)) {
        for (const name of readdirSync(workflowsDir).filter((entry) => /\.ya?ml$/.test(entry))) {
            const content = readFileSync(join(workflowsDir, name), 'utf-8');
            if (content.includes('ql-pipeline/.github/workflows/pr-pipeline.yml')) {
                callerWorkflowPresent = true;
                callerWorkflowReferencesPipeline = true;
                break;
            }
            if (name === 'pr-governance.yml') {
                callerWorkflowPresent = true;
            }
        }
    }
    const configAbsolute = join(root, CONFIG_PATH);
    const configPresent = existsSync(configAbsolute);
    let configError = null;
    let targetBranch = null;
    let gatedAreas = [];
    let standardsEnabled = false;
    let standardsRoot = '.standards';
    let missingStandardsDocs = [];
    if (configPresent) {
        try {
            const config = parseConfig(readFileSync(configAbsolute, 'utf-8'), CONFIG_PATH);
            targetBranch = config.merge.targetBranch;
            gatedAreas = Object.entries(config.gates)
                .filter(([, commands]) => commands?.build !== undefined || commands?.test !== undefined)
                .map(([area]) => area);
            standardsEnabled = config.standards.enabled;
            standardsRoot = config.standards.root;
            if (standardsEnabled && existsSync(join(root, standardsRoot))) {
                const expected = new Set(allReviewDocumentPaths());
                const missing = [];
                for (const kind of REVIEW_KINDS) {
                    const resolved = await resolveStandards([...AREAS], config.standards, root, undefined, kind);
                    missing.push(...resolved.missing.filter((path) => expected.has(path)));
                }
                missingStandardsDocs = [...new Set(missing)];
            }
        }
        catch (cause) {
            configError = cause instanceof Error ? cause.message : String(cause);
        }
    }
    const gitignore = existsSync(join(root, '.gitignore')) ? readFileSync(join(root, '.gitignore'), 'utf-8') : '';
    const rulesDir = join(root, CURSOR_RULES_DIR);
    return {
        callerWorkflowPresent,
        callerWorkflowReferencesPipeline,
        configPresent,
        configError,
        targetBranch,
        gatedAreas,
        standardsEnabled,
        standardsRootPresent: existsSync(join(root, standardsRoot)),
        missingStandardsDocs,
        standardsIgnored: gitignore.split(/\r?\n/).some((line) => line.trim() === STANDARDS_IGNORE_ENTRY),
        cursorRuleCount: existsSync(rulesDir) ? readdirSync(rulesDir).filter((n) => n.endsWith('.mdc')).length : 0,
    };
}
const SYMBOL = { pass: '  ok  ', warn: ' warn ', fail: ' FAIL ' };
/** Returns true when nothing failed, so the caller can set the exit code. */
// @signal runDoctor
export async function runDoctor(root) {
    const results = runDoctorChecks(await collectDoctorInput(root));
    console.log(`ql-pipeline doctor — ${toPosix(relative(process.cwd(), root) || '.')}\n`);
    for (const result of results) {
        console.log(`[${SYMBOL[result.status]}] ${result.name}: ${result.detail}`);
        if (result.fix !== undefined && result.status !== 'pass') {
            console.log(`          → ${result.fix}`);
        }
    }
    const worst = worstStatus(results);
    console.log('\nNot checkable from here: whether CURSOR_API_KEY, QL_HOUSE_API_URL, QL_AUTH_URL, QL_AUTH_CLIENT_ID, and' +
        ' QL_AUTH_CLIENT_SECRET are set as repository secrets. Verify those in GitHub settings.');
    if (worst === 'fail') {
        console.log('\nSetup is incomplete — see the FAIL lines above.');
        return false;
    }
    console.log(worst === 'warn' ? '\nUsable, with warnings above.' : '\nAll checks passed.');
    return true;
}
//# sourceMappingURL=scaffold-commands.js.map