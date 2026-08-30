import type { StandardsReader } from './standards-resolver.js';
/**
 * The subset of `@0xb1te/house-client`'s `HouseClient` this reader actually
 * calls, kept narrow rather than importing the concrete class: it lets a
 * test supply a hand-rolled fake with no real HTTP, and this file carries no
 * assumption about methods it never uses. A real `HouseClient` instance
 * satisfies this structurally with no adapter needed.
 */
export interface HouseSessionClient {
    createSession: (request: {
        route: string;
        projectId: string;
        taskRef?: string;
    }) => Promise<HouseHereView>;
    expand: (sessionId: string, nodeId: string) => Promise<HouseHereView>;
    advance: (sessionId: string, to: string) => Promise<HouseHereView>;
    mcpCall: <T = unknown>(name: string, args?: Record<string, unknown>) => Promise<T>;
}
export interface HouseChildRef {
    readonly id: string;
}
export interface HouseHereView {
    readonly sessionId: string;
    readonly cursor: string;
    readonly body: string;
    readonly children: readonly HouseChildRef[];
    readonly next: readonly HouseChildRef[];
}
export interface HouseStandardsReaderOptions {
    readonly client: HouseSessionClient;
    /** Same workspace root `resolveStandards` is called with. */
    readonly workspaceRoot: string;
    /** `config.root` — where a local checkout would have lived (e.g. `.standards`). */
    readonly standardsRoot: string;
    /** The minted token's own `project_id` claim — house-api rejects any other value. */
    readonly projectId: string;
}
/**
 * Reads engineering-standards documents from house-api instead of a local
 * `ql-docs` checkout. Implements the same `StandardsReader` port the
 * filesystem reader does, so `resolveStandards` never knows which one it is
 * talking to and the reviewer-facing output is unaffected by the switch.
 *
 * house-api has no "read one document by path" endpoint — only a stateful
 * session walk: `createSession` lands on a route's entry node, `expand`
 * unlocks a direct child of the cursor without moving it, and `advance`
 * moves the cursor onto a `next[]` node (gated on the current node's checks,
 * and only ever onto a numbered `CREATE-prompt.md` chain in this playbook).
 * Reading a node's body goes through the client's generic MCP passthrough
 * (`mcpCall("house_read", …)`) because the client has no typed method for
 * it — its own README documents this passthrough as the intended fallback
 * for exactly this gap.
 *
 * A fresh session is created per document rather than reused across a
 * `resolveStandards` run: `expand` never moves the cursor so sibling docs
 * under the same route are safe to share, but a doc that needs `advance`
 * would leave the session's cursor somewhere a later sibling doesn't expect.
 * ql-pipeline's usage — a handful of docs per PR — makes the extra
 * session-creates cheap next to that correctness risk.
 *
 * A doc that sits two or more levels below the route's entry node — a
 * checklist that is itself a child of its own area's `PROMPT.md`, which is
 * in turn a direct child of the entry — is genuinely unreachable through
 * today's house-api: `expand()` unlocks a direct child of the *current*
 * cursor but never moves the cursor and never returns the unlocked child's
 * own `children`/`next` (confirmed against a live instance: the returned
 * view is byte-identical to the one before the call), and `advance()` only
 * ever targets a node in the cursor's `next[]`, which house-api's
 * `AdvanceGraph` populates solely from numbered `CREATE-prompt.md` chains —
 * a plain area `PROMPT.md` node is never a member of it. `locate()` still
 * genuinely attempts to descend into every direct child that is an
 * ancestor of the target path (see below) rather than give up immediately,
 * so it starts resolving such a document with no reader-side change the day
 * house-api's `expand` response reflects the unlocked node's own view — but
 * against today's house-api this is a real, reported gap in the session
 * graph itself, not a bug in this traversal. Reported as House problem
 * `d5a75cba-3ede-4f35-afed-0f2dfdde9dcb`.
 */
export declare class HouseStandardsReader implements StandardsReader {
    private readonly options;
    private readonly cache;
    constructor(options: HouseStandardsReaderOptions);
    exists: (absolutePath: string) => Promise<boolean>;
    read: (absolutePath: string) => Promise<string>;
    private load;
    /**
     * `resolveStandards` calls this reader with the same absolute path it
     * would hand the local-filesystem reader (`join(workspaceRoot, root,
     * docPath)`), so the doc path this reader actually needs is recovered by
     * undoing that exact join — keeping `resolveStandards` itself unchanged
     * beyond the `async`/`await` it needed anyway.
     */
    private toDocPath;
    private fetchDocument;
    private locate;
}
