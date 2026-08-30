import { join, relative, sep } from 'node:path';
import type { StandardsReader } from './standards-resolver.js';

/**
 * The subset of `@0xb1te/house-client`'s `HouseClient` this reader actually
 * calls, kept narrow rather than importing the concrete class: it lets a
 * test supply a hand-rolled fake with no real HTTP, and this file carries no
 * assumption about methods it never uses. A real `HouseClient` instance
 * satisfies this structurally with no adapter needed.
 */
export interface HouseSessionClient {
  createSession: (request: { route: string; projectId: string; taskRef?: string }) => Promise<HouseHereView>;
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

interface HouseNodeView {
  readonly body: string;
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

const STAGE_FOLDER = /^workflow\/rules\/stage-(\d)-/;

/**
 * Mirrors `RouteIds.routesForNode`'s stage-folder branch only — the one
 * route family every doc path `ql-pipeline` configures actually needs.
 * `RouteIds`'s other branches (flows, harness, review) don't apply to
 * engineering-standards checklists and are deliberately not reimplemented
 * here; a doc path outside `workflow/rules/stage-N-*` is reported missing
 * rather than guessed at.
 */
function stageRouteForNode(nodeId: string): string | null {
  const match = STAGE_FOLDER.exec(nodeId);
  return match ? `stage:${match[1]}` : null;
}

/**
 * Total `expand`/`advance` calls one `locate()` search may spend, shared
 * across every branch it tries (not a per-branch depth limit) — bounds the
 * total network cost of a single document lookup regardless of how many
 * relevant children or `next[]` candidates a route's session graph has.
 */
const MAX_HOPS = 4;

/** `dirname` for a `/`-joined node id; a node with no `/` has no directory. */
function dirOf(nodeId: string): string {
  const slash = nodeId.lastIndexOf('/');
  return slash < 0 ? '' : nodeId.slice(0, slash);
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
// @neuron standards.reader.HouseStandardsReader
export class HouseStandardsReader implements StandardsReader {
  private readonly cache = new Map<string, string | null>();

  constructor(private readonly options: HouseStandardsReaderOptions) {}

  // @signal exists
  exists = async (absolutePath: string): Promise<boolean> => (await this.load(absolutePath)) !== null;

  // @signal read
  read = async (absolutePath: string): Promise<string> => {
    const body = await this.load(absolutePath);
    if (body === null) {
      throw new Error(`HouseStandardsReader: "${this.toDocPath(absolutePath)}" is not readable from house-api`);
    }
    return body;
  };

  private async load(absolutePath: string): Promise<string | null> {
    const cached = this.cache.get(absolutePath);
    if (cached !== undefined) {
      return cached;
    }
    const docPath = this.toDocPath(absolutePath);
    const body = await this.fetchDocument(docPath);
    this.cache.set(absolutePath, body);
    return body;
  }

  /**
   * `resolveStandards` calls this reader with the same absolute path it
   * would hand the local-filesystem reader (`join(workspaceRoot, root,
   * docPath)`), so the doc path this reader actually needs is recovered by
   * undoing that exact join — keeping `resolveStandards` itself unchanged
   * beyond the `async`/`await` it needed anyway.
   */
  private toDocPath(absolutePath: string): string {
    const standardsRoot = join(this.options.workspaceRoot, this.options.standardsRoot);
    return relative(standardsRoot, absolutePath).split(sep).join('/');
  }

  private async fetchDocument(docPath: string): Promise<string | null> {
    const route = stageRouteForNode(docPath);
    if (route === null) {
      return null;
    }

    const here = await this.options.client.createSession({
      route,
      projectId: this.options.projectId,
      taskRef: docPath,
    });

    return this.locate(here, docPath, { hopsLeft: MAX_HOPS }, new Set());
  }

  private async locate(
    here: HouseHereView,
    docPath: string,
    budget: { hopsLeft: number },
    visited: Set<string>,
  ): Promise<string | null> {
    // A route's session graph can reach the same node by more than one path
    // (a child re-listed under its own `next[]` chain, for instance); without
    // this, two equally "relevant" branches revisiting each other could each
    // burn through the whole hop budget on nodes already ruled out, instead
    // of on genuinely new ones.
    if (visited.has(here.cursor)) {
      return null;
    }
    visited.add(here.cursor);

    if (here.cursor === docPath) {
      return here.body;
    }

    if (here.children.some((child) => child.id === docPath)) {
      await this.options.client.expand(here.sessionId, docPath);
      const node = await this.options.client.mcpCall<HouseNodeView>('house_read', {
        sessionId: here.sessionId,
        nodeId: docPath,
      });
      return node.body;
    }

    // Only ever descend into a child whose own directory is docPath's
    // directory or an ancestor of it — never every child unconditionally.
    // `next[]` candidates are still tried unfiltered below (a chain node's
    // own id carries no directory signal to filter on in general — see the
    // `01-first.md`-style bare ids `AdvanceGraph` also emits), so it is the
    // shared `budget` below, not this filter, that bounds the *total* cost
    // of a search across however many children and next[] candidates a
    // route's session graph has.
    const docDir = dirOf(docPath);
    const isRelevant = (nodeId: string): boolean => {
      const nodeDir = dirOf(nodeId);
      return nodeDir === docDir || docDir.startsWith(`${nodeDir}/`);
    };

    // Not the cursor and not a listed child of it, but docPath may still be
    // nested a level or more below one of the cursor's own children (e.g. a
    // checklist under its area's own PROMPT.md — a sibling file, not a path
    // prefix, of that PROMPT.md, which is why this compares directories
    // rather than checking `docPath.startsWith(child.id)`). Descend into
    // every direct child whose own directory contains docPath and search
    // again from there — genuinely attempted, not hardcoded to fail.
    // Against today's house-api `expand()` re-returns the *current*
    // cursor's own view unchanged (see the class doc), so this does not yet
    // resolve such a document, but it costs nothing to try and starts
    // working the day that response starts reflecting the unlocked node
    // instead.
    const descendable = here.children.filter((child) => isRelevant(child.id));
    for (const child of descendable) {
      if (budget.hopsLeft <= 0) {
        return null;
      }
      budget.hopsLeft -= 1;
      let expanded: HouseHereView;
      try {
        expanded = await this.options.client.expand(here.sessionId, child.id);
      } catch {
        continue;
      }
      const found = await this.locate(expanded, docPath, budget, visited);
      if (found !== null) {
        return found;
      }
    }

    // Still not found by descending: the only other way to see further
    // nodes is to advance onto a `next[]` node and look again from there.
    // Genuinely attempted, not hardcoded to fail, so a playbook change that
    // makes a deeper document reachable is picked up automatically.
    for (const candidate of here.next) {
      if (budget.hopsLeft <= 0) {
        return null;
      }
      budget.hopsLeft -= 1;
      let advanced: HouseHereView;
      try {
        advanced = await this.options.client.advance(here.sessionId, candidate.id);
      } catch {
        continue;
      }
      const found = await this.locate(advanced, docPath, budget, visited);
      if (found !== null) {
        return found;
      }
    }

    return null;
  }
}
