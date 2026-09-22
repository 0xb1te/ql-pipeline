// @neuron entrypoint.cli.testPreviewCommand
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as core from '@actions/core';
import { createMcpClient } from '../tester/mcp-client.js';
import { parseTestPlan, TestPlanError } from '../tester/test-plan.js';
import { formatTesterComment, runTestPlan, testerFindings } from '../tester/tester.js';
import { lookupTaskFolder, taskFolderGlobFor } from '../verdict/task-artifacts.js';
import { createPipelineContext } from './bootstrap.js';
/** Where the preview stack published its MCP server, on the runner's own compose network. */
export const MCP_ENDPOINT_VAR = 'QL_PREVIEW_MCP_URL';
/**
 * The last job in the chain: a green pull request with a live preview, seeded with its own test
 * data, driven over MCP so an agent can say what broke.
 *
 * It reaches the application over the **internal compose network**, which is why the job runs on
 * the same self-hosted host as the preview. The MCP surface is never publicly routed: the preview
 * URL's only lock is a gate token meant for showing somebody a demo, and a token that opens a demo
 * must not also open a tool that can read every user.
 *
 * Everything that goes wrong here is reported, never swallowed. An unparseable plan fails loudly,
 * because a silently skipped test run that reports success is worse than having no tester. An
 * unreachable MCP server is a finding about the feature, not an infrastructure hiccup.
 */
// @signal runTestPreview
export async function runTestPreview() {
    const { pr, client, logger, consumerRoot } = createPipelineContext();
    const endpoint = process.env[MCP_ENDPOINT_VAR];
    if (endpoint === undefined || endpoint.trim() === '') {
        // Not a silent skip: the job only runs when the preview job brought a stack up, so a missing
        // endpoint means that job and this one disagree about what was deployed.
        core.setFailed(`${MCP_ENDPOINT_VAR} is not set, so there is no preview MCP server to drive`);
        return;
    }
    const lookup = lookupTaskFolder(pr.headRef, consumerRoot);
    if (lookup.kind === 'not-a-task-branch') {
        logger.info(`no task folder named by branch ${pr.headRef} — nothing to test`);
        return;
    }
    if (lookup.kind === 'no-folder') {
        core.setFailed(`no task folder matches ${taskFolderGlobFor(lookup.ref)}, so this preview has no test plan to run`);
        return;
    }
    const planPath = `${lookup.path}/testing-plan.xlsx`;
    const absolutePlan = join(consumerRoot, planPath);
    if (!existsSync(absolutePlan)) {
        core.setFailed(`${planPath} is missing, so this preview cannot be tested`);
        return;
    }
    let cases;
    try {
        cases = parseTestPlan(readFileSync(absolutePlan));
    }
    catch (cause) {
        const detail = cause instanceof TestPlanError ? cause.message : String(cause);
        // Loudly, and on the pull request: a plan nobody can parse is a plan nobody is running, and
        // the author is the only person who can fix it.
        await client.postComment(pr, `## Preview tester\n\n**The test plan could not be read, so no case ran.**\n\n> ${detail}\n\n` +
            'This fails rather than passing quietly. A test run that skips its cases and reports ' +
            'success manufactures evidence — see ql-docs `workflow/flows/testing-plan.md`.');
        core.setFailed(`${planPath}: ${detail}`);
        return;
    }
    if (cases.length === 0) {
        logger.info(`${planPath} declares no MCP cases — nothing to drive`);
        return;
    }
    logger.info(`driving ${String(cases.length)} case(s) from ${planPath} against ${endpoint}`);
    const run = await runTestPlan(createMcpClient({ endpoint }), cases);
    // ONE comment, posted once, now that everything has finished — not a stream. A per-case comment
    // turns a twenty-case plan into twenty notifications and hands a fix agent twenty prompts for
    // what is usually one root cause.
    await client.postComment(pr, formatTesterComment(run, cases, planPath));
    const findings = testerFindings(run, planPath);
    const blocking = findings.filter((finding) => finding.severity === 'must');
    logger.info(`tester: ${String(findings.length)} finding(s), ${String(blocking.length)} blocking`);
    if (blocking.length > 0) {
        core.setFailed(`${String(blocking.length)} blocking case failure(s) against the preview`);
    }
}
//# sourceMappingURL=test-preview-command.js.map