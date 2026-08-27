import { type CommandExecutor } from '../shared/exec.js';
import type { AreaGate, GateOutcome } from '../shared/types.js';
export type { CommandExecutor } from '../shared/exec.js';
export interface RunGatesOptions {
    readonly cwd: string;
    readonly exec?: CommandExecutor;
}
/**
 * Executes every build/test command a RouteDecision's gates name, one at a
 * time (not concurrently — gates commonly share a working directory and a
 * `npm run build` racing a `npm test` in the same tree is not safe).
 * Gate commands come from pipeline.config.yml, a trusted, R4-protected file
 * — not from PR content — so running them through a shell (needed for
 * `&&`/pipes) does not carry the injection risk RULES.md R5.4 guards
 * against; that rule is about never splicing PR-derived text into a shell
 * string, which nothing here does.
 */
export declare function runGates(gates: readonly AreaGate[], options: RunGatesOptions): Promise<GateOutcome[]>;
export declare function allGatesPassed(outcomes: readonly GateOutcome[]): boolean;
