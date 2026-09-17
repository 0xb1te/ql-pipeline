export type CheckStatus = 'pass' | 'warn' | 'fail';
export interface CheckResult {
    readonly name: string;
    readonly status: CheckStatus;
    readonly detail: string;
    /** What to do about it, when there is something to do. */
    readonly fix?: string;
}
export interface DoctorInput {
    readonly callerWorkflowPresent: boolean;
    readonly callerWorkflowReferencesPipeline: boolean;
    readonly configPresent: boolean;
    /** null when the config is absent or unparseable. */
    readonly configError: string | null;
    readonly targetBranch: string | null;
    readonly gatedAreas: readonly string[];
    readonly standardsEnabled: boolean;
    readonly standardsRootPresent: boolean;
    /** Configured standards documents that are not on disk. */
    readonly missingStandardsDocs: readonly string[];
    readonly standardsIgnored: boolean;
    readonly cursorRuleCount: number;
}
/**
 * Everything `doctor` can determine without network access or secrets.
 *
 * It deliberately cannot verify that `GH_PACKAGES_TOKEN`, `CURSOR_API_KEY`,
 * `QL_PIPELINE_AGENT_API_KEY`, `OPENAI_API_KEY`, `QL_HOUSE_API_URL`,
 * `QL_AUTH_URL`, `QL_AUTH_CLIENT_ID`, or `QL_AUTH_CLIENT_SECRET` are set —
 * those live in GitHub Actions secrets, which a local CLI has no business
 * reading. It says so rather than implying a clean bill of health it
 * cannot give. It also never reaches house-api itself: `govern` is the only
 * thing that does, in CI, where those secrets actually live.
 */
export declare function runDoctorChecks(input: DoctorInput): CheckResult[];
export declare function worstStatus(results: readonly CheckResult[]): CheckStatus;
