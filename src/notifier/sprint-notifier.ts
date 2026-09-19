// @neuron notify.sprint.sprintNotifier
import { QlAuthClient } from '@0xb1te/ql-auth-client';
import { proxyFetchFromEnv } from '../standards/house-credentials.js';

/** Where ql-sprint is reachable. Absent means this fleet does not run one, which is not an error. */
export const SPRINT_URL_VAR = 'QL_SPRINT_URL';

/** What this run decided, in the four shapes ql-sprint's card knows how to render. */
export type SprintVerdict = 'merge' | 'awaiting-human' | 'fix' | 'block';

export interface SprintNotice {
  readonly repo: string;
  readonly prNumber: number;
  readonly verdict: SprintVerdict;
  readonly title?: string;
  readonly summary?: string;
  readonly url?: string;
  readonly attempt?: { readonly number: number; readonly of: number };
}

export type SprintNotifier = (notice: SprintNotice) => Promise<void>;

export interface SprintNotifierCredentials {
  readonly sprintUrl: string;
  readonly qlAuthUrl: string;
  readonly qlAuthClientId: string;
  readonly qlAuthClientSecret: string;
}

/**
 * Everything needed to tell ql-sprint, or undefined when this fleet has not been told about one.
 *
 * Undefined is the ordinary case for most consumers and deliberately not an error: a repository
 * can be governed perfectly well by a fleet that runs no ql-sprint at all, and failing a
 * governance run because nobody is listening in Telegram would be absurd. It reuses the ql-auth
 * credentials the standards hop already needs, so a fleet that has those and publishes ql-sprint
 * only has to add `QL_SPRINT_URL`.
 */
// @signal sprintNotifierCredentialsFromEnv
export function sprintNotifierCredentialsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SprintNotifierCredentials | undefined {
  const sprintUrl = present(env[SPRINT_URL_VAR]);
  const qlAuthUrl = present(env['QL_AUTH_URL']);
  const qlAuthClientId = present(env['QL_AUTH_CLIENT_ID']);
  const qlAuthClientSecret = present(env['QL_AUTH_CLIENT_SECRET']);
  if (
    sprintUrl === undefined ||
    qlAuthUrl === undefined ||
    qlAuthClientId === undefined ||
    qlAuthClientSecret === undefined
  ) {
    return undefined;
  }
  return { sprintUrl, qlAuthUrl, qlAuthClientId, qlAuthClientSecret };
}

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/**
 * Posts one verdict to ql-sprint's `POST /v1/pipeline/notify`.
 *
 * Mints its own `client_credentials` token rather than reusing the one the standards reader made.
 * The two are not always both present: `standards.enabled: false` means no standards token is
 * ever minted, and a run that still wants to say what it decided should not be prevented by that.
 * The cost is one extra token per run, against a service this fleet already calls twice.
 *
 * Two protections, neither replacing the other: the ql-proxy edge secret for the `sprint` hop
 * says who may reach the address, and this bearer token says what they may do once there.
 *
 * It throws on failure rather than swallowing. Whether a failed notification should fail the run
 * is the caller's decision, not this module's — and `govern` says no, for the same reason it
 * treats a failed thread reply as survivable: a review that already landed must not be undone by
 * the messenger.
 */
// @signal createSprintNotifier
export function createSprintNotifier(
  credentials: SprintNotifierCredentials,
  env: NodeJS.ProcessEnv = process.env,
): SprintNotifier {
  return async (notice: SprintNotice): Promise<void> => {
    const authFetch = proxyFetchFromEnv(env, 'auth');
    const auth = new QlAuthClient({
      baseUrl: credentials.qlAuthUrl,
      ...(authFetch !== undefined ? { fetch: authFetch } : {}),
    });
    const { access_token: accessToken } = await auth.issueToken({
      grantType: 'client_credentials',
      clientId: credentials.qlAuthClientId,
      clientSecret: credentials.qlAuthClientSecret,
    });

    // The sprint hop's own secret. ql-proxy gives every protected exposure one of its own, so
    // house's would be refused at this address exactly as auth's was refused at house's.
    const sprintFetch = proxyFetchFromEnv(env, 'sprint') ?? fetch;
    const response = await sprintFetch(`${trimSlash(credentials.sprintUrl)}/v1/pipeline/notify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(notice),
    });

    if (!response.ok) {
      throw new Error(`ql-sprint refused the notice with status ${String(response.status)}`);
    }
  };
}

function trimSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
