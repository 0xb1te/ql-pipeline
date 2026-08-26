import { hashContent, type ScaffoldManifest } from './manifest.js';

/**
 * `managed` files are ql-pipeline's to maintain — regenerated on upgrade
 * so improvements reach every repo. `owned` files belong to the consumer;
 * they are scaffolded once and never touched again, because that is where
 * their build commands and target branch live.
 */
export type FileMode = 'managed' | 'owned';

export interface TemplateFile {
  /** Path relative to the consumer repo root. */
  readonly dest: string;
  readonly mode: FileMode;
  readonly content: string;
}

export interface ExistingFile {
  readonly content: string;
}

export type ScaffoldAction =
  | { readonly kind: 'create'; readonly dest: string; readonly content: string }
  | { readonly kind: 'update'; readonly dest: string; readonly content: string }
  | { readonly kind: 'unchanged'; readonly dest: string }
  | { readonly kind: 'skip-owned'; readonly dest: string }
  | { readonly kind: 'skip-modified'; readonly dest: string }
  | { readonly kind: 'overwrite-modified'; readonly dest: string; readonly content: string };

export interface PlanInput {
  readonly templates: readonly TemplateFile[];
  /** Current contents of the consumer repo, by destination path. */
  readonly existing: ReadonlyMap<string, ExistingFile>;
  readonly manifest: ScaffoldManifest | null;
  /** Overwrite managed files the user has edited. */
  readonly force: boolean;
}

/**
 * `init` — scaffold into a repo, never clobbering anything already there.
 * A file that exists is left exactly as-is regardless of mode, so running
 * init twice is safe and running it on a partly-configured repo fills in
 * only what is missing.
 */
export function planInit(input: Pick<PlanInput, 'templates' | 'existing'>): ScaffoldAction[] {
  return input.templates.map((template) =>
    input.existing.has(template.dest)
      ? ({ kind: template.mode === 'owned' ? 'skip-owned' : 'skip-modified', dest: template.dest } as const)
      : ({ kind: 'create', dest: template.dest, content: template.content } as const),
  );
}

/**
 * `upgrade` — refresh managed files to the current version.
 *
 * The safety property that matters: a managed file the user has edited is
 * never silently overwritten. We know it was edited because its current
 * hash differs from the one recorded when we wrote it. Without a manifest
 * entry we cannot prove we wrote it, so we assume we did not.
 */
export function planUpgrade(input: PlanInput): ScaffoldAction[] {
  const actions: ScaffoldAction[] = [];

  for (const template of input.templates) {
    const existing = input.existing.get(template.dest);

    if (existing === undefined) {
      // A file added in a newer version of ql-pipeline, or one the user
      // deleted. Either way, writing it is what they asked for.
      actions.push({ kind: 'create', dest: template.dest, content: template.content });
      continue;
    }

    if (template.mode === 'owned') {
      actions.push({ kind: 'skip-owned', dest: template.dest });
      continue;
    }

    const currentHash = hashContent(existing.content);
    if (currentHash === hashContent(template.content)) {
      actions.push({ kind: 'unchanged', dest: template.dest });
      continue;
    }

    const recordedHash = input.manifest?.files[template.dest];
    const weWroteIt = recordedHash !== undefined && recordedHash === currentHash;

    if (weWroteIt) {
      actions.push({ kind: 'update', dest: template.dest, content: template.content });
    } else if (input.force) {
      actions.push({ kind: 'overwrite-modified', dest: template.dest, content: template.content });
    } else {
      actions.push({ kind: 'skip-modified', dest: template.dest });
    }
  }

  return actions;
}

/** Actions that write to disk. */
export function isWrite(
  action: ScaffoldAction,
): action is Extract<ScaffoldAction, { content: string }> {
  return action.kind === 'create' || action.kind === 'update' || action.kind === 'overwrite-modified';
}

/**
 * The manifest to record after applying a plan. Every managed file we now
 * know the content of is recorded — including ones left unchanged, so a
 * repo scaffolded before manifests existed becomes tracked on first
 * upgrade. Files skipped because the user edited them are deliberately
 * left out: recording their hash would claim authorship we do not have.
 */
export function nextManifest(
  version: string,
  templates: readonly TemplateFile[],
  actions: readonly ScaffoldAction[],
): ScaffoldManifest {
  const byDest = new Map(templates.map((template) => [template.dest, template]));
  const files: Record<string, string> = {};

  for (const action of actions) {
    const template = byDest.get(action.dest);
    if (template === undefined || template.mode !== 'managed') {
      continue;
    }
    if (isWrite(action) || action.kind === 'unchanged') {
      files[action.dest] = hashContent(template.content);
    }
  }

  return { version, files };
}
