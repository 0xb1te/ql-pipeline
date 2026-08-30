export const USAGE = [
    'usage:',
    '  ql-pipeline init [--root <dir>]                 scaffold this repo',
    '  ql-pipeline upgrade [--root <dir>] [--force]    refresh managed files',
    '  ql-pipeline doctor [--root <dir>]               check the setup',
    '',
    'run inside CI by the reusable workflow:',
    '  ql-pipeline gate --stage <test|build> [--report <path>]',
    '  ql-pipeline govern [--reports <dir>]',
].join('\n');
function readFlag(argv, flag) {
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
export function parseCommand(argv) {
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
//# sourceMappingURL=command.js.map