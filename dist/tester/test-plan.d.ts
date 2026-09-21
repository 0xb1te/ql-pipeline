/**
 * The pinned sheet the tester job parses. ql-docs `workflow/flows/testing-plan.md` fixes the
 * name, the header row and the column order; this is the other half of that contract, and the
 * two change together or not at all.
 */
export declare const MCP_SHEET_NAME = "MCP Cases";
/** Column headers, in order. Matched by text; the order is documented but not required here. */
export declare const MCP_HEADERS: readonly ["Case-id", "Feature area", "Precondition", "Call", "Input", "Expected result", "Severity"];
export declare const SEVERITIES: readonly ["blocker", "major", "minor"];
export type CaseSeverity = (typeof SEVERITIES)[number];
export interface TestCase {
    readonly caseId: string;
    readonly featureArea: string;
    readonly precondition: string;
    /** An MCP tool name (`create_invoice`) or `METHOD /path` for an HTTP endpoint. */
    readonly call: string;
    /** The parsed payload. `{}` when the cell was empty. */
    readonly input: unknown;
    readonly expected: string;
    readonly severity: CaseSeverity;
    /** 1-based row in the sheet, so a complaint can name where to go and fix it. */
    readonly row: number;
}
export declare class TestPlanError extends Error {
    constructor(message: string);
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
export declare function parseTestPlan(bytes: Buffer): readonly TestCase[];
