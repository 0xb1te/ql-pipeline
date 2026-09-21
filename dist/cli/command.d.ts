import type { GateStage } from './gate-command.js';
export type Command = {
    readonly kind: 'gate';
    readonly stage: GateStage;
    readonly reportPath: string;
} | {
    readonly kind: 'govern';
    readonly reportsDir: string;
} | {
    readonly kind: 'test-preview';
} | {
    readonly kind: 'init';
    readonly root: string;
} | {
    readonly kind: 'upgrade';
    readonly root: string;
    readonly force: boolean;
} | {
    readonly kind: 'doctor';
    readonly root: string;
};
export type CommandParse = {
    readonly ok: true;
    readonly command: Command;
} | {
    readonly ok: false;
    readonly reason: string;
};
export declare const USAGE: string;
/**
 * Parses the subcommand each pipeline job invokes. Every GitHub check maps
 * to exactly one of these — that mapping is what keeps the three jobs
 * independent: a job runs one command and reports its own result.
 *
 * Kept apart from `main.ts` so that importing the parser (in tests, or
 * anywhere else) can never execute the CLI as a side effect.
 */
export declare function parseCommand(argv: readonly string[]): CommandParse;
