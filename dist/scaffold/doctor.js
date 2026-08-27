/**
 * Everything `doctor` can determine without network access or secrets.
 *
 * It deliberately cannot verify that `CURSOR_API_KEY` or `STANDARDS_TOKEN`
 * are set — those live in GitHub Actions secrets, which a local CLI has no
 * business reading. It says so rather than implying a clean bill of health
 * it cannot give.
 */
export function runDoctorChecks(input) {
    const results = [];
    results.push(callerWorkflowCheck(input));
    results.push(configCheck(input));
    results.push(gatesCheck(input));
    results.push(...standardsChecks(input));
    results.push(cursorRulesCheck(input));
    return results;
}
function callerWorkflowCheck(input) {
    if (!input.callerWorkflowPresent) {
        return {
            name: 'caller workflow',
            status: 'fail',
            detail: 'no workflow calling ql-pipeline was found',
            fix: 'run `ql-pipeline init`',
        };
    }
    if (!input.callerWorkflowReferencesPipeline) {
        return {
            name: 'caller workflow',
            status: 'warn',
            detail: 'a governance workflow exists but does not reference ql-pipeline',
            fix: 'check that it `uses:` 0xb1te/ql-pipeline/.github/workflows/pr-pipeline.yml',
        };
    }
    return { name: 'caller workflow', status: 'pass', detail: 'present and calling ql-pipeline' };
}
function configCheck(input) {
    if (!input.configPresent) {
        return {
            name: 'pipeline config',
            status: 'fail',
            detail: 'no pipeline config found',
            fix: 'run `ql-pipeline init`',
        };
    }
    if (input.configError !== null) {
        return {
            name: 'pipeline config',
            status: 'fail',
            detail: input.configError,
            fix: 'fix the config; the pipeline fails closed rather than guessing',
        };
    }
    return { name: 'pipeline config', status: 'pass', detail: `valid, target branch "${input.targetBranch ?? '?'}"` };
}
function gatesCheck(input) {
    if (input.configError !== null || !input.configPresent) {
        return { name: 'gates', status: 'warn', detail: 'not checked — the config could not be read' };
    }
    if (input.gatedAreas.length === 0) {
        return {
            name: 'gates',
            status: 'warn',
            detail: 'no area has build or test commands configured, so those checks will pass vacuously',
            fix: 'set gates.<area>.build / .test in the pipeline config',
        };
    }
    return { name: 'gates', status: 'pass', detail: `configured for ${input.gatedAreas.join(', ')}` };
}
function standardsChecks(input) {
    // Without a readable config we do not know what the standards settings
    // are — saying "disabled" would state as fact something we never read.
    if (!input.configPresent || input.configError !== null) {
        return [{ name: 'standards', status: 'warn', detail: 'not checked — the config could not be read' }];
    }
    if (!input.standardsEnabled) {
        return [
            {
                name: 'standards',
                status: 'warn',
                detail: 'disabled — PRs are reviewed against rules only, not the house engineering standards',
            },
        ];
    }
    const results = [];
    if (!input.standardsRootPresent) {
        results.push({
            name: 'standards',
            status: 'warn',
            detail: 'not checked out locally (CI clones them itself, so this only affects your editor)',
            fix: 'git clone git@github.com:0xb1te/prompt-utils.git .standards',
        });
        return results;
    }
    if (input.missingStandardsDocs.length > 0) {
        results.push({
            name: 'standards',
            status: 'fail',
            detail: `${input.missingStandardsDocs.length} configured document(s) missing: ${input.missingStandardsDocs.join(', ')}`,
            fix: 'update the checkout (`git -C .standards pull`) or correct standards.docs',
        });
    }
    else {
        results.push({ name: 'standards', status: 'pass', detail: 'all configured documents resolve' });
    }
    if (!input.standardsIgnored) {
        results.push({
            name: 'standards ignored',
            status: 'warn',
            detail: 'the standards checkout is not in .gitignore and could be committed by accident',
            fix: "echo '.standards/' >> .gitignore",
        });
    }
    return results;
}
function cursorRulesCheck(input) {
    if (input.cursorRuleCount === 0) {
        return {
            name: 'cursor rules',
            status: 'warn',
            detail: 'none installed — the editor will not follow the same standards the reviewer applies',
            fix: 'run `ql-pipeline init`',
        };
    }
    return { name: 'cursor rules', status: 'pass', detail: `${input.cursorRuleCount} rule(s) installed` };
}
export function worstStatus(results) {
    if (results.some((result) => result.status === 'fail')) {
        return 'fail';
    }
    return results.some((result) => result.status === 'warn') ? 'warn' : 'pass';
}
//# sourceMappingURL=doctor.js.map