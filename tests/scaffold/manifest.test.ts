import { describe, expect, it } from 'vitest';
import { hashContent, parseManifest, serializeManifest } from '../../src/scaffold/manifest.js';

describe('hashContent', () => {
  it('is stable for identical content', () => {
    expect(hashContent('hello')).toBe(hashContent('hello'));
  });

  it('differs for different content', () => {
    expect(hashContent('hello')).not.toBe(hashContent('hello!'));
  });

  it('ignores CRLF vs LF — a git checkout is not a user edit', () => {
    expect(hashContent('a\r\nb\r\n')).toBe(hashContent('a\nb\n'));
  });
});

describe('serializeManifest / parseManifest', () => {
  it('round-trips', () => {
    const manifest = { version: '1.2.3', files: { 'a.md': hashContent('a'), 'b.md': hashContent('b') } };

    expect(parseManifest(serializeManifest(manifest))).toEqual({ ok: true, manifest });
  });

  it('sorts entries so the file does not churn between runs', () => {
    const serialized = serializeManifest({ version: '1.0.0', files: { 'z.md': 'z', 'a.md': 'a' } });

    expect(serialized.indexOf('a.md')).toBeLessThan(serialized.indexOf('z.md'));
  });

  it('ends with a newline, so it does not fight other tooling', () => {
    expect(serializeManifest({ version: '1.0.0', files: {} }).endsWith('\n')).toBe(true);
  });

  it('rejects malformed JSON', () => {
    expect(parseManifest('{nope').ok).toBe(false);
  });

  it('rejects a non-object manifest', () => {
    expect(parseManifest('[]').ok).toBe(false);
  });

  it('rejects a missing version', () => {
    expect(parseManifest('{"files":{}}').ok).toBe(false);
  });

  it('rejects a non-object files map', () => {
    expect(parseManifest('{"version":"1.0.0","files":[]}').ok).toBe(false);
  });

  it('rejects a non-string hash', () => {
    expect(parseManifest('{"version":"1.0.0","files":{"a.md":123}}').ok).toBe(false);
  });

  it('accepts an empty manifest, which is what a fresh init with no managed files looks like', () => {
    expect(parseManifest('{"version":"1.0.0","files":{}}')).toEqual({
      ok: true,
      manifest: { version: '1.0.0', files: {} },
    });
  });
});
