import type { TaskFolderLookup } from '../verdict/task-artifacts.js';
import type { PreviewEnvironmentVerdict } from '../verdict/preview-environment.js';
/**
 * The pure half of bringing a pull request preview up: what to ask ql-proxy, how to read what it
 * answered, where the application's MCP server is once the stack exists, and what the pull
 * request is told. Nothing here runs a process or opens a socket; the command does that and hands
 * the text back in.
 */
/** What the preview job needs to decide to run at all. Every input is a fact `govern` already has. */
export interface PreviewDeployInput {
    readonly enabled: boolean;
    readonly environment: PreviewEnvironmentVerdict['kind'];
    readonly taskFolder: TaskFolderLookup;
    readonly isFork: boolean;
}
export interface PreviewDeployDecision {
    readonly deploy: boolean;
    readonly reason: string;
}
/**
 * Whether a green verdict is followed by a preview.
 *
 * Decided on the verdict alone, not on whether the review had anything to say. Advisory findings
 * never block a merge, so they must not block the preview either - the preview is what lets the
 * person making the merge call judge them. What does gate it is whether a stack can exist: the
 * repository has opted in, its devops folder satisfies the contract, the branch names a task
 * folder carrying the seed the database boots from, and the head is not a fork. A fork's
 * workflow content is attacker-controlled and the preview host is a real machine; the job has
 * its own guard, but a flag that says "deploy" for a fork is a flag somebody will trust one day.
 */
export declare function decidePreviewDeploy(input: PreviewDeployInput): PreviewDeployDecision;
export interface PreviewUpRequest {
    readonly branch: string;
    readonly repository: string;
    readonly pullRequest: number;
    /** The devops folder, absolute. The build root is that folder, not the repository. */
    readonly checkoutDir: string;
    readonly ttlMinutes: number;
    readonly protect: boolean;
}
/**
 * The argument vector for `ql-proxy up`. A vector and never a string: the branch name is
 * pull-request content and reaches the child as an argument, not through a shell.
 */
export declare function previewUpArgs(request: PreviewUpRequest): readonly string[];
export interface PreviewUpOutput {
    readonly url: string | null;
    /**
     * The gate token, when ql-proxy printed one. The contract this reads is a stdout line of the
     * form `token: <value>`, after the URL - the shape ql-proxy's `expose --protect` announces a
     * fresh secret in. A ql-proxy that protects previews but prints nothing leaves this null, and
     * the summary says so rather than inventing an address that is locked with no key.
     */
    readonly token: string | null;
}
export declare function parsePreviewUpOutput(stdout: string): PreviewUpOutput;
/** The row `ql-proxy list --json` reports for one stack, as much of it as the summary reads. */
export interface PreviewListing {
    readonly project: string;
    readonly slug: string;
    readonly url: string;
    readonly minutesRemaining: number | null;
    readonly expires: boolean;
    readonly protected: boolean;
    readonly live: boolean;
}
/**
 * The listing row whose URL is the one `up` printed, or null.
 *
 * Matched on the URL because that is the only thing `up` says. The project name, the time left
 * and whether the host actually locked it all come from here, which is why the deploy reads the
 * listing right after bringing the stack up rather than trusting what it asked for.
 */
export declare function findPreviewInListing(listJson: string, url: string): PreviewListing | null;
/**
 * The internal address of the application's MCP server, from what `docker inspect` printed for
 * the service's container: the first IPv4 address on any of its networks.
 *
 * An address on the preview host's container network, reachable from the runner on that host
 * and from nowhere else. Never the preview URL: the surface behind this can manage everything
 * the application can, and the preview URL's only lock is a token meant for showing somebody a
 * demo - see ql-docs `workflow/flows/app-mcp-surface.md`.
 */
export declare function mcpEndpointFor(inspectOutput: string, port: number, path: string): string | null;
export interface PreviewSummaryInput {
    readonly url: string;
    readonly project: string;
    readonly token: string | null;
    /** Whether the host reports the address as locked. */
    readonly protected: boolean;
    readonly minutesRemaining: number | null;
    /** ISO timestamp, computed by the caller from the listing and its clock. */
    readonly expiresAt: string | null;
    readonly mcp: {
        readonly endpoint: string | null;
        readonly ready: boolean;
        readonly waitedSeconds: number;
    };
}
/**
 * The one comment the deploy posts: where to look, how to get in, and when it goes away.
 *
 * The token is printed in the clear, on purpose. It opens a demo of an unmerged branch on a
 * throwaway stack and nothing else; the surface that could do harm - MCP - has no public route.
 * A reviewer who has to fetch a secret from somewhere else to open a preview does not open it.
 *
 * Three access states are told apart rather than blurred into one sentence, because they call
 * for different actions: locked with a token to paste; locked by the host but with no token
 * handed over; and not locked at all, which on today's ql-proxy is the ordinary case until the
 * browser gate lands and is said plainly so nobody believes the address is gated when it is not.
 */
export declare function formatPreviewSummary(input: PreviewSummaryInput): string;
