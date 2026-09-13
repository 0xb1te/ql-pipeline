import { type AgentProvider, type GateOutcome } from '../shared/types.js';
/** Auto-fix still requires cursor-agent. An OpenAI-compatible review cannot write a fix commit. */
export declare function shouldSkipCursorFixer(provider: AgentProvider): boolean;
/**
 * Collects the reports the gate jobs left behind. A report that is present
 * but unreadable is fatal: the pipeline would otherwise merge a PR while
 * genuinely not knowing whether its tests passed.
 */
export declare function readGateReports(reportsDir: string, reader?: {
    exists: (p: string) => boolean;
    list: (p: string) => string[];
    read: (p: string) => string;
}): {
    ok: true;
    outcomes: GateOutcome[];
} | {
    ok: false;
    reason: string;
};
/**
 * The pipeline check: everything after the gates. Runs even when a gate
 * job failed, because a broken build is a finding the fix agent can repair
 * — halting the chain on a red gate would throw that away.
 */
export declare function runGovern(reportsDir: string): Promise<void>;
