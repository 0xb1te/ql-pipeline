import type { Area, GateOutcome, RequiredCheck } from './types.js';

/**
 * The handoff between the gate jobs and the pipeline job. Each gate stage
 * runs as its own GitHub check, so its outcomes have to survive the job
 * boundary as a file rather than staying in memory.
 */
export interface GateReport {
  readonly stage: Exclude<RequiredCheck, 'ai-review'>;
  readonly outcomes: readonly GateOutcome[];
}

/**
 * Gate output is fed to the AI reviewer and into finding text, so a
 * runaway build log would blow up the prompt. Keep the tail, which is
 * where compilers and test runners put the actual errors.
 */
export const MAX_OUTPUT_CHARS = 4000;

export function truncateOutput(output: string, max: number = MAX_OUTPUT_CHARS): string {
  if (output.length <= max) {
    return output;
  }
  return `[... ${output.length - max} characters truncated ...]\n${output.slice(-max)}`;
}

export function serializeGateReport(report: GateReport): string {
  const trimmed: GateReport = {
    stage: report.stage,
    outcomes: report.outcomes.map((outcome) => ({ ...outcome, output: truncateOutput(outcome.output) })),
  };
  return JSON.stringify(trimmed, null, 2);
}

export type GateReportParse =
  | { readonly ok: true; readonly report: GateReport }
  | { readonly ok: false; readonly reason: string };

/**
 * Parses a gate report written by another job. Validated rather than
 * trusted: a malformed report means the pipeline cannot tell whether the
 * gates passed, which has to fail closed like any other unknown.
 */
export function parseGateReport(raw: string): GateReportParse {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (cause) {
    return { ok: false, reason: `gate report is not valid JSON: ${String(cause)}` };
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'gate report is not a JSON object' };
  }
  const record = data as Record<string, unknown>;

  const stage = record['stage'];
  if (stage !== 'build' && stage !== 'test') {
    return { ok: false, reason: '"stage" must be "build" or "test"' };
  }

  const rawOutcomes = record['outcomes'];
  if (!Array.isArray(rawOutcomes)) {
    return { ok: false, reason: '"outcomes" must be an array' };
  }

  const outcomes: GateOutcome[] = [];
  for (const [index, item] of rawOutcomes.entries()) {
    const outcome = parseOutcome(item, index, stage);
    if (!outcome.ok) {
      return { ok: false, reason: outcome.reason };
    }
    outcomes.push(outcome.value);
  }

  return { ok: true, report: { stage, outcomes } };
}

type OutcomeParse = { ok: true; value: GateOutcome } | { ok: false; reason: string };

function parseOutcome(value: unknown, index: number, stage: 'build' | 'test'): OutcomeParse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: `outcomes[${index}] is not a JSON object` };
  }
  const record = value as Record<string, unknown>;

  const area = record['area'];
  if (typeof area !== 'string' || area.length === 0) {
    return { ok: false, reason: `outcomes[${index}].area must be a non-empty string` };
  }
  const command = record['command'];
  if (typeof command !== 'string') {
    return { ok: false, reason: `outcomes[${index}].command must be a string` };
  }
  const passed = record['passed'];
  if (typeof passed !== 'boolean') {
    return { ok: false, reason: `outcomes[${index}].passed must be a boolean` };
  }
  const output = record['output'];
  if (typeof output !== 'string') {
    return { ok: false, reason: `outcomes[${index}].output must be a string` };
  }
  if (record['gate'] !== stage) {
    return { ok: false, reason: `outcomes[${index}].gate must match the report stage ("${stage}")` };
  }

  return { ok: true, value: { area: area as Area, gate: stage, command, passed, output } };
}

/** Merges several stage reports into one outcome list, in stage order. */
export function mergeGateReports(reports: readonly GateReport[]): GateOutcome[] {
  const order: readonly GateReport['stage'][] = ['test', 'build'];
  return order.flatMap((stage) => reports.filter((report) => report.stage === stage).flatMap((r) => r.outcomes));
}
