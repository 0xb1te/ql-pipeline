// @neuron tester.preview.testPlan
import { readWorkbook, XlsxError } from './xlsx-reader.js';
/**
 * The pinned sheet the tester job parses. ql-docs `workflow/flows/testing-plan.md` fixes the
 * name, the header row and the column order; this is the other half of that contract, and the
 * two change together or not at all.
 */
export const MCP_SHEET_NAME = 'MCP Cases';
/** Column headers, in order. Matched by text; the order is documented but not required here. */
export const MCP_HEADERS = [
    'Case-id',
    'Feature area',
    'Precondition',
    'Call',
    'Input',
    'Expected result',
    'Severity',
];
export const SEVERITIES = ['blocker', 'major', 'minor'];
export class TestPlanError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TestPlanError';
    }
}
function headerIndexes(header) {
    const found = new Map();
    header.forEach((cell, index) => {
        const name = cell.trim();
        if (name !== '' && !found.has(name))
            found.set(name, index);
    });
    return found;
}
/**
 * Reads the `MCP Cases` sheet into cases, or throws.
 *
 * Every failure here throws rather than returning fewer cases, and that is the whole design. A
 * plan that is empty or unparseable must fail loudly: a silently skipped test run that reports
 * success is worse than having no tester at all, because it manufactures evidence. The caller
 * turns the throw into a finding on the pull request; it never swallows it.
 *
 * Zero data rows is the one shape that is not an error. ql-docs is explicit that an absent sheet
 * and an empty sheet mean different things - absent is a malformed workbook, empty is a task
 * stating it has no MCP surface worth driving - and reading them the same way would force a lie
 * into one of the two.
 */
// @signal parseTestPlan
export function parseTestPlan(bytes) {
    let sheets;
    try {
        sheets = readWorkbook(bytes);
    }
    catch (cause) {
        const detail = cause instanceof XlsxError ? cause.message : String(cause);
        throw new TestPlanError(`testing-plan.xlsx could not be read: ${detail}`);
    }
    const rows = sheets.get(MCP_SHEET_NAME);
    if (rows === undefined) {
        const names = [...sheets.keys()].map((name) => `"${name}"`).join(', ');
        throw new TestPlanError(`testing-plan.xlsx has no "${MCP_SHEET_NAME}" sheet (it has ${names || 'no sheets'}). ` +
            'The name is pinned — that exact spelling, capitalisation and single space. ' +
            'An absent sheet is a malformed workbook; a sheet with no rows is how a task says it has no MCP surface.');
    }
    const header = rows[0];
    if (header === undefined) {
        throw new TestPlanError(`the "${MCP_SHEET_NAME}" sheet is completely empty — row 1 must carry the headers`);
    }
    const index = headerIndexes(header);
    const absent = MCP_HEADERS.filter((name) => !index.has(name));
    if (absent.length > 0) {
        throw new TestPlanError(`the "${MCP_SHEET_NAME}" sheet is missing required column(s): ${absent.join(', ')}. ` +
            `Row 1 must be the header row. Found: ${header.map((h) => `"${h}"`).join(', ')}`);
    }
    const at = (row, name) => (row[index.get(name) ?? -1] ?? '').trim();
    const cases = [];
    const seen = new Set();
    rows.slice(1).forEach((row, offset) => {
        const rowNumber = offset + 2;
        if (row.every((cell) => cell.trim() === ''))
            return; // spreadsheet padding, not a case
        const caseId = at(row, 'Case-id');
        const call = at(row, 'Call');
        const expected = at(row, 'Expected result');
        const severityCell = at(row, 'Severity').toLowerCase();
        const blank = ['Case-id', 'Call', 'Expected result', 'Severity'].filter((name) => at(row, name) === '');
        if (blank.length > 0) {
            throw new TestPlanError(`row ${String(rowNumber)}: ${blank.join(', ')} must not be empty`);
        }
        if (seen.has(caseId)) {
            // Two rows with one id make a finding unattributable to a case, which is the one thing a
            // report has to get right.
            throw new TestPlanError(`row ${String(rowNumber)}: duplicate Case-id "${caseId}"`);
        }
        seen.add(caseId);
        if (!SEVERITIES.includes(severityCell)) {
            throw new TestPlanError(`row ${String(rowNumber)}: Severity must be one of ${SEVERITIES.join(', ')} (got "${at(row, 'Severity')}")`);
        }
        const rawInput = at(row, 'Input');
        let input = {};
        if (rawInput !== '') {
            try {
                input = JSON.parse(rawInput);
            }
            catch {
                throw new TestPlanError(`row ${String(rowNumber)}: Input is not valid JSON. One cell, one JSON value — got ${rawInput.slice(0, 120)}`);
            }
        }
        cases.push({
            caseId,
            featureArea: at(row, 'Feature area'),
            precondition: at(row, 'Precondition'),
            call,
            input,
            expected,
            severity: severityCell,
            row: rowNumber,
        });
    });
    return cases;
}
//# sourceMappingURL=test-plan.js.map