import type { GateOutcome, GateStage } from './types.js';
/**
 * The handoff between the gate jobs and the pipeline job. Each gate stage
 * runs as its own GitHub check, so its outcomes have to survive the job
 * boundary as a file rather than staying in memory.
 */
export interface GateReport {
    readonly stage: GateStage;
    readonly outcomes: readonly GateOutcome[];
}
/**
 * Gate output is fed to the AI reviewer and into finding text, so a
 * runaway build log would blow up the prompt. Keep the tail, which is
 * where compilers and test runners put the actual errors.
 */
export declare const MAX_OUTPUT_CHARS = 4000;
export declare function truncateOutput(output: string, max?: number): string;
export declare function serializeGateReport(report: GateReport): string;
export type GateReportParse = {
    readonly ok: true;
    readonly report: GateReport;
} | {
    readonly ok: false;
    readonly reason: string;
};
/**
 * Parses a gate report written by another job. Validated rather than
 * trusted: a malformed report means the pipeline cannot tell whether the
 * gates passed, which has to fail closed like any other unknown.
 */
export declare function parseGateReport(raw: string): GateReportParse;
/** Merges several stage reports into one outcome list, in stage order. */
export declare function mergeGateReports(reports: readonly GateReport[]): GateOutcome[];
