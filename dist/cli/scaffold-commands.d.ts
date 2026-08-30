import { type TemplateFile } from '../scaffold/plan.js';
/** The full set of files ql-pipeline scaffolds, discovered from the shipped templates. */
export declare function loadTemplates(): TemplateFile[];
/** Appends `.standards/` to .gitignore if absent. Never rewrites the file. */
export declare function ensureStandardsIgnored(root: string): 'added' | 'already-present';
export declare function runInit(root: string): void;
export declare function runUpgrade(root: string, force: boolean): void;
/** Returns true when nothing failed, so the caller can set the exit code. */
export declare function runDoctor(root: string): Promise<boolean>;
