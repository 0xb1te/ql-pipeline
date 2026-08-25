import * as core from '@actions/core';
import { parseCommand } from './cli/command.js';
import { runGateStage } from './cli/gate-command.js';
import { runGovern } from './cli/govern-command.js';

/**
 * The single entrypoint every pipeline job invokes, dispatching to the one
 * command that job is responsible for. Each GitHub check runs exactly one
 * of these:
 *
 *   node dist/main.js gate --stage test    -> the "test" check
 *   node dist/main.js gate --stage build   -> the "build" check
 *   node dist/main.js govern               -> the "ql-pipeline" check
 */
async function main(): Promise<void> {
  const parsed = parseCommand(process.argv.slice(2));
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }

  if (parsed.command.kind === 'gate') {
    await runGateStage(parsed.command.stage, parsed.command.reportPath);
    return;
  }

  await runGovern(parsed.command.reportsDir);
}

main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error : String(error));
});
