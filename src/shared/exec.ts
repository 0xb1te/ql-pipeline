// @neuron shared.core.exec
import { exec as nodeExec, execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(nodeExec);

/**
 * Runs a trusted, config-defined command string through a shell (needed for
 * `&&`/pipes). Never feed PR-derived content into `command` — this is for
 * fixed strings from pipeline.config.yml or hardcoded commands like `git
 * status`, not diffs or model output (see RULES.md R5.4).
 */
export type CommandExecutor = (command: string, options: { cwd: string }) => Promise<{ stdout: string; stderr: string }>;

// @signal defaultCommandExecutor
export const defaultCommandExecutor: CommandExecutor = async (command, options) => execAsync(command, options);

const execFileAsync = promisify(nodeExecFile);

/**
 * Runs a program with an argument vector and no shell.
 *
 * The other executor exists for config-defined command strings that need `&&` and pipes. This
 * one exists for the opposite case: a fixed program handed values that come from the pull
 * request - a branch name, a repository, a checkout path - which must reach it as arguments and
 * never be interpolated into a shell string. `env` is layered over the process environment so
 * a child can be told one more thing without losing PATH.
 */
export type ArgvExecutor = (
  file: string,
  args: readonly string[],
  options: { cwd: string; env?: Readonly<Record<string, string>> },
) => Promise<{ stdout: string; stderr: string }>;

// @signal defaultArgvExecutor
export const defaultArgvExecutor: ArgvExecutor = async (file, args, options) =>
  execFileAsync(file, [...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    maxBuffer: 16 * 1024 * 1024,
  });
