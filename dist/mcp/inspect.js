// @neuron mcp.server.inspect
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { countFixAttempts } from '../fixer/attempt-counter.js';
import { NEEDS_HUMAN_LABEL, READY_TO_MERGE_LABEL } from '../merger/merger.js';
import { determineRoute } from '../router/router.js';
import { loadConfig } from '../shared/config.js';
import { createGithubClient } from '../shared/github-client.js';
import { gateFindings, isReviewRequired } from '../verdict/required-checks.js';
import { decidePipelineOutcome } from '../verdict/verdict.js';
/**
 * The read-only half of this MCP server.
 *
 * Everything here answers a question about a governance run without being one. `govern` decides
 * *and acts* — it reviews with a paid model, comments, resolves threads, pushes fix commits,
 * approves, labels and merges — so "what did the pipeline decide about this PR" could only be
 * asked by causing it to happen again. These tools compose the same functions `govern` composes,
 * in the same order, and stop before anything writes.
 *
 * They run in-process rather than spawning `dist/main.js` the way the maintenance tools do,
 * because there is no CLI subcommand to spawn: the verbs are functions. Inventing five
 * subcommands to wrap them would add a second public API surface larger than the one this is
 * about. The functions are already pure and injectable (RULES.md R3.4), which is exactly what an
 * in-process tool wants.
 *
 * `gate` and `govern` themselves stay off this server. See the carve-out recorded on `runTool`
 * in ./tools.ts.
 */
