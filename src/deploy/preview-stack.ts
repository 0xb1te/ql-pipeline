// @neuron deploy.preview.previewStack
import type { TaskFolderLookup } from '../verdict/task-artifacts.js';
import type { PreviewEnvironmentVerdict } from '../verdict/preview-environment.js';
import { REQUIRED_TASK_ARTIFACTS } from '../verdict/task-artifacts.js';

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
// @signal decidePreviewDeploy
export function decidePreviewDeploy(input: PreviewDeployInput): PreviewDeployDecision {
  if (!input.enabled) {
    return { deploy: false, reason: 'preview.enabled is false in the pipeline config' };
  }
  if (input.isFork) {
    return { deploy: false, reason: 'the pull request comes from a fork, which never reaches the preview host' };
  }
  if (input.environment === 'not-required') {
    return { deploy: false, reason: 'this repository has no product apps, so there is no preview environment to boot' };
  }
  if (input.environment === 'invalid') {
    return { deploy: false, reason: 'the preview environment does not satisfy the contract' };
  }
  const folder = input.taskFolder;
  if (folder.kind !== 'folder') {
    return {
      deploy: false,
      reason:
        folder.kind === 'not-a-task-branch'
          ? `branch ${folder.headRef} names no task folder, so there is no seed.sql to boot the database from`
          : `no task folder matches docs/${folder.ref.kind}/${folder.ref.number}-*/, so there is no seed.sql to boot the database from`,
    };
  }
  const seed = REQUIRED_TASK_ARTIFACTS[1];
  if (!folder.files.some((file) => file.toLowerCase() === seed)) {
    return { deploy: false, reason: `${folder.path} carries no ${seed}, so the preview database would boot empty` };
  }
  return { deploy: true, reason: `${folder.path} is complete and the preview environment satisfies the contract` };
}

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
 * pull-request content and reaches the child as an argument, not through a shell. Announcing
 * is switched off, so the pipeline's summary is the only comment a preview gets.
 */
// @signal previewUpArgs
export function previewUpArgs(request: PreviewUpRequest): readonly string[] {
  return [
    'up',
    '--branch',
    request.branch,
    '--repo',
    request.repository,
    '--pr',
    String(request.pullRequest),
    '--dir',
    request.checkoutDir,
    '--ttl',
    String(request.ttlMinutes),
    // The pipeline posts its own summary - URL, token, expiry, MCP state - so ql-proxy's own
    // announce is switched off. `--pr` stays regardless: ql-proxy records the pull request on
    // the stack so teardown can resolve it by repo and number on close, which was never about
    // announcing. Needs ql-proxy 0.2.0; 0.1.0 refuses the flag as an option needing a value,
    // which is the right failure - loud, on the first preview, naming the flag.
    '--no-announce',
    // Accepted and ignored by a ql-proxy that predates the browser gate; honoured by one that
    // has it. The summary reads the listing afterwards to say which happened.
    ...(request.protect ? ['--protect'] : []),
  ];
}

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

// @signal parsePreviewUpOutput
export function parsePreviewUpOutput(stdout: string): PreviewUpOutput {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const url = [...lines].reverse().find((line) => /^https?:\/\/\S+$/.test(line)) ?? null;
  let token: string | null = null;
  for (const line of lines) {
    const match = /^(?:token|secret):\s*(\S+)$/i.exec(line);
    if (match !== null) {
      token = match[1] ?? null;
      break;
    }
  }
  return { url, token };
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The listing row whose URL is the one `up` printed, or null.
 *
 * Matched on the URL because that is the only thing `up` says. The project name, the time left
 * and whether the host actually locked it all come from here, which is why the deploy reads the
 * listing right after bringing the stack up rather than trusting what it asked for.
 */
// @signal findPreviewInListing
export function findPreviewInListing(listJson: string, url: string): PreviewListing | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(listJson);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const wanted = url.replace(/\/+$/, '');
  for (const row of parsed) {
    if (!isRecord(row)) continue;
    if (typeof row['url'] !== 'string' || row['url'].replace(/\/+$/, '') !== wanted) continue;
    if (typeof row['project'] !== 'string' || typeof row['slug'] !== 'string') continue;
    const remaining = row['minutesRemaining'];
    return {
      project: row['project'],
      slug: row['slug'],
      url: row['url'],
      minutesRemaining: typeof remaining === 'number' && Number.isFinite(remaining) ? remaining : null,
      expires: row['expires'] === true,
      protected: row['protected'] === true,
      live: row['live'] === true,
    };
  }
  return null;
}

