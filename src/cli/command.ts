import type { GateStage } from './gate-command.js';

export type Command =
  | { readonly kind: 'gate'; readonly stage: GateStage; readonly reportPath: string }
  | { readonly kind: 'govern'; readonly reportsDir: string };

export type CommandParse =
  | { readonly ok: true; readonly command: Command }
  | { readonly ok: false; readonly reason: string };

export const USAGE = [
  'usage:',
  '  main.js gate --stage <test|build> [--report <path>]',
  '  main.js govern [--reports <dir>]',
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

  return { ok: false, reason: `unknown command "${subcommand ?? '(none)'}"\n\n${USAGE}` };
}
