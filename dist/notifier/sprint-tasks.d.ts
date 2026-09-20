import type { SprintTask } from '../verdict/task-provenance.js';
import type { SprintNotifierCredentials } from './sprint-notifier.js';
/**
 * Either the tasks ql-sprint is tracking, or why this run could not find out.
 *
 * The two are kept apart on purpose. "ql-sprint returned no tasks" and "ql-sprint could not be
 * asked" collapse to the same empty array if you let them, and the second one must never be read
 * as evidence that a pull request has no task.
 */
export type SprintTaskList = {
    readonly ok: true;
    readonly tasks: readonly SprintTask[];
} | {
    readonly ok: false;
    readonly reason: string;
};
/**
 * Reads ql-sprint's `GET /v1/tasks`, so a governance run can tell whether the pull request in
 * front of it is a task somebody planned or one somebody invented.
 *
 * The same hop the notifier makes, in the other direction, and deliberately the same one: a
 * freshly minted `client_credentials` token for the route's JWT guard, and the `sprint` exposure's
 * own ql-proxy secret for the edge in front of it. A second way to reach ql-sprint would be a
 * second set of credentials to keep in step.
 *
 * Fails open, which is the whole reason it returns a result instead of throwing. Every way this
 * can fail - no network, a refused token, a 503, a body that is not the shape promised - means
 * this run does not know whether the pull request has a task. It does not mean the pull request
 * has none. The check this feeds is advisory even when it works, so an unreachable ql-sprint has
 * no business costing a review that has otherwise passed.
 */
export declare function readSprintTasks(credentials: SprintNotifierCredentials, env?: NodeJS.ProcessEnv): Promise<SprintTaskList>;
