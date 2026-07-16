import { exec as nodeExec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(nodeExec);

/**
 * Runs a trusted, config-defined command string through a shell (needed for
 * `&&`/pipes). Never feed PR-derived content into `command` — this is for
 * fixed strings from pipeline.config.yml or hardcoded commands like `git
 * status`, not diffs or model output (see RULES.md R5.4).
 */
export type CommandExecutor = (command: string, options: { cwd: string }) => Promise<{ stdout: string; stderr: string }>;

export const defaultCommandExecutor: CommandExecutor = async (command, options) => execAsync(command, options);
