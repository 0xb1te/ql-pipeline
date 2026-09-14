// @neuron shared.core.auditSummary
import type { PipelineDecision } from '../verdict/verdict.js';
import type { Area, GateOutcome } from './types.js';

/** What survived of one standards document, for the coverage line. */
export interface StandardsCoverage {
  readonly id: string;
  readonly keptSections: number;
  readonly droppedSections: number;
  readonly droppedChars: number;
}

/** What the whole-prompt ceiling cut, on top of any per-area cap. */
export interface PromptCoverage {
  readonly droppedSections: number;
  readonly droppedChars: number;
  /** True when the diff filled the budget and no standards fit at all. */
  readonly omitted: boolean;
}

export interface AuditSummaryInput {
  readonly areas: readonly Area[];
  readonly gateOutcomes: readonly GateOutcome[];
  readonly findingCount: number;
  readonly decision: PipelineDecision;
  readonly attemptNumber: number;
  readonly maxFixAttempts: number;
  readonly targetBranch: string;
  /** False when the AI review was skipped (gate failure, or not a required check). */
  readonly reviewRan: boolean;
  /** Per-document coverage; only documents that lost something are listed. */
  readonly standardsCoverage?: readonly StandardsCoverage[];
  /** Present only when the prompt ceiling cut the standards further. */
  readonly promptCoverage?: PromptCoverage;
}

/**
 * Renders one audit-trail PR comment per pipeline run. Per plan.md §6
 * ("every verdict, complaint, and fix attempt is persisted as PR
 * comments/check outputs — the full decision trail is reconstructible from
 * the PR alone"), this is what makes that true in practice.
 */
// @signal formatAuditSummary
export function formatAuditSummary(input: AuditSummaryInput): string {
  const lines: string[] = [
    '### ql-pipeline summary',
    '',
    `**Areas:** ${input.areas.join(', ')}`,
    `**Target branch:** ${input.targetBranch}`,
  ];

  if (input.gateOutcomes.length > 0) {
    lines.push('', '**Gates:**');
    for (const outcome of input.gateOutcomes) {
      lines.push(`- ${outcome.area}/${outcome.gate}: ${outcome.passed ? 'passed' : 'failed'}`);
    }
  }

  // Coverage sits directly above the finding count, because it is what makes
  // that count readable: `Findings: 0` against a gutted standards block does
  // not mean the same thing as `Findings: 0` against the whole document.
  const coverage = input.standardsCoverage ?? [];
  if (coverage.length > 0 || input.promptCoverage !== undefined) {
    lines.push('', '**Standards coverage:**');
    for (const doc of coverage) {
      const total = doc.keptSections + doc.droppedSections;
      lines.push(
        `- ${doc.id} — ${doc.keptSections} of ${total} sections; ` +
          `${doc.droppedSections} dropped (${doc.droppedChars} chars) by the per-area cap`,
      );
    }
    if (input.promptCoverage?.omitted === true) {
      lines.push('- the diff filled the prompt budget; **no engineering standards were sent at all**');
    } else if (input.promptCoverage !== undefined) {
      lines.push(
        `- the prompt ceiling cut a further ${input.promptCoverage.droppedSections} sections ` +
          `(${input.promptCoverage.droppedChars} chars)`,
      );
    }
  }

  lines.push(
    '',
    `**AI review:** ${input.reviewRan ? 'ran' : 'skipped'}`,
    `**Findings:** ${input.findingCount}`,
    '',
    `**Decision:** ${input.decision.kind} (attempt ${input.attemptNumber} of ${input.maxFixAttempts})`,
  );

  if (input.decision.kind === 'BLOCK') {
    lines.push(`> ${input.decision.reason}`);
  }

  return lines.join('\n');
}
