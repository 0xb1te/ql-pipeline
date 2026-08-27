import { hashContent } from './manifest.js';
/**
 * `init` — scaffold into a repo, never clobbering anything already there.
 * A file that exists is left exactly as-is regardless of mode, so running
 * init twice is safe and running it on a partly-configured repo fills in
 * only what is missing.
 */
export function planInit(input) {
    return input.templates.map((template) => input.existing.has(template.dest)
        ? { kind: template.mode === 'owned' ? 'skip-owned' : 'skip-modified', dest: template.dest }
        : { kind: 'create', dest: template.dest, content: template.content });
}
/**
 * `upgrade` — refresh managed files to the current version.
 *
 * The safety property that matters: a managed file the user has edited is
 * never silently overwritten. We know it was edited because its current
 * hash differs from the one recorded when we wrote it. Without a manifest
 * entry we cannot prove we wrote it, so we assume we did not.
 */
export function planUpgrade(input) {
    const actions = [];
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
        }
        else if (input.force) {
            actions.push({ kind: 'overwrite-modified', dest: template.dest, content: template.content });
        }
        else {
            actions.push({ kind: 'skip-modified', dest: template.dest });
        }
    }
    return actions;
}
/** Actions that write to disk. */
export function isWrite(action) {
    return action.kind === 'create' || action.kind === 'update' || action.kind === 'overwrite-modified';
}
/**
 * The manifest to record after applying a plan. Every managed file we now
 * know the content of is recorded — including ones left unchanged, so a
 * repo scaffolded before manifests existed becomes tracked on first
 * upgrade. Files skipped because the user edited them are deliberately
 * left out: recording their hash would claim authorship we do not have.
 */
export function nextManifest(version, templates, actions) {
    const byDest = new Map(templates.map((template) => [template.dest, template]));
    const files = {};
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
//# sourceMappingURL=plan.js.map