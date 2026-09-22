import { describe, expect, it, vi } from 'vitest';
import {
  assessPreviewEnvironment,
  previewEnvironmentFinding,
  previewEnvironmentViolations,
  readPreviewEnvironmentSnapshot,
  requiresPreviewEnvironment,
  PREVIEW_COMPOSE_FILE,
  PREVIEW_CONTRACT_NODE,
  PREVIEW_ENV_EXAMPLE,
  type PreviewEnvironmentSnapshot,
} from '../../src/verdict/preview-environment.js';
import type { AreaPathsConfig } from '../../src/shared/types.js';

const HOUSE_PATHS: AreaPathsConfig = {
  frontend: ['apps/*frontend*/**'],
  backend: ['apps/*backend*/**'],
};

/** A compose file that satisfies every structural rule of the contract. */
const VALID_COMPOSE = `
services:
  edge:
    image: nginx:1.27-alpine
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
  backend:
    build:
      context: ../../../..
      dockerfile: apps/shop-backend/Dockerfile
    environment:
      QL_MCP_ENABLED: "true"
  db:
    image: postgres:16
    volumes:
      - ../../../../docs/\${QL_TASK_FOLDER}/seed.sql:/docker-entrypoint-initdb.d/10-seed.sql:ro
`;

function snapshot(overrides: Partial<PreviewEnvironmentSnapshot> = {}): PreviewEnvironmentSnapshot {
  return {
    appDirs: ['apps/shop-backend', 'apps/shop-frontend'],
    composeText: VALID_COMPOSE,
    envExamplePresent: true,
    ...overrides,
  };
}

describe('requiresPreviewEnvironment', () => {
  it('applies to a repository with an apps/*backend* directory', () => {
    expect(requiresPreviewEnvironment(['apps/shop-backend'], HOUSE_PATHS)).toBe(true);
  });

  it('applies to a repository with an apps/*frontend* directory', () => {
    expect(requiresPreviewEnvironment(['apps/admin-frontend'], HOUSE_PATHS)).toBe(true);
  });

  it('does not apply to a repository with neither', () => {
    // ql-pipeline itself: no apps/ directory at all.
    expect(requiresPreviewEnvironment([], HOUSE_PATHS)).toBe(false);
    // An apps/ directory that matches no area glob is not a product either.
    expect(requiresPreviewEnvironment(['apps/docs-site'], HOUSE_PATHS)).toBe(false);
  });

  it('keys off the configured area paths, not a hardcoded convention', () => {
    const custom: AreaPathsConfig = { backend: ['services/*api*/**'] };
    expect(requiresPreviewEnvironment(['apps/shop-backend'], custom)).toBe(false);
    expect(requiresPreviewEnvironment(['services/orders-api'], custom)).toBe(true);
  });

  it('accepts a Windows-style path', () => {
    expect(requiresPreviewEnvironment(['apps\\shop-backend'], HOUSE_PATHS)).toBe(true);
  });
});

describe('previewEnvironmentViolations', () => {
  it('finds nothing wrong with a compose that follows the contract', () => {
    expect(previewEnvironmentViolations(snapshot())).toEqual([]);
  });

  it('reports a missing compose file alone, rather than everything the absent folder lacks', () => {
    const violations = previewEnvironmentViolations(snapshot({ composeText: null, envExamplePresent: false }));

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(PREVIEW_COMPOSE_FILE);
    expect(violations[0]).toContain('missing');
  });

  it('requires a service named edge', () => {
    const compose = VALID_COMPOSE.replace('  edge:', '  gateway:');

    const violations = previewEnvironmentViolations(snapshot({ composeText: compose }));

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('no service named `edge`');
  });

  it('refuses published host ports on any service, naming which', () => {
    const compose = `${VALID_COMPOSE}    ports:\n      - "5432:5432"\n`;

    const violations = previewEnvironmentViolations(snapshot({ composeText: compose }));

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('publishes host ports');
    expect(violations[0]).toContain('`db`');
  });

  it('requires env.example beside the compose file', () => {
    const violations = previewEnvironmentViolations(snapshot({ envExamplePresent: false }));

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(PREVIEW_ENV_EXAMPLE);
  });

  it('reports every violation together, not the first one found', () => {
    const compose = `services:\n  app:\n    image: x\n    ports:\n      - "80:80"\n`;

    const violations = previewEnvironmentViolations(snapshot({ composeText: compose, envExamplePresent: false }));

    expect(violations).toHaveLength(3);
  });

  it('reports a compose file that is not YAML rather than treating it as empty', () => {
    const violations = previewEnvironmentViolations(snapshot({ composeText: 'services: [\n  broken' }));

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('not valid YAML');
  });

  it('reports a compose file with no services', () => {
    expect(previewEnvironmentViolations(snapshot({ composeText: 'version: "3"\n' }))[0]).toContain('declares no `services`');
    expect(previewEnvironmentViolations(snapshot({ composeText: '- just\n- a list\n' }))[0]).toContain('not a compose document');
  });
});

