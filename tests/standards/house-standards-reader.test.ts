import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  HouseStandardsReader,
  type HouseHereView,
  type HouseSessionClient,
} from '../../src/standards/house-standards-reader.js';

const ROOT = '/workspace';
const STANDARDS_ROOT = '.standards';
const PROJECT_ID = 'proj-123';

function here(overrides: Partial<HouseHereView> = {}): HouseHereView {
  return {
    sessionId: 'session-1',
    cursor: 'workflow/rules/stage-5-frontend/PROMPT.md',
    body: 'entry body',
    children: [],
    next: [],
    ...overrides,
  };
}

/** A minimal fake standing in for `HouseClient`, structurally compatible with it. */
function fakeClient(overrides: Partial<HouseSessionClient> = {}): HouseSessionClient {
  return {
    createSession: vi.fn(() => Promise.resolve(here())),
    expand: vi.fn(() => Promise.resolve(here())),
    advance: vi.fn(() => Promise.resolve(here())),
    // vi.fn()'s inferred type can't unify with mcpCall's own generic <T>;
    // cast at the mock boundary rather than threading a type param through
    // every call site in these tests.
    mcpCall: vi.fn(() => Promise.resolve({ body: '' })) as HouseSessionClient['mcpCall'],
    ...overrides,
  };
}

function at(docPath: string): string {
  return join(ROOT, STANDARDS_ROOT, docPath);
}

