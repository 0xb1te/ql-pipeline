import type { PipelineDecision } from '../verdict/verdict.js';
import type { Area, GateOutcome } from './types.js';

export interface AuditSummaryInput {
  readonly areas: readonly Area[];
  readonly gateOutcomes: readonly GateOutcome[];
  readonly findingCount: number;
  readonly decision: PipelineDecision;
  readonly attemptNumber: number;
  readonly maxFixAttempts: number;
}

/**
 * Renders one audit-trail PR comment per pipeline run. Per plan.md §6
 * ("every verdict, complaint, and fix attempt is persisted as PR
 * comments/check outputs — the full decision trail is reconstructible from
 * the PR alone"), this is what makes that true in practice.
 */
export function formatAuditSummary(input: AuditSummaryInput): string {
  const lines: string[] = ['### ql-pipeline summary', '', `**Areas:** ${input.areas.join(', ')}`];

  if (input.gateOutcomes.length > 0) {
    lines.push('', '**Gates:**');
    for (const outcome of input.gateOutcomes) {
      lines.push(`- ${outcome.area}/${outcome.gate}: ${outcome.passed ? 'passed' : 'failed'}`);
    }
  }

  lines.push(
    '',
    `**Findings:** ${input.findingCount}`,
    '',
    `**Decision:** ${input.decision.kind} (attempt ${input.attemptNumber} of ${input.maxFixAttempts})`,
  );

  if (input.decision.kind === 'BLOCK') {
    lines.push(`> ${input.decision.reason}`);
  }

  return lines.join('\n');
}
