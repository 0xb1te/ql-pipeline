/** Where the record of what ql-pipeline wrote lives in a consumer repo. */
export declare const MANIFEST_PATH = ".ql-pipeline/manifest.json";
export interface ScaffoldManifest {
    /** The ql-pipeline version that last wrote these files. */
    readonly version: string;
    /** Destination path → hash of the content written, for drift detection. */
    readonly files: Readonly<Record<string, string>>;
}
/**
 * Content hash used to tell "unchanged since we wrote it" from "the user
 * edited this". Line endings are normalised first: git checkouts on
 * Windows routinely rewrite LF to CRLF, and a file is not *edited* just
 * because it arrived with different line endings.
 */
export declare function hashContent(content: string): string;
export declare function serializeManifest(manifest: ScaffoldManifest): string;
export type ManifestParse = {
    readonly ok: true;
    readonly manifest: ScaffoldManifest;
} | {
    readonly ok: false;
    readonly reason: string;
};
/**
 * Reads a manifest written by a previous run. A corrupt manifest is not
 * fatal — callers fall back to treating every file as "unknown origin",
 * which is the conservative reading (nothing gets overwritten silently).
 */
export declare function parseManifest(raw: string): ManifestParse;