describe('HouseStandardsReader', () => {
  it('reads a document that is the session entry node itself', async () => {
    const docPath = 'workflow/rules/stage-5-frontend/checklist.md';
    const client = fakeClient({
      createSession: vi.fn(() => Promise.resolve(here({ cursor: docPath, body: '# Frontend checklist' }))),
    });
    const reader = new HouseStandardsReader({ client, workspaceRoot: ROOT, standardsRoot: STANDARDS_ROOT, projectId: PROJECT_ID });

    expect(await reader.exists(at(docPath))).toBe(true);
    expect(await reader.read(at(docPath))).toBe('# Frontend checklist');
    expect(client.createSession).toHaveBeenCalledWith({ route: 'stage:5', projectId: PROJECT_ID, taskRef: docPath });
  });

  it('expands and reads a document that is a direct child of the entry node', async () => {
    const docPath = 'workflow/rules/stage-4-backend/backend/checklist.md';
    const client = fakeClient({
      createSession: vi.fn(() => Promise.resolve(here({ children: [{ id: docPath }] }))),
      mcpCall: vi.fn(() => Promise.resolve({ body: 'BACKEND RULES' })) as HouseSessionClient['mcpCall'],
    });
    const reader = new HouseStandardsReader({ client, workspaceRoot: ROOT, standardsRoot: STANDARDS_ROOT, projectId: PROJECT_ID });

    expect(await reader.read(at(docPath))).toBe('BACKEND RULES');
    expect(client.expand).toHaveBeenCalledWith('session-1', docPath);
    expect(client.mcpCall).toHaveBeenCalledWith('house_read', { sessionId: 'session-1', nodeId: docPath });
  });

  it('descends through a next[] chain to reach a document reachable only after advancing', async () => {
    const docPath = 'workflow/rules/stage-5-frontend/02-checklist.md';
    const client = fakeClient({
      createSession: vi.fn(() => Promise.resolve(here({ next: [{ id: '01-first.md' }] }))),
      advance: vi.fn(() => Promise.resolve(here({ cursor: docPath, body: 'REACHED VIA ADVANCE' }))),
    });
    const reader = new HouseStandardsReader({ client, workspaceRoot: ROOT, standardsRoot: STANDARDS_ROOT, projectId: PROJECT_ID });

    expect(await reader.read(at(docPath))).toBe('REACHED VIA ADVANCE');
    expect(client.advance).toHaveBeenCalledWith('session-1', '01-first.md');
  });

  it('descends into a direct child that is an ancestor of the target path, and reads it once inside', async () => {
    const areaPrompt = 'workflow/rules/stage-6-tests/backend/PROMPT.md';
    const docPath = 'workflow/rules/stage-6-tests/backend/checklist.md';
    const client = fakeClient({
      createSession: vi.fn(() => Promise.resolve(here({ children: [{ id: areaPrompt }] }))),
      expand: vi.fn((sessionId: string, nodeId: string) => {
        if (nodeId === areaPrompt) {
          return Promise.resolve(here({ cursor: areaPrompt, children: [{ id: docPath }] }));
        }
        return Promise.resolve(here());
      }),
      mcpCall: vi.fn(() => Promise.resolve({ body: 'BACKEND TEST RULES' })) as HouseSessionClient['mcpCall'],
    });
    const reader = new HouseStandardsReader({ client, workspaceRoot: ROOT, standardsRoot: STANDARDS_ROOT, projectId: PROJECT_ID });

    expect(await reader.read(at(docPath))).toBe('BACKEND TEST RULES');
    expect(client.expand).toHaveBeenCalledWith('session-1', areaPrompt);
    expect(client.expand).toHaveBeenCalledWith('session-1', docPath);
  });

  it('reports missing, not a false positive, for a grandchild when expand() re-returns the parent cursor unchanged (today\'s house-api)', async () => {
    const areaPrompt = 'workflow/rules/stage-6-tests/backend/PROMPT.md';
    const docPath = 'workflow/rules/stage-6-tests/backend/checklist.md';
    const entry = here({ cursor: 'workflow/rules/stage-6-tests/PROMPT.md', children: [{ id: areaPrompt }] });
    const client = fakeClient({
      createSession: vi.fn(() => Promise.resolve(entry)),
      // Mirrors SessionService#expand: unlocks a direct child but never moves the
      // cursor or exposes that child's own children/next.
      expand: vi.fn(() => Promise.resolve(entry)),
    });
    const reader = new HouseStandardsReader({ client, workspaceRoot: ROOT, standardsRoot: STANDARDS_ROOT, projectId: PROJECT_ID });

    expect(await reader.exists(at(docPath))).toBe(false);
    expect(client.expand).toHaveBeenCalledWith('session-1', areaPrompt);
  });

  it('reports missing rather than throwing when the entry route is neither cursor nor a listed child', async () => {
    const docPath = 'workflow/rules/stage-4-backend/sql/checklist.md';
    const client = fakeClient();
    const reader = new HouseStandardsReader({ client, workspaceRoot: ROOT, standardsRoot: STANDARDS_ROOT, projectId: PROJECT_ID });

    expect(await reader.exists(at(docPath))).toBe(false);
    await expect(reader.read(at(docPath))).rejects.toThrow(/not readable/);
  });

  it('reports missing for a doc path with no stage-folder route, without calling house-api at all', async () => {
    const docPath = 'workflow/rules/unrelated-doc.md';
    const client = fakeClient();
    const reader = new HouseStandardsReader({ client, workspaceRoot: ROOT, standardsRoot: STANDARDS_ROOT, projectId: PROJECT_ID });

    expect(await reader.exists(at(docPath))).toBe(false);
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it('caches a resolved document so a second read does not call house-api again', async () => {
    const docPath = 'workflow/rules/stage-5-frontend/checklist.md';
    const client = fakeClient({
      createSession: vi.fn(() => Promise.resolve(here({ cursor: docPath, body: 'FE' }))),
    });
    const reader = new HouseStandardsReader({ client, workspaceRoot: ROOT, standardsRoot: STANDARDS_ROOT, projectId: PROJECT_ID });

    await reader.exists(at(docPath));
    await reader.read(at(docPath));

    expect(client.createSession).toHaveBeenCalledTimes(1);
  });

  it('gives up after a bounded number of hops rather than looping forever on a cyclical next[] chain', async () => {
    const docPath = 'workflow/rules/stage-5-frontend/never-there.md';
    const cyclical = here({ next: [{ id: 'loop.md' }] });
    const client = fakeClient({
      createSession: vi.fn(() => Promise.resolve(cyclical)),
      advance: vi.fn(() => Promise.resolve(cyclical)),
    });
    const reader = new HouseStandardsReader({ client, workspaceRoot: ROOT, standardsRoot: STANDARDS_ROOT, projectId: PROJECT_ID });

    expect(await reader.exists(at(docPath))).toBe(false);
    // Bounded, not exhaustive-but-finite by accident: a real infinite loop would time out the test instead.
    expect((client.advance as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThan(10);
  });
});
