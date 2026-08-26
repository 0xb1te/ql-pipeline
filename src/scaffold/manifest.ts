import { createHash } from 'node:crypto';

/** Where the record of what ql-pipeline wrote lives in a consumer repo. */
export const MANIFEST_PATH = '.ql-pipeline/manifest.json';

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
export function hashContent(content: string): string {
  return createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
}

export function serializeManifest(manifest: ScaffoldManifest): string {
  const files = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify({ version: manifest.version, files }, null, 2)}\n`;
}

export type ManifestParse =
  | { readonly ok: true; readonly manifest: ScaffoldManifest }
  | { readonly ok: false; readonly reason: string };

/**
 * Reads a manifest written by a previous run. A corrupt manifest is not
 * fatal — callers fall back to treating every file as "unknown origin",
 * which is the conservative reading (nothing gets overwritten silently).
 */
export function parseManifest(raw: string): ManifestParse {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (cause) {
    return { ok: false, reason: `manifest is not valid JSON: ${String(cause)}` };
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'manifest is not a JSON object' };
  }
  const record = data as Record<string, unknown>;

  const version = record['version'];
  if (typeof version !== 'string') {
    return { ok: false, reason: 'manifest "version" must be a string' };
  }

  const rawFiles = record['files'];
  if (typeof rawFiles !== 'object' || rawFiles === null || Array.isArray(rawFiles)) {
    return { ok: false, reason: 'manifest "files" must be an object' };
  }

  const files: Record<string, string> = {};
  for (const [path, hash] of Object.entries(rawFiles as Record<string, unknown>)) {
    if (typeof hash !== 'string') {
      return { ok: false, reason: `manifest entry "${path}" must map to a string hash` };
    }
    files[path] = hash;
  }

  return { ok: true, manifest: { version, files } };
}
