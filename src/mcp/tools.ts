// @neuron mcp.server.tools
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// dist/mcp/tools.js -> the installed package root is two up, same depth as
// dist/cli/scaffold-commands.js's own PACKAGE_ROOT computation.
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN_JS = join(PACKAGE_ROOT, 'dist', 'main.js');

export interface ToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly isError: boolean;
}

const ROOT_PROPERTY = {
  type: 'string',
  description:
    'Absolute path to the repo to operate on. Defaults to this MCP server process\'s own working directory, ' +
    'which is rarely what you want — pass an explicit absolute path.',
} as const;

export const TOOLS: readonly ToolDescriptor[] = [
  {
    name: 'ql_pipeline_doctor',
    description:
      "Runs `ql-pipeline doctor`: checks whether a repo's pipeline scaffolding (workflow, config, standards " +
      'checkout, Cursor rules) is present and consistent, without changing anything. Returns pass/warn/fail per ' +
      'check plus a suggested fix for anything short of a pass.',
    inputSchema: { type: 'object', properties: { root: ROOT_PROPERTY }, additionalProperties: false },
  },
  {
    name: 'ql_pipeline_init',
    description:
      'Runs `ql-pipeline init`: scaffolds this pipeline into a repo for the first time — the caller workflow, ' +
      'pipeline config, and Cursor rules. Never overwrites a file the repo already owns (its config) and never ' +
      'discards local edits to a managed file; run `ql_pipeline_doctor` afterward to see what still needs a human ' +
      '(repository secrets, a real build/test command in the config).',
    inputSchema: { type: 'object', properties: { root: ROOT_PROPERTY }, additionalProperties: false },
  },
  {
    name: 'ql_pipeline_upgrade',
    description:
      'Runs `ql-pipeline upgrade`: refreshes this repo\'s managed files (caller workflow, Cursor rules) to match ' +
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Runs one of the three maintenance commands as a child process of the
 * already-built CLI (`dist/main.js`), exactly as a person at a terminal
 * would — this MCP server has no in-process code path for `doctor`/`init`/
 * `upgrade` of its own. `gate`/`govern` are deliberately not exposed here:
 * they are CI-triggered, not maintenance actions an agent should invoke
 * ad hoc.
 */
// @signal runTool
export async function runTool(name: string, args: unknown): Promise<ToolResult> {
  const params = isRecord(args) ? args : {};
  const root = resolve(typeof params['root'] === 'string' && params['root'].length > 0 ? params['root'] : '.');

  let cliArgs: string[];
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

function runCli(cliArgs: readonly string[], cwd: string): Promise<ToolResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [MAIN_JS, ...cliArgs], { cwd, env: process.env });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf-8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf-8')));

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
