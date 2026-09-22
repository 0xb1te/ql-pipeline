import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  complaintReview,
  previewEnvironmentFindings,
  previewEnvironmentRefusal,
  protectedPathsComment,
  readGateReports,
  shouldSkipCursorFixer,
  taskArtifactFindings,
  taskProvenanceFindings,
} from '../../src/cli/govern-command.js';
import type { Finding } from '../../src/shared/types.js';
import { serializeGateReport } from '../../src/shared/gate-report.js';

function reader(files: Record<string, string>): {
  exists: (p: string) => boolean;
  list: (p: string) => string[];
  read: (p: string) => string;
} {
  return {
    exists: vi.fn(() => true),
    list: vi.fn(() => Object.keys(files)),
    read: vi.fn((path: string) => {
      const name = path.split(/[\\/]/).pop()!;
      const content = files[name];
      if (content === undefined) {
        throw new Error(`no such file: ${path}`);
      }
      return content;
    }),
  };
}

const TEST_REPORT = serializeGateReport({
  stage: 'test',
  outcomes: [{ area: 'backend', gate: 'test', command: 'npm test', passed: true, output: '' }],
});
const BUILD_REPORT = serializeGateReport({
  stage: 'build',
  outcomes: [{ area: 'backend', gate: 'build', command: 'npm run build', passed: false, output: 'tsc error' }],
});

describe('shouldSkipCursorFixer', () => {
  it('lets the Cursor fixer run when the review provider is cursor', () => {
    expect(shouldSkipCursorFixer('cursor')).toBe(false);
  });

  it('escalates a FIX after an openai_compatible review instead of pretending HTTP can write a fix', () => {
    expect(shouldSkipCursorFixer('openai_compatible')).toBe(true);
  });
});

describe('readGateReports', () => {
  it('reads and merges every stage report, test before build', () => {
    const result = readGateReports('/reports', reader({ 'test.json': TEST_REPORT, 'build.json': BUILD_REPORT }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcomes.map((outcome) => outcome.gate)).toEqual(['test', 'build']);
    }
  });

  it('treats a missing reports directory as "no stage reported"', () => {
    const missing = { exists: vi.fn(() => false), list: vi.fn(() => []), read: vi.fn(() => '') };

    expect(readGateReports('/reports', missing)).toEqual({ ok: true, outcomes: [] });
  });

  it('handles a skipped stage: one report present, the other absent', () => {
    const result = readGateReports('/reports', reader({ 'test.json': TEST_REPORT }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      // A skipped build reports nothing, which is not the same as passing —
      // no build finding is invented either way.
      expect(result.outcomes).toHaveLength(1);
      expect(result.outcomes[0]?.gate).toBe('test');
    }
  });

  it('ignores non-JSON files in the artifact directory', () => {
    const result = readGateReports('/reports', reader({ 'test.json': TEST_REPORT, 'README.txt': 'ignore me' }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcomes).toHaveLength(1);
    }
  });

  it('fails closed on a corrupt report rather than assuming the gates passed', () => {
    const result = readGateReports('/reports', reader({ 'test.json': '{corrupt' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('test.json');
    }
  });
});

describe('taskProvenanceFindings', () => {
  const SPRINT_ENV = {
    QL_SPRINT_URL: 'https://sprint.example.com',
    QL_AUTH_URL: 'https://auth.example.com',
    QL_AUTH_CLIENT_ID: 'client-id',
    QL_AUTH_CLIENT_SECRET: 'client-secret',
  };
  const PAGE_ID = '2a7f3c19-4d5e-4f60-9b21-0c8e5a6d7b41';
  const PR = { number: 44, headRef: 'bugfixes/077-a-comment-cancels-the-verdict' };

  type LogFn = (message: string, context?: Record<string, unknown>) => void;

  function logger(): { info: Mock<LogFn>; warn: Mock<LogFn> } {
    return { info: vi.fn<LogFn>(), warn: vi.fn<LogFn>() };
  }

  it('says nothing at all when this fleet runs no ql-sprint', async () => {
    // Not even a warning: a repository governed by a fleet with no orchestrator has no sprint
    // board to be missing from, exactly as it has no Telegram to be notified in.
    const log = logger();
    const read = vi.fn();

    await expect(taskProvenanceFindings(PR, log, {}, read)).resolves.toEqual([]);
    expect(read).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('raises one advisory finding when ql-sprint knows nothing about this PR', async () => {
    const log = logger();
    const read = vi.fn(() => Promise.resolve({ ok: true as const, tasks: [] }));

    const findings = await taskProvenanceFindings(PR, log, SPRINT_ENV, read);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'should', rule: 'task#provenance', autoFixable: false });
  });

  it('raises nothing when ql-sprint owns this PR', async () => {
    const log = logger();
    const read = vi.fn(() =>
      Promise.resolve({ ok: true as const, tasks: [{ id: PAGE_ID, branch: null, prNumber: 44 }] }),
    );

    await expect(taskProvenanceFindings(PR, log, SPRINT_ENV, read)).resolves.toEqual([]);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining(PAGE_ID));
  });

  it('does not call a PR taskless because ql-sprint could not be reached', async () => {
    // Absence of evidence is not evidence. An outage that posted "nobody asked for this" on a
    // pull request would be worse than saying nothing.
    const log = logger();
    const read = vi.fn(() => Promise.resolve({ ok: false as const, reason: 'ECONNREFUSED' }));

    await expect(taskProvenanceFindings(PR, log, SPRINT_ENV, read)).resolves.toEqual([]);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });

  it('never raises a blocking finding, whatever the answer', async () => {
    const read = vi.fn(() => Promise.resolve({ ok: true as const, tasks: [] }));

    const findings = await taskProvenanceFindings(PR, logger(), SPRINT_ENV, read);

    expect(findings.every((finding) => finding.severity === 'should')).toBe(true);
  });
});

function blockingFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: 'must',
    rule: 'backend.rules#no-any',
    file: 'src/api/payments.ts',
    line: 12,
    problem: 'an any leaks through the boundary',
    suggestedFix: 'name the type',
    autoFixable: true,
    ...overrides,
  };
}

