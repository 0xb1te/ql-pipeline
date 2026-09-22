import type { AreaPathsConfig, Finding } from '../shared/types.js';
/**
 * Where an application repository keeps the compose stack a pull request preview boots from.
 *
 * Fixed, not configured. ql-docs' preview environment contract names this one folder so that
 * ql-proxy can bring it up and this pipeline can check it without either side asking the other
 * where to look. A configurable path would be a second source of truth for something the contract
 * already states, and the two would disagree exactly when somebody was in a hurry.
 */
export declare const PREVIEW_ENVIRONMENT_DIR = "infrastructure/docker/environments/devops";
export declare const PREVIEW_COMPOSE_FILE = "infrastructure/docker/environments/devops/docker-compose.yml";
export declare const PREVIEW_ENV_EXAMPLE = "infrastructure/docker/environments/devops/env.example";
/** The one HTTP entry service the contract allows, and the name it must carry. */
export declare const PREVIEW_EDGE_SERVICE = "edge";
/**
 * Where the rules live. Cited by every message here and restated by none of them: this pipeline
 * enforces the contract, ql-proxy builds against it, and the node is the only place it is written.
 * The node absorbs `14-preview-database-seeding`, which is why it is named by its stage folder and
 * title rather than by a number that ql-docs settles.
 */
export declare const PREVIEW_CONTRACT_NODE: string;
/** What the caller found on disk, so the checks below are answerable without a filesystem. */
export interface PreviewEnvironmentSnapshot {
    /** Top-level entries under `apps/`, as `apps/<name>`. Empty when there is no `apps/` directory. */
    readonly appDirs: readonly string[];
    /** The devops compose file's text, or null when it does not exist. */
    readonly composeText: string | null;
    readonly envExamplePresent: boolean;
}
export type PreviewEnvironmentVerdict = 
/** No `apps/*frontend*` or `apps/*backend*` directory: the contract does not apply. */
{
    readonly kind: 'not-required';
} | {
    readonly kind: 'valid';
} | {
    readonly kind: 'invalid';
    readonly violations: readonly string[];
};
/**
 * Whether the contract applies to this repository at all.
 *
 * Keyed off the same area-path globs the router uses to detect frontend and backend work, rather
 * than a second list of directory names, so a repository that has told the pipeline where its
 * apps live is measured against that and not against a convention it may not follow. A
 * repository with no matching directory - this one, a docs repository, a library - is unaffected.
 */
export declare function requiresPreviewEnvironment(appDirs: readonly string[], areaPaths: AreaPathsConfig): boolean;
/**
 * Every way the devops folder fails the contract, as sentences an author can act on.
 *
 * Cheap and structural by design: the compose file is parsed, never run. Whether the stack
 * actually boots is the deploy job's question, and answering it here would mean Docker in a
 * governance job. What can be read off the file is read: exactly one entry service named `edge`,
 * no published host ports anywhere, and an `env.example` the stack can boot from unedited.
 *
 * A missing compose file is reported alone. When the folder is absent everything in it is absent
 * too, and three sentences about one missing directory read as three problems.
 */
export declare function previewEnvironmentViolations(snapshot: PreviewEnvironmentSnapshot): readonly string[];
export declare function assessPreviewEnvironment(snapshot: PreviewEnvironmentSnapshot, areaPaths: AreaPathsConfig): PreviewEnvironmentVerdict;
/**
 * The finding a repository earns for failing the contract, or null when it does not apply or is
 * satisfied.
 *
 * `must`, always, and with no opt-in: unlike a task folder's artifacts this is not a standard
 * arriving on every repository at once. It applies only where `apps/*frontend*` or
 * `apps/*backend*` exists, which is the set of repositories that have a product to preview, and
 * a product repository with no preview stack cannot be tested by anything downstream of this
 * check - the deploy job has nothing to bring up and the tester nothing to reach.
 *
 * autoFixable is false. A fix agent cannot invent a deployment topology, and an attempt spent
 * discovering that is an attempt the real findings needed.
 */
export declare function previewEnvironmentFinding(verdict: PreviewEnvironmentVerdict): Finding | null;
/** The file-system reads the pure checks above are fed with, injectable so a test needs no disk. */
export interface SnapshotReader {
    readonly exists: (path: string) => boolean;
    readonly listDirs: (path: string) => readonly string[];
    readonly read: (path: string) => string;
}
/**
 * Reads what the checks need off a checkout, and nothing more: the names under `apps/`, the
 * devops compose text, and whether `env.example` is beside it.
 *
 * The one signal in this unit that touches a disk. It is kept here rather than in each caller
 * because `govern` and `doctor` both ask the question, and two readers of one folder is how they
 * come to disagree about it.
 */
export declare function readPreviewEnvironmentSnapshot(root: string, reader?: SnapshotReader): PreviewEnvironmentSnapshot;
