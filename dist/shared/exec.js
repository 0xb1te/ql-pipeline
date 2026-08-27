import { exec as nodeExec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(nodeExec);
export const defaultCommandExecutor = async (command, options) => execAsync(command, options);
//# sourceMappingURL=exec.js.map