describe('complaintReview', () => {
  it('never sends a finding GitHub would refuse a comment on', () => {
    // The defect this exists for. A failed *required* gate is a `must` finding on the pseudo-path
    // `(gate)`, and the blocking path posted it as an inline comment - a 422 that threw out of
    // requestChangesWithComments and killed the review that was reporting the gate failure. The
    // filter existed; only the approval path used it.
    const review = complaintReview(
      [
        blockingFinding({ rule: 'gate#backend-test', file: '(gate)', line: 1 }),
        blockingFinding(),
      ],
      1,
      3,
    );

    expect(review.comments.map((comment) => comment.path)).toEqual(['src/api/payments.ts']);
  });

  it('reports in the body exactly what it kept out of the comments', () => {
    // Filtering alone would have been a worse bug than the 422: a blocking review posts one
    // message, so a finding in neither place is one the pull request never mentions.
    const review = complaintReview(
      [blockingFinding({ rule: 'gate#backend-test', file: '(gate)', problem: '3 tests failing' })],
      1,
      3,
    );

    expect(review.comments).toEqual([]);
    expect(review.summary).toContain('gate#backend-test');
    expect(review.summary).toContain('3 tests failing');
  });

  it('leaves an ordinary review untouched', () => {
    const review = complaintReview([blockingFinding()], 2, 3);

    expect(review.comments).toHaveLength(1);
    expect(review.summary).toContain('found 1 issue(s)');
    expect(review.summary).not.toContain('About this pull request rather than a line in it');
  });

  it('survives a review in which nothing can be commented on at all', () => {
    const review = complaintReview(
      [blockingFinding({ file: '(gate)' }), blockingFinding({ severity: 'should', file: '(task)' })],
      3,
      3,
    );

    expect(review.comments).toEqual([]);
    expect(review.summary).toContain('found 2 issue(s)');
    expect(review.summary).toContain('needs a human');
  });
});

