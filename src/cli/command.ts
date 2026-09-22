// @neuron entrypoint.cli.command
import type { GateStage } from './gate-command.js';

export type Command =
  | { readonly kind: 'gate'; readonly stage: GateStage; readonly reportPath: string }
  | { readonly kind: 'govern'; readonly reportsDir: string }
  | { readonly kind: 'test-preview' }
  | { readonly kind: 'deploy-preview' }
  | { readonly kind: 'init'; readonly root: string }
  | { readonly kind: 'upgrade'; readonly root: string; readonly force: boolean }
  | { readonly kind: 'doctor'; readonly root: string };

export type CommandParse =
  | { readonly ok: true; readonly command: Command }
  | { readonly ok: false; readonly reason: string };

export const USAGE = [
  'usage:',
  '  ql-pipeline init [--root <dir>]                 scaffold this repo',
  '  ql-pipeline upgrade [--root <dir>] [--force]    refresh managed files',
  '  ql-pipeline doctor [--root <dir>]               check the setup',
  '',
  'run inside CI by the reusable workflow:',
  '  ql-pipeline gate --stage <test|build> [--report <path>]',
  '  ql-pipeline govern [--reports <dir>]',
  '  ql-pipeline deploy-preview                     bring the preview up through ql-proxy',
  '  ql-pipeline test-preview                       drive the preview over MCP',
].join('\n');

function readFlag(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return argv[index + 1];
}

/**
 * Parses the subcommand each pipeline job invokes. Every GitHub check maps
 * to exactly one of these — that mapping is what keeps the three jobs
 * independent: a job runs one command and reports its own result.
 *
 * Kept apart from `main.ts` so that importing the parser (in tests, or
 * anywhere else) can never execute the CLI as a side effect.
 */
// @signal parseCommand
export function parseCommand(argv: readonly string[]): CommandParse {
  const [subcommand] = argv;

  if (subcommand === 'gate') {
    const stage = readFlag(argv, '--stage');
    if (stage !== 'test' && stage !== 'build') {
      return { ok: false, reason: `"gate" requires --stage test or --stage build\n\n${USAGE}` };
    }
    return {
      ok: true,
      command: { kind: 'gate', stage, reportPath: readFlag(argv, '--report') ?? `gate-reports/${stage}.json` },
    };
  }

  if (subcommand === 'govern') {
    return { ok: true, command: { kind: 'govern', reportsDir: readFlag(argv, '--reports') ?? 'gate-reports' } };
  }

  // Takes no flags on purpose. Which plan to run comes from the branch, and where the MCP
  // server is comes from the environment the preview job published - both are facts about
  // the run, and a flag would be a second place for either to be wrong.
  if (subcommand === 'test-preview') {
    return { ok: true, command: { kind: 'test-preview' } };
  }

  // No flags either, for the same reason: the branch, the repository, the devops folder and the
  // task folder to seed from are all facts about the run, read from the context and the checkout.
  if (subcommand === 'deploy-preview') {
    return { ok: true, command: { kind: 'deploy-preview' } };
  }

  const root = readFlag(argv, '--root') ?? '.';

  if (subcommand === 'init') {
    return { ok: true, command: { kind: 'init', root } };
  }

  if (subcommand === 'upgrade') {
    return { ok: true, command: { kind: 'upgrade', root, force: argv.includes('--force') } };
  }

  if (subcommand === 'doctor') {
    return { ok: true, command: { kind: 'doctor', root } };
  }

  return { ok: false, reason: `unknown command "${subcommand ?? '(none)'}"\n\n${USAGE}` };
}
