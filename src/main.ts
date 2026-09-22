// @neuron entrypoint.main.main
import { resolve } from 'node:path';
import * as core from '@actions/core';
import { parseCommand } from './cli/command.js';
import { runGateStage } from './cli/gate-command.js';
import { runGovern } from './cli/govern-command.js';
import { runTestPreview } from './cli/test-preview-command.js';
import { runDeployPreview } from './cli/deploy-preview-command.js';
import { runDoctor, runInit, runUpgrade } from './cli/scaffold-commands.js';

/**
 * The single entrypoint for every ql-pipeline command.
 *
 * Two audiences share it. The reusable workflow runs the CI commands, one
 * per GitHub check:
 *
 *   ql-pipeline gate --stage test    -> the "test" check
 *   ql-pipeline gate --stage build   -> the "build" check
 *   ql-pipeline govern               -> the "ql-pipeline" check
 *   ql-pipeline deploy-preview       -> the "preview" check
 *   ql-pipeline test-preview         -> the "preview-tester" check
 *
 * Developers run the scaffolding commands locally, to adopt the pipeline
 * and to keep the files it manages current:
 *
 *   ql-pipeline init / upgrade / doctor
 */
// @signal main
async function main(): Promise<void> {
  const parsed = parseCommand(process.argv.slice(2));
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  const command = parsed.command;

  switch (command.kind) {
    case 'gate':
      await runGateStage(command.stage, command.reportPath);
      return;
    case 'govern':
      await runGovern(command.reportsDir);
      return;
    case 'test-preview':
      await runTestPreview();
      return;
    case 'deploy-preview':
      await runDeployPreview();
      return;
    case 'init':
      runInit(resolve(command.root));
      return;
    case 'upgrade':
      runUpgrade(resolve(command.root), command.force);
      return;
    case 'doctor':
      // The only command whose exit code reports a verdict rather than a
      // crash — a failing check should fail a CI step that runs it.
      process.exitCode = (await runDoctor(resolve(command.root))) ? 0 : 1;
      return;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error : String(error);

  // The scaffolding commands are run by a person in a terminal, where an
  // Actions workflow-command annotation is just noise.
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    core.setFailed(message);
    return;
  }
  console.error(typeof message === 'string' ? message : message.message);
  process.exitCode = 1;
});