describe('complaintReview with advisory findings', () => {
  function advisoryFinding(overrides: Partial<Finding> = {}): Finding {
    return {
      severity: 'should',
      rule: 'frontend.rules#prefer-composition',
      file: 'src/components/Widget.tsx',
      line: 7,
      problem: 'consider composition here',
      suggestedFix: null,
      autoFixable: false,
      ...overrides,
    };
  }

  it('reports them, because nothing else on a blocking verdict does', () => {
    // executeMergeDecision posts advisory findings, and it is only called on MERGE. On FIX and
    // BLOCK they had nowhere to go at all.
    const review = complaintReview([blockingFinding()], 1, 3, [advisoryFinding()]);

    expect(review.comments.map((comment) => comment.path)).toEqual([
      'src/api/payments.ts',
      'src/components/Widget.tsx',
    ]);
  });

  it('counts them apart, so "must be resolved" stays literally true', () => {
    const review = complaintReview([blockingFinding()], 1, 3, [advisoryFinding(), advisoryFinding()]);

    expect(review.summary).toContain('found 1 issue(s) that must be resolved');
    expect(review.summary).toContain('2 further finding(s) are advisory and do not block');
  });

  it('says nothing about advisories when there are none', () => {
    const review = complaintReview([blockingFinding()], 1, 3, []);

    expect(review.summary).not.toContain('advisory');
    expect(review.summary).toBe(complaintReview([blockingFinding()], 1, 3).summary);
  });

  it('puts an advisory finding with nowhere to point in the body, like any other', () => {
    const review = complaintReview([blockingFinding()], 1, 3, [
      advisoryFinding({ rule: 'task#provenance', file: '(task)', problem: 'no task answers for this PR' }),
    ]);

    expect(review.comments).toHaveLength(1);
    expect(review.summary).toContain('no task answers for this PR');
    expect(review.summary).toContain('About this pull request rather than a line in it');
  });
});

describe('taskArtifactFindings', () => {
  const quiet = { info: vi.fn() };

  function repo(files: readonly string[] | null): string {
    // A real directory, because this reads the filesystem the way CI does.
    const root = mkdtempSync(join(tmpdir(), 'ql-artifacts-'));
    if (files !== null) {
      const folder = join(root, 'docs', 'features', '007-statistics-dashboard');
      mkdirSync(folder, { recursive: true });
      for (const name of files) writeFileSync(join(folder, name), '');
    }
    return root;
  }

  const OPTED_IN = ['build', 'test', 'ai-review', 'task-artifacts'] as const;

  it('raises nothing when the folder carries both artifacts', () => {
    const root = repo(['index.md', 'plan.md', 'testing-plan.xlsx', 'seed.sql']);
    expect(taskArtifactFindings({ headRef: 'features/007-statistics-dashboard' }, root, OPTED_IN, quiet)).toEqual([]);
  });

  it('raises one finding naming what is missing', () => {
    const root = repo(['index.md', 'plan.md']);
    const [finding] = taskArtifactFindings({ headRef: 'features/007-statistics-dashboard' }, root, OPTED_IN, quiet);
    expect(finding?.severity).toBe('must');
    expect(finding?.problem).toContain('testing-plan.xlsx');
    expect(finding?.problem).toContain('seed.sql');
  });

  it('resolves a branch ql-sprint suffixed with a task id', () => {
    const root = repo(['index.md', 'testing-plan.xlsx', 'seed.sql']);
    expect(taskArtifactFindings({ headRef: 'features/007-statistics-dashboard-a1b2c3' }, root, OPTED_IN, quiet)).toEqual([]);
  });

  it('says nothing about a branch that names no task folder', () => {
    expect(taskArtifactFindings({ headRef: 'dependabot/npm/lodash' }, repo(null), OPTED_IN, quiet)).toEqual([]);
  });

  it('reports a task folder that does not exist at all', () => {
    const [finding] = taskArtifactFindings({ headRef: 'hotfixes/003-checkout' }, repo(null), OPTED_IN, quiet);
    expect(finding?.problem).toContain('docs/hotfixes/003-*/');
  });
});

