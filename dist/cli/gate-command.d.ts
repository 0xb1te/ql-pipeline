import { type GateReport } from '../shared/gate-report.js';
import type { AreaGate, RouteDecision } from '../shared/types.js';
export type GateStage = GateReport['stage'];
/**
 * Narrows a route's gates to a single stage, so the `test` job runs only
 * test commands and the `build` job only build commands. Areas with
 * nothing configured for this stage drop out entirely.
 */
export declare function gatesForStage(decision: RouteDecision, stage: GateStage): AreaGate[];
export declare function writeGateReport(path: string, report: GateReport): void;
/**
 * Runs one gate stage as its own GitHub check.
 *
 * The report is written even when the stage fails — the pipeline job reads
 * it to turn a broken build into a finding the fix agent can repair, which
 * is the whole reason this job does not simply halt the chain on failure.
 */
export declare function runGateStage(stage: GateStage, reportPath: string): Promise<void>;
