// @neuron entrypoint.cli.gateCommand
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as core from '@actions/core';
import { runGates } from '../router/gate-runner.js';
import { serializeGateReport } from '../shared/gate-report.js';
import { createPipelineContext, resolveRouting } from './bootstrap.js';
/**
 * Narrows a route's gates to a single stage, so the `test` job runs only
 * test commands and the `build` job only build commands. Areas with
 * nothing configured for this stage drop out entirely.
 */
// @signal gatesForStage
export function gatesForStage(decision, stage) {
    return decision.gates
        .filter((gate) => gate[stage] !== undefined)
        .map((gate) => ({ area: gate.area, [stage]: gate[stage] }));
}
// @signal writeGateReport
export function writeGateReport(path, report) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, serializeGateReport(report), 'utf-8');
}
/**
 * Runs one gate stage as its own GitHub check.
 *
 * The report is written even when the stage fails — the pipeline job reads
 * it to turn a broken build into a finding the fix agent can repair, which
 * is the whole reason this job does not simply halt the chain on failure.
 */
// @signal runGateStage
export async function runGateStage(stage, reportPath) {
    const { config, pr, client, logger, consumerRoot } = createPipelineContext();
    const routing = await resolveRouting(client, pr, config);
    if (routing.kind === 'not-governed') {
        logger.info(`skipping the ${stage} gate: ${routing.reason}`);
        writeGateReport(reportPath, { stage, outcomes: [] });
        return;
    }
    if (routing.kind === 'unroutable' || routing.kind === 'target-conflict') {
        // Reported in full (with a PR comment) by the pipeline job; this check
        // just refuses to claim a pass it cannot justify.
        writeGateReport(reportPath, { stage, outcomes: [] });
        core.setFailed(`cannot run the ${stage} gate: ${routing.reason}`);
        return;
    }
    const gates = gatesForStage(routing.route, stage);
    if (gates.length === 0) {
        logger.info(`no ${stage} gate is configured for ${routing.route.areas.join(', ')}; nothing to run`);
        writeGateReport(reportPath, { stage, outcomes: [] });
        return;
    }
    const outcomes = await runGates(gates, { cwd: consumerRoot });
    writeGateReport(reportPath, { stage, outcomes });
    const failed = outcomes.filter((outcome) => !outcome.passed);
    for (const outcome of outcomes) {
        logger.info(`${outcome.area}/${outcome.gate}: ${outcome.passed ? 'passed' : 'FAILED'} (${outcome.command})`);
    }
    for (const outcome of failed) {
        logger.error(outcome.output);
    }
    if (failed.length > 0) {
        core.setFailed(`${failed.length} ${stage} gate(s) failed: ${failed.map((outcome) => outcome.area).join(', ')}`);
    }
}
//# sourceMappingURL=gate-command.js.map