describe('previewEnvironmentFindings', () => {
  const quiet = { info: vi.fn() };
  const HOUSE_PATHS = { frontend: ['apps/*frontend*/**'], backend: ['apps/*backend*/**'] } as const;

  const VALID_COMPOSE = 'services:\n  edge:\n    image: nginx\n  backend:\n    image: app\n';

  function repo(layout: {
    readonly apps?: readonly string[];
    readonly compose?: string;
    readonly envExample?: boolean;
  }): string {
    // A real directory, because this reads the filesystem the way CI does.
    const root = mkdtempSync(join(tmpdir(), 'ql-preview-env-'));
    for (const app of layout.apps ?? []) mkdirSync(join(root, 'apps', app), { recursive: true });
    if (layout.compose !== undefined || layout.envExample) {
      const devops = join(root, 'infrastructure', 'docker', 'environments', 'devops');
      mkdirSync(devops, { recursive: true });
      if (layout.compose !== undefined) writeFileSync(join(devops, 'docker-compose.yml'), layout.compose);
      if (layout.envExample) writeFileSync(join(devops, 'env.example'), 'DATABASE_URL=postgres://preview\n');
    }
    return root;
  }

  it('raises nothing for a repository with no product apps, whatever else it lacks', () => {
    // ql-pipeline itself: no apps/ directory, no devops folder, and unaffected.
    expect(previewEnvironmentFindings(repo({}), HOUSE_PATHS, quiet)).toEqual([]);
  });

  it('raises nothing for a product repository whose devops folder follows the contract', () => {
    const root = repo({ apps: ['shop-backend'], compose: VALID_COMPOSE, envExample: true });
    expect(previewEnvironmentFindings(root, HOUSE_PATHS, quiet)).toEqual([]);
  });

  it('raises one blocking finding for a product repository with no devops folder, citing the contract', () => {
    const [finding] = previewEnvironmentFindings(repo({ apps: ['shop-backend'] }), HOUSE_PATHS, quiet);

    expect(finding?.severity).toBe('must');
    expect(finding?.problem).toContain('infrastructure/docker/environments/devops/docker-compose.yml');
    expect(finding?.problem).toContain('stage-8-deployment');
  });

  it('raises one finding carrying every violation of a malformed folder', () => {
    const publishing = 'services:\n  app:\n    image: x\n    ports:\n      - "80:80"\n';
    const [finding] = previewEnvironmentFindings(
      repo({ apps: ['admin-frontend'], compose: publishing, envExample: false }),
      HOUSE_PATHS,
      quiet,
    );

    expect(finding?.problem).toContain('no service named `edge`');
    expect(finding?.problem).toContain('publishes host ports');
    expect(finding?.problem).toContain('env.example');
  });
});

describe('previewEnvironmentRefusal', () => {
  it('says the PR fails before review, carries the finding, and explains why nothing downstream can run', () => {
    const finding: Finding = {
      severity: 'must',
      rule: 'preview#environment',
      file: 'infrastructure/docker/environments/devops/docker-compose.yml',
      line: 1,
      problem: 'the compose file is missing',
      suggestedFix: null,
      autoFixable: false,
    };

    const body = previewEnvironmentRefusal([finding]);

    expect(body).toContain('fails before review');
    expect(body).toContain('the compose file is missing');
    expect(body).toContain('nothing to bring up');
    expect(body).toContain('RULES.md R4');
  });
});

describe('protectedPathsComment', () => {
  function missing(): Finding {
    return {
      severity: 'must',
      rule: 'task#artifacts',
      file: '(task)',
      line: 1,
      problem: '`docs/features/007-x` is missing 1 required artifact: `seed.sql`',
      suggestedFix: null,
      autoFixable: false,
    };
  }

  it('is just the R4 sentence when the task folder is complete', () => {
    const body = protectedPathsComment([]);
    expect(body).toContain('RULES.md R4');
    expect(body).not.toContain('Also worth seeing');
  });

  it('carries a structural finding the escalation would otherwise swallow', () => {
    // The reason the check moved ahead of R4: this escalation returns before the review,
    // the gates and the verdict, so anything it leaves out is reported nowhere at all.
    const body = protectedPathsComment([missing()]);
    expect(body).toContain('RULES.md R4');
    expect(body).toContain('seed.sql');
    expect(body).toContain('stops before the review');
  });

  it('carries every finding, not just the first', () => {
    const second = { ...missing(), problem: 'second problem' };
    const body = protectedPathsComment([missing(), second]);
    expect(body).toContain('seed.sql');
    expect(body).toContain('second problem');
  });
});
