// @neuron routing.router.gateRunner
import { defaultCommandExecutor } from '../shared/exec.js';
/**
 * Executes every build/test command a RouteDecision's gates name, one at a
 * time (not concurrently — gates commonly share a working directory and a
 * `npm run build` racing a `npm test` in the same tree is not safe).
 * Gate commands come from pipeline.config.yml, a trusted, R4-protected file
 * — not from PR content — so running them through a shell (needed for
 * `&&`/pipes) does not carry the injection risk RULES.md R5.4 guards
 * against; that rule is about never splicing PR-derived text into a shell
 * string, which nothing here does.
 */
// @signal runGates
export async function runGates(gates, options) {
    const exec = options.exec ?? defaultCommandExecutor;
    const outcomes = [];
    for (const gate of gates) {
        if (gate.build !== undefined) {
            outcomes.push(await runOne(gate.area, 'build', gate.build, options.cwd, exec));
        }
        if (gate.test !== undefined) {
            outcomes.push(await runOne(gate.area, 'test', gate.test, options.cwd, exec));
        }
    }
    return outcomes;
}
async function runOne(area, kind, command, cwd, exec) {
    try {
        const { stdout, stderr } = await exec(command, { cwd });
        return { area, gate: kind, command, passed: true, output: stdout + stderr };
    }
    catch (cause) {
        const output = isExecError(cause) ? cause.stdout + cause.stderr : String(cause);
        return { area, gate: kind, command, passed: false, output };
    }
}
function isExecError(value) {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value;
    return typeof candidate.stdout === 'string' && typeof candidate.stderr === 'string';
}
// @signal allGatesPassed
export function allGatesPassed(outcomes) {
    return outcomes.every((outcome) => outcome.passed);
}
//# sourceMappingURL=gate-runner.js.map