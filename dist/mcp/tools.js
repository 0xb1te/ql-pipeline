// @neuron mcp.server.tools
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSPECT_TOOLS, runInspectTool } from './inspect.js';
// dist/mcp/tools.js -> the installed package root is two up, same depth as
// dist/cli/scaffold-commands.js's own PACKAGE_ROOT computation.
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN_JS = join(PACKAGE_ROOT, 'dist', 'main.js');
const ROOT_PROPERTY = {
    type: 'string',
    description: 'Absolute path to the repo to operate on. Defaults to this MCP server process\'s own working directory, ' +
        'which is rarely what you want — pass an explicit absolute path.',
};
/**
 * The tools that shell out to the already-built CLI. Everything here changes a repo on disk
 * (or, for `doctor`, reports on one) and is a maintenance action a person would otherwise run
 * in a terminal.
 */
const MAINTENANCE_TOOLS = [
    {
        name: 'ql_pipeline_doctor',
        description: "Runs `ql-pipeline doctor`: checks whether a repo's pipeline scaffolding (workflow, config, standards " +
            'checkout, Cursor rules) is present and consistent, without changing anything. Returns pass/warn/fail per ' +
            'check plus a suggested fix for anything short of a pass.',
        inputSchema: { type: 'object', properties: { root: ROOT_PROPERTY }, additionalProperties: false },
    },
    {
        name: 'ql_pipeline_init',
        description: 'Runs `ql-pipeline init`: scaffolds this pipeline into a repo for the first time — the caller workflow, ' +
            'pipeline config, and Cursor rules. Never overwrites a file the repo already owns (its config) and never ' +
            'discards local edits to a managed file; run `ql_pipeline_doctor` afterward to see what still needs a human ' +
            '(repository secrets, a real build/test command in the config).',
        inputSchema: { type: 'object', properties: { root: ROOT_PROPERTY }, additionalProperties: false },
    },
    {
        name: 'ql_pipeline_upgrade',
        description: 'Runs `ql-pipeline upgrade`: refreshes this repo\'s managed files (caller workflow, Cursor rules) to match ' +
            'the ql-pipeline version installed, skipping any managed file that was edited locally unless `force` is set.',
        inputSchema: {
            type: 'object',
            properties: {
                root: ROOT_PROPERTY,
                force: {
                    type: 'boolean',
                    description: 'Discard local edits to managed files and overwrite them with the current template.',
                },
            },
            additionalProperties: false,
        },
    },
];
/**
 * Maintenance first, then inspection - the order `tools/list` reports them in, and the order a
 * reader meets them. Adding a tool is meant to be a deliberate act: two exact-equality assertions
 * (tests/mcp/tools.test.ts and tests/mcp/server.test.ts) pin this list by name, and a new entry
 * fails both until it is named there too.
 */
export const TOOLS = [...MAINTENANCE_TOOLS, ...INSPECT_TOOLS];
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
/**
 * Membership is checked before dispatching rather than calling and seeing, so that a maintenance
 * tool reaches `spawn` in the same tick it was asked for - an `await` here would be invisible in
 * production and load-bearing in a test that drives the fake child process synchronously.
 */
const INSPECT_TOOL_NAMES = new Set(INSPECT_TOOLS.map((tool) => tool.name));
/**
 * Dispatches a tool call: the read-only inspection tools answer in-process (./inspect.ts), and
 * anything left is one of the three maintenance commands, run as a child process of the
 * already-built CLI (`dist/main.js`) exactly as a person at a terminal would.
 *
 * ## The CI-verb carve-out
 *
 * `gate` and `govern` are deliberately not exposed on this server, and the reason is not that
 * they are CI-triggered - it is that they **write**. `govern` merges to the target branch,
 * approves pull requests, posts comments and pushes fix commits; `gate` executes the shell
 * commands named in `gates:`. This repository's own config sets `require_human_approval: true`
 * precisely so that no agent both changes code and merges it, and a tool calling `runGovern`
 * would hand that capability back through another door.
 *
 * What makes the carve-out survivable is that the *reading* half is here: the reason to want
 * `govern` on an MCP was to learn what it would decide, and `ql_pipeline_verdict` answers that
 * without merging anything.
 *
 * Recorded, not assumed: ql-docs GR-04's parity clause admits exactly one exception (secrets),
 * which this is not, and says a capability the CLI has and the MCP lacks is a House `problem`.
 * That conversation is still owed. See docs/features/040-governance-verbs-on-mcp/plan.md.
 */
// @signal runTool
export async function runTool(name, args) {
    if (INSPECT_TOOL_NAMES.has(name)) {
        const inspected = await runInspectTool(name, args);
        if (inspected !== null) {
            return inspected;
        }
    }
    const params = isRecord(args) ? args : {};
    const root = resolve(typeof params['root'] === 'string' && params['root'].length > 0 ? params['root'] : '.');
    let cliArgs;
    switch (name) {
        case 'ql_pipeline_doctor':
            cliArgs = ['doctor', '--root', root];
            break;
        case 'ql_pipeline_init':
            cliArgs = ['init', '--root', root];
            break;
        case 'ql_pipeline_upgrade':
            cliArgs = ['upgrade', '--root', root, ...(params['force'] === true ? ['--force'] : [])];
            break;
        default:
            return { content: [{ type: 'text', text: `unknown tool "${name}"` }], isError: true };
    }
    return runCli(cliArgs, root);
}
function runCli(cliArgs, cwd) {
    return new Promise((resolvePromise) => {
        const child = spawn(process.execPath, [MAIN_JS, ...cliArgs], { cwd, env: process.env });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => (stdout += chunk.toString('utf-8')));
        child.stderr.on('data', (chunk) => (stderr += chunk.toString('utf-8')));
        child.on('error', (cause) => {
            resolvePromise({
                content: [{ type: 'text', text: `failed to launch "ql-pipeline ${cliArgs.join(' ')}": ${String(cause)}` }],
                isError: true,
            });
        });
        child.on('close', (exitCode) => {
            const text = [stdout, stderr.length > 0 ? `----- stderr -----\n${stderr}` : '']
                .filter((part) => part.length > 0)
                .join('\n\n');
            resolvePromise({
                content: [{ type: 'text', text: text.length > 0 ? text : `(no output; exit code ${String(exitCode)})` }],
                isError: exitCode !== 0,
            });
        });
    });
}
//# sourceMappingURL=tools.js.map