/**
 * The internal address of the application's MCP server, from what `docker inspect` printed for
 * the service's container: the first IPv4 address on any of its networks.
 *
 * An address on the preview host's container network, reachable from the runner on that host
 * and from nowhere else. Never the preview URL: the surface behind this can manage everything
 * the application can, and the preview URL's only lock is a token meant for showing somebody a
 * demo - see ql-docs `workflow/flows/app-mcp-surface.md`.
 */
// @signal mcpEndpointFor
export function mcpEndpointFor(inspectOutput: string, port: number, path: string): string | null {
  const ip = inspectOutput
    .split(/\s+/)
    .map((token) => token.trim())
    .find((token) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(token));
  if (ip === undefined) return null;
  return `http://${ip}:${String(port)}${path}`;
}

export interface PreviewSummaryInput {
  readonly url: string;
  readonly project: string;
  readonly token: string | null;
  /** Whether the host reports the address as locked. */
  readonly protected: boolean;
  readonly minutesRemaining: number | null;
  /** ISO timestamp, computed by the caller from the listing and its clock. */
  readonly expiresAt: string | null;
  readonly mcp: { readonly endpoint: string | null; readonly ready: boolean; readonly waitedSeconds: number };
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
// @signal formatPreviewSummary
export function formatPreviewSummary(input: PreviewSummaryInput): string {
  const lines = ['## Preview', '', `**URL:** ${input.url}`, ''];

  if (input.token !== null) {
    lines.push(
      `**Access token:** \`${input.token}\` — the page asks for it once, then remembers you for this preview. ` +
        'Nothing to set by hand, no header, no curl.',
    );
  } else if (input.protected) {
    lines.push(
      '**Access:** the host locked this preview but did not hand its token to the pipeline. Read it on the ' +
        `preview host from the ql-proxy secret store for \`${input.project}\`.`,
    );
  } else {
    lines.push(
      '**Access:** this host does not gate previews with a token yet — Cloudflare Access is the only lock on this ' +
        'address. The token gate lands with ql-proxy\'s *Authenticate previews behind a browser gate page*.',
    );
  }
  lines.push('');

  if (input.minutesRemaining !== null && input.expiresAt !== null) {
    const stamp = `${input.expiresAt.slice(11, 16)} UTC`;
    lines.push(
      `Live for ${String(input.minutesRemaining)} minutes, until ${stamp}. It disappears on its own; closing this ` +
        'pull request tears it down immediately.',
    );
  } else {
    lines.push('It disappears on its own when its lifetime ends; closing this pull request tears it down immediately.');
  }
  lines.push('');

  if (input.mcp.endpoint === null) {
    lines.push(
      '**MCP:** the application MCP server could not be located in the stack, so the preview tester has nothing to ' +
        'drive — it will say so on its own check.',
    );
  } else if (input.mcp.ready) {
    lines.push(
      `**MCP:** answering on the preview host's container network after ${String(input.mcp.waitedSeconds)}s. ` +
        'It is never publicly routed; the preview tester reaches it from the same host.',
    );
  } else {
    lines.push(
      `**MCP:** located but not answering after ${String(input.mcp.waitedSeconds)}s. The preview tester will report ` +
        'it as unreachable rather than skip — a surface an agent cannot reach is a surface nobody can test.',
    );
  }

  lines.push('', `_Stack \`${input.project}\` on the preview host._`);
  return lines.join('\n');
}
