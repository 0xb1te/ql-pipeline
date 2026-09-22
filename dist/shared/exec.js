// @neuron shared.core.exec
import { exec as nodeExec, execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(nodeExec);
// @signal defaultCommandExecutor
export const defaultCommandExecutor = async (command, options) => execAsync(command, options);
const execFileAsync = promisify(nodeExecFile);
// @signal defaultArgvExecutor
export const defaultArgvExecutor = async (file, args, options) => execFileAsync(file, [...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    maxBuffer: 16 * 1024 * 1024,
});
//# sourceMappingURL=exec.js.map