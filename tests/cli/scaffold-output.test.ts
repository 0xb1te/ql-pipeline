import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDoctor, runInit } from '../../src/cli/scaffold-commands.js';

/**
 * These assert on console output, which is normally not worth pinning. This list is the
 * exception: it is the only place a new consumer is told which secrets to create, and it
 * is read once, before anything has ever run.
 *
 * `GH_PACKAGES_TOKEN` was missing from it. Every job installs ql-pipeline before it runs
 * anything, ql-pipeline depends on two private repositories, so without that secret the
 * run dies in the install step with a git error naming neither ql-pipeline nor the secret.
 * The first real consumer onboarding followed this list exactly and failed that way.
 */
describe('the secrets a consumer is told to create', () => {
  let root: string;
  let logged: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ql-pipeline-scaffold-output-'));
    logged = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('init names every secret the pipeline needs, GH_PACKAGES_TOKEN included', () => {
    runInit(root);

    const output = logged.join('\n');
    for (const secret of [
      'GH_PACKAGES_TOKEN',
      'CURSOR_API_KEY',
      'QL_HOUSE_API_URL',
      'QL_AUTH_URL',
      'QL_AUTH_CLIENT_ID',
      'QL_AUTH_CLIENT_SECRET',
    ]) {
      expect(output, `init should name ${secret}`).toContain(secret);
    }
  });

  it('init explains that GH_PACKAGES_TOKEN gates every job, not just the review', () => {
    runInit(root);

    const output = logged.join('\n');
    expect(output).toContain('0xb1te/ql-docs');
    expect(output).toContain('0xb1te/ql-auth');
    // The whole point of naming it first: its absence is not a degraded review, it is no run.
    expect(output).toMatch(/every job/i);
  });

  it('doctor names the same set as unverifiable rather than implying a clean bill', async () => {
    runInit(root);
    logged.length = 0;

    await runDoctor(root);

    const output = logged.join('\n');
    const notCheckable = output.slice(output.indexOf('Not checkable from here'));
    for (const secret of [
      'GH_PACKAGES_TOKEN',
      'CURSOR_API_KEY',
      'QL_HOUSE_API_URL',
      'QL_AUTH_URL',
      'QL_AUTH_CLIENT_ID',
      'QL_AUTH_CLIENT_SECRET',
    ]) {
      expect(notCheckable, `doctor should name ${secret}`).toContain(secret);
    }
  });
});
