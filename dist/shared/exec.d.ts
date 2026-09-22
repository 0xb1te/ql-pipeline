/**
 * Runs a trusted, config-defined command string through a shell (needed for
 * `&&`/pipes). Never feed PR-derived content into `command` — this is for
 * fixed strings from pipeline.config.yml or hardcoded commands like `git
 * status`, not diffs or model output (see RULES.md R5.4).
 */
export type CommandExecutor = (command: string, options: {
    cwd: string;
}) => Promise<{
    stdout: string;
    stderr: string;
}>;
export declare const defaultCommandExecutor: CommandExecutor;
/**
 * Runs a program with an argument vector and no shell.
 *
 * The other executor exists for config-defined command strings that need `&&` and pipes. This
 * one exists for the opposite case: a fixed program handed values that come from the pull
 * request - a branch name, a repository, a checkout path - which must reach it as arguments and
 * never be interpolated into a shell string. `env` is layered over the process environment so
 * a child can be told one more thing without losing PATH.
 */
export type ArgvExecutor = (file: string, args: readonly string[], options: {
    cwd: string;
    env?: Readonly<Record<string, string>>;
}) => Promise<{
    stdout: string;
    stderr: string;
}>;
export declare const defaultArgvExecutor: ArgvExecutor;