const ROOT_PROPERTY = {
    type: 'string',
    description: 'Absolute path to the repo to inspect. Defaults to this MCP server process\'s own working directory, ' +
        'which is rarely what you want — pass an explicit absolute path.',
};
const REPORTS_DIR_PROPERTY = {
    type: 'string',
    description: 'Directory holding the gate jobs\' JSON reports, relative to `root` unless absolute. Defaults to ' +
        '"gate-reports", which is what the reusable workflow writes.',
};
const FINDINGS_PROPERTY = {
    type: 'array',
    description: 'AI review findings to weigh alongside the gates. Omit to ask what the gates alone decide. Each entry ' +
        'needs severity ("must" | "should" | "security"), rule, file, line, problem, and autoFixable; ' +
        'suggestedFix may be null.',
    items: {
        type: 'object',
        properties: {
            severity: { type: 'string', enum: ['must', 'should', 'security'] },
            rule: { type: 'string' },
            file: { type: 'string' },
            line: { type: 'number' },
            problem: { type: 'string' },
            suggestedFix: { type: ['string', 'null'] },
            autoFixable: { type: 'boolean' },
        },
        required: ['severity', 'rule', 'file', 'line', 'problem', 'autoFixable'],
        additionalProperties: false,
    },
};
export const INSPECT_TOOLS = [
    {
        name: 'ql_pipeline_route',
        description: 'Read-only. Answers "where would this pull request route, and why": the areas its conventional-commit ' +
            'headers claim, the rule files that pulls in, and the build/test gate commands each area runs. Reads the ' +
            "repo's pipeline config; runs nothing and changes nothing. An unroutable PR comes back with the reason " +
            'rather than an error.',
        inputSchema: {
            type: 'object',
            properties: {
                root: ROOT_PROPERTY,
                commitMessages: {
                    type: 'array',
                    description: "The PR's commit messages, newest or oldest first — order does not matter.",
                    items: { type: 'string' },
                },
                prTitle: {
                    type: 'string',
                    description: 'Fallback when no commit parses, exactly as the pipeline itself falls back.',
                },
                configPath: {
                    type: 'string',
                    description: 'Explicit pipeline config path. Defaults to $PIPELINE_CONFIG_PATH, then .github/pipeline.config.yml, ' +
                        'then pipeline.config.yml.',
                },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'ql_pipeline_gate_reports',
        description: 'Read-only. Reads back what the build and test gate jobs left behind for a run — per area and stage: the ' +
            'command, whether it passed, and its (truncated) output. Uses the pipeline\'s own reader, so a malformed ' +
            'report is reported as unreadable rather than quietly skipped. Touches no network.',
        inputSchema: {
            type: 'object',
            properties: { root: ROOT_PROPERTY, reportsDir: REPORTS_DIR_PROPERTY },
            additionalProperties: false,
        },
    },
    {
        name: 'ql_pipeline_verdict',
        description: 'Read-only. The question `govern` exists to answer, without govern\'s side effects: given the gate reports ' +
            'on disk and any review findings you pass in, would this pull request MERGE, FIX, or BLOCK — and why that ' +
            'one? Also reports the blocking and advisory split, how many fix attempts the commits show, and whether AI ' +
            'review is a required check. Merges nothing, comments nowhere, pushes nothing.',
        inputSchema: {
            type: 'object',
            properties: {
                root: ROOT_PROPERTY,
                reportsDir: REPORTS_DIR_PROPERTY,
                findings: FINDINGS_PROPERTY,
                commitMessages: {
                    type: 'array',
                    description: "The PR's commit messages. Used only to count prior fix attempts, the same way the pipeline counts " +
                        'them: `[bot]`-suffixed commits already on the branch.',
                    items: { type: 'string' },
                },
                configPath: { type: 'string', description: 'Explicit pipeline config path; see ql_pipeline_route.' },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'ql_pipeline_human_queue',
        description: 'Read-only. Lists the open pull requests this pipeline has parked on a person: `needs-human` (it stopped ' +
            'and asked) and `ready-to-merge` (it approved, and merging is a human\'s call). This is the queue ' +
            'ql-pipeline fills and, until now, could not read back. Requires GITHUB_TOKEN; lists only, and never ' +
            'labels, comments or merges.',
        inputSchema: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: 'Repository owner, e.g. "0xb1te".' },
                repo: { type: 'string', description: 'Repository name, e.g. "ql-pipeline".' },
                queue: {
                    type: 'string',
                    enum: ['needs-human', 'ready-to-merge', 'both'],
                    description: 'Which queue to read. Defaults to "both".',
                },
            },
            required: ['owner', 'repo'],
            additionalProperties: false,
        },
    },
];
async function resolveReader(deps) {
    if (deps.readReports !== undefined) {
        return deps.readReports;
    }
    const governCommand = await import('../cli/govern-command.js');
    return governCommand.readGateReports;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function readString(params, key) {
    const value = params[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function readStringArray(params, key) {
    const value = params[key];
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((entry) => typeof entry === 'string');
}
function ok(payload) {
    return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: false };
}
function fail(message) {
    return { content: [{ type: 'text', text: message }], isError: true };
}
/**
 * Where the pipeline config lives for a repo being inspected from outside CI.
 *
 * `createPipelineContext` can hardcode `.github/pipeline.config.yml` because every job it serves
 * runs inside a consumer checkout. An inspector is also pointed at repositories that keep their
 * config at the root — ql-pipeline itself is one — so both are probed before giving up.
 */
const CONFIG_CANDIDATES = ['.github/pipeline.config.yml', 'pipeline.config.yml'];
function resolveConfigPath(root, explicit, env, fileExists) {
    const named = explicit ?? env['PIPELINE_CONFIG_PATH'];
    if (named !== undefined && named.length > 0) {
        const path = isAbsolute(named) ? named : join(root, named);
        return fileExists(path) ? { ok: true, path } : { ok: false, reason: `no pipeline config at "${path}"` };
    }
    for (const candidate of CONFIG_CANDIDATES) {
        const path = join(root, candidate);
        if (fileExists(path)) {
            return { ok: true, path };
        }
    }
    return {
        ok: false,
        reason: `no pipeline config found under "${root}" (looked for ${CONFIG_CANDIDATES.join(' and ')}). ` +
            'Pass configPath, or point root at a repo that has adopted the pipeline.',
    };
}
/**
 * Findings arrive as JSON from an agent rather than from the reviewer, so they are checked rather
 * than trusted. A finding whose severity did not survive the trip would silently change the
 * verdict — an unrecognised severity is not `must`, and guessing one is how an inspector starts
 * disagreeing with the engine it is supposed to report on.
 */
const SEVERITIES = ['must', 'should', 'security'];
function parseFindings(value) {
    if (value === undefined) {
        return { ok: true, findings: [] };
    }
    if (!Array.isArray(value)) {
        return { ok: false, reason: '"findings" must be an array' };
    }
    const findings = [];
    for (const [index, entry] of value.entries()) {
        if (!isRecord(entry)) {
            return { ok: false, reason: `findings[${String(index)}] is not an object` };
        }
        const severity = entry['severity'];
        if (typeof severity !== 'string' || !SEVERITIES.includes(severity)) {
            return {
                ok: false,
                reason: `findings[${String(index)}].severity must be one of ${SEVERITIES.join(', ')}`,
            };
        }
        if (typeof entry['autoFixable'] !== 'boolean') {
            return { ok: false, reason: `findings[${String(index)}].autoFixable must be a boolean` };
        }
        const suggestedFix = entry['suggestedFix'];
        findings.push({
            severity: severity,
            rule: typeof entry['rule'] === 'string' ? entry['rule'] : '(unnamed rule)',
            file: typeof entry['file'] === 'string' ? entry['file'] : '(unknown)',
            line: typeof entry['line'] === 'number' ? entry['line'] : 1,
            problem: typeof entry['problem'] === 'string' ? entry['problem'] : '',
            suggestedFix: typeof suggestedFix === 'string' ? suggestedFix : null,
            autoFixable: entry['autoFixable'],
        });
    }
    return { ok: true, findings };
}
function describeFinding(finding) {
    return {
        severity: finding.severity,
        rule: finding.rule,
        file: finding.file,
        line: finding.line,
        problem: finding.problem,
        autoFixable: finding.autoFixable,
    };
}
function describeGateOutcomes(outcomes) {
    return outcomes.map((outcome) => ({
        area: outcome.area,
        gate: outcome.gate,
        command: outcome.command,
        passed: outcome.passed,
        output: outcome.output,
    }));
}
/**
 * Runs one read-only inspection tool, or answers `null` when the name belongs to somebody else —
 * which is what lets `runTool` keep its own switch for the spawning tools untouched.
 */
// @signal runInspectTool
export async function runInspectTool(name, args, deps = {}) {
    const params = isRecord(args) ? args : {};
    const env = deps.env ?? process.env;
    const fileExists = deps.fileExists ?? existsSync;
    const loadPipelineConfig = deps.loadPipelineConfig ?? loadConfig;
    const root = resolve(readString(params, 'root') ?? '.');
    switch (name) {
        case 'ql_pipeline_route':
            return routeTool(params, root, env, fileExists, loadPipelineConfig);
        case 'ql_pipeline_gate_reports':
            return gateReportsTool(params, root, await resolveReader(deps));
        case 'ql_pipeline_verdict':
            return verdictTool(params, root, env, fileExists, loadPipelineConfig, await resolveReader(deps));
        case 'ql_pipeline_human_queue':
            return humanQueueTool(params, env, deps.createClient ?? createGithubClient);
        default:
            return null;
    }
}
function withConfig(root, params, env, fileExists, loadPipelineConfig) {
    const located = resolveConfigPath(root, readString(params, 'configPath'), env, fileExists);
    if (!located.ok) {
        return { ok: false, result: fail(located.reason) };
    }
    try {
        return { ok: true, config: loadPipelineConfig(located.path), path: located.path };
    }
    catch (cause) {
        // ConfigError carries the reason a human needs; anything else is reported as-is rather than
        // escaping to the JSON-RPC layer, where it would surface as a transport error.
        return { ok: false, result: fail(cause instanceof Error ? cause.message : String(cause)) };
    }
}
function routeTool(params, root, env, fileExists, loadPipelineConfig) {
    const loaded = withConfig(root, params, env, fileExists, loadPipelineConfig);
    if (!loaded.ok) {
        return loaded.result;
    }
    const commitMessages = readStringArray(params, 'commitMessages');
    const prTitle = readString(params, 'prTitle') ?? '';
    if (commitMessages.length === 0 && prTitle.length === 0) {
        return fail('pass commitMessages, prTitle, or both — there is nothing to route otherwise');
    }
    const route = determineRoute({ commitMessages, prTitle }, loaded.config);
    if (!route.ok) {
        // Unroutable is a verdict, not a malfunction: the pipeline reports it and blocks. Returning it
        // as an error result would tell an agent the tool failed.
        return ok({ configPath: loaded.path, routable: false, reason: route.reason });
    }
    return ok({
        configPath: loaded.path,
        routable: true,
        types: route.decision.types,
        areas: route.decision.areas,
        ruleFiles: route.decision.ruleFiles,
        gates: route.decision.gates,
        targetBranch: loaded.config.merge.targetBranch,
        requiredChecks: loaded.config.merge.requiredChecks,
    });
}
function resolveReportsDir(params, root) {
    const named = readString(params, 'reportsDir') ?? 'gate-reports';
    return isAbsolute(named) ? named : join(root, named);
}
function gateReportsTool(params, root, readReports) {
    const reportsDir = resolveReportsDir(params, root);
    const reports = readReports(reportsDir);
    if (!reports.ok) {
        return fail(reports.reason);
    }
    return ok({
        reportsDir,
        outcomes: describeGateOutcomes(reports.outcomes),
        // An empty list is the honest answer for a directory the gate jobs never wrote, and is exactly
        // what `govern` sees in that case — worth saying out loud rather than leaving as `[]`.
        note: reports.outcomes.length === 0
            ? 'no gate reports found; the pipeline would treat this run as having no gate results'
            : undefined,
    });
}
function verdictTool(params, root, env, fileExists, loadPipelineConfig, readReports) {
    const loaded = withConfig(root, params, env, fileExists, loadPipelineConfig);
    if (!loaded.ok) {
        return loaded.result;
    }
    const parsedFindings = parseFindings(params['findings']);
    if (!parsedFindings.ok) {
        return fail(parsedFindings.reason);
    }
    const reportsDir = resolveReportsDir(params, root);
    const reports = readReports(reportsDir);
    if (!reports.ok) {
        return fail(reports.reason);
    }
    const requiredChecks = loaded.config.merge.requiredChecks;
    const fromGates = gateFindings(reports.outcomes, requiredChecks);
    const findings = [...fromGates, ...parsedFindings.findings];
    const attemptsSoFar = countFixAttempts(readStringArray(params, 'commitMessages'));
    const decision = decidePipelineOutcome({
        findings,
        attemptsSoFar,
        maxFixAttempts: loaded.config.fixer.maxFixAttempts,
        fixAdvisory: loaded.config.fixer.fixAdvisory,
    });
    return ok({
        configPath: loaded.path,
        reportsDir,
        verdict: decision.kind,
        reason: decision.kind === 'BLOCK' ? decision.reason : undefined,
        blockingFindings: (decision.kind === 'MERGE' ? [] : decision.findings).map(describeFinding),
        advisoryFindings: decision.advisoryFindings.map(describeFinding),
        gateOutcomes: describeGateOutcomes(reports.outcomes),
        findingsFromGates: fromGates.length,
        findingsSupplied: parsedFindings.findings.length,
        attemptsSoFar,
        maxFixAttempts: loaded.config.fixer.maxFixAttempts,
        requiredChecks,
        aiReviewRequired: isReviewRequired(requiredChecks),
        requireHumanApproval: loaded.config.merge.requireHumanApproval,
        // Said plainly, because the whole point of this tool is that asking did not cause any of it.
        note: 'read-only: this is what `govern` would decide from the same inputs. Nothing was merged, ' +
            'commented, labelled or pushed.',
    });
}
async function humanQueueTool(params, env, createClient) {
    const owner = readString(params, 'owner');
    const repo = readString(params, 'repo');
    if (owner === undefined || repo === undefined) {
        return fail('"owner" and "repo" are both required');
    }
    const token = env['GITHUB_TOKEN'];
    if (token === undefined || token.length === 0) {
        return fail('GITHUB_TOKEN environment variable is required to read a repository\'s human queue');
    }
    const queue = readString(params, 'queue') ?? 'both';
    const labels = queue === 'both'
        ? [NEEDS_HUMAN_LABEL, READY_TO_MERGE_LABEL]
        : queue === NEEDS_HUMAN_LABEL || queue === READY_TO_MERGE_LABEL
            ? [queue]
            : null;
    if (labels === null) {
        return fail(`"queue" must be one of ${NEEDS_HUMAN_LABEL}, ${READY_TO_MERGE_LABEL}, both`);
    }
    const client = createClient(token);
    try {
        const byLabel = await Promise.all(labels.map(async (label) => ({ label, pulls: await client.listPullRequestsByLabel({ owner, repo }, label) })));
        return ok({
            owner,
            repo,
            queues: byLabel.map((entry) => ({
                label: entry.label,
                count: entry.pulls.length,
                pullRequests: entry.pulls.map((pull) => ({
                    number: pull.number,
                    title: pull.title,
                    url: pull.url,
                    isDraft: pull.isDraft,
                    labels: pull.labels,
                    updatedAt: pull.updatedAt,
                })),
            })),
            note: 'read-only: nothing was labelled, approved or merged.',
        });
    }
    catch (cause) {
        return fail(`could not read the human queue for ${owner}/${repo}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
}
//# sourceMappingURL=inspect.js.map