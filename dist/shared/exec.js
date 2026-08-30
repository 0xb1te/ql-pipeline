// @neuron shared.core.exec
import { exec as nodeExec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(nodeExec);
// @signal defaultCommandExecutor
export const defaultCommandExecutor = async (command, options) => execAsync(command, options);
//# sourceMappingURL=exec.js.map