describe('assessPreviewEnvironment', () => {
  it('is not-required for a repository with no product apps, whatever the folder holds', () => {
    expect(assessPreviewEnvironment(snapshot({ appDirs: [], composeText: null }), HOUSE_PATHS)).toEqual({
      kind: 'not-required',
    });
  });

  it('is valid for a product repository whose folder follows the contract', () => {
    expect(assessPreviewEnvironment(snapshot(), HOUSE_PATHS)).toEqual({ kind: 'valid' });
  });

  it('is invalid, carrying the violations, for a product repository without the folder', () => {
    const verdict = assessPreviewEnvironment(snapshot({ composeText: null }), HOUSE_PATHS);

    expect(verdict.kind).toBe('invalid');
    if (verdict.kind === 'invalid') {
      expect(verdict.violations).toHaveLength(1);
    }
  });
});

describe('previewEnvironmentFinding', () => {
  it('is null when the contract does not apply or is satisfied', () => {
    expect(previewEnvironmentFinding({ kind: 'not-required' })).toBeNull();
    expect(previewEnvironmentFinding({ kind: 'valid' })).toBeNull();
  });

  it('is a blocking, non-auto-fixable finding that cites the contract node and every violation', () => {
    const finding = previewEnvironmentFinding({ kind: 'invalid', violations: ['first problem', 'second problem'] });

    expect(finding).not.toBeNull();
    expect(finding?.severity).toBe('must');
    expect(finding?.autoFixable).toBe(false);
    expect(finding?.rule).toBe('preview#environment');
    expect(finding?.file).toBe(PREVIEW_COMPOSE_FILE);
    expect(finding?.problem).toContain('- first problem');
    expect(finding?.problem).toContain('- second problem');
    expect(finding?.problem).toContain(PREVIEW_CONTRACT_NODE);
  });
});

describe('readPreviewEnvironmentSnapshot', () => {
  it('reads the apps directories, the compose text and the env.example presence', () => {
    const reader = {
      exists: vi.fn((path: string) => !path.endsWith('env.example')),
      listDirs: vi.fn(() => ['shop-backend', 'shop-frontend']),
      read: vi.fn(() => VALID_COMPOSE),
    };

    const result = readPreviewEnvironmentSnapshot('/repo', reader);

    expect(result.appDirs).toEqual(['apps/shop-backend', 'apps/shop-frontend']);
    expect(result.composeText).toBe(VALID_COMPOSE);
    expect(result.envExamplePresent).toBe(false);
  });

  it('reports no apps and no compose when neither exists, without reading anything', () => {
    const reader = { exists: vi.fn(() => false), listDirs: vi.fn(() => []), read: vi.fn(() => '') };

    const result = readPreviewEnvironmentSnapshot('/repo', reader);

    expect(result).toEqual({ appDirs: [], composeText: null, envExamplePresent: false });
    expect(reader.listDirs).not.toHaveBeenCalled();
    expect(reader.read).not.toHaveBeenCalled();
  });
});
