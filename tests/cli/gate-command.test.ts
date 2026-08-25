import { describe, expect, it } from 'vitest';
import { gatesForStage } from '../../src/cli/gate-command.js';
import type { RouteDecision } from '../../src/shared/types.js';

function decision(gates: RouteDecision['gates']): RouteDecision {
  return { types: ['feat'], areas: ['frontend', 'backend'], ruleFiles: [], gates };
}

describe('gatesForStage', () => {
  it('keeps only the test commands for the test stage', () => {
    const route = decision([{ area: 'frontend', build: 'npm run build', test: 'npm test' }]);

    expect(gatesForStage(route, 'test')).toEqual([{ area: 'frontend', test: 'npm test' }]);
  });

  it('keeps only the build commands for the build stage', () => {
    const route = decision([{ area: 'frontend', build: 'npm run build', test: 'npm test' }]);

    expect(gatesForStage(route, 'build')).toEqual([{ area: 'frontend', build: 'npm run build' }]);
  });

  it('drops areas that have nothing configured for this stage', () => {
    const route = decision([
      { area: 'frontend', build: 'npm run build' },
      { area: 'backend', test: 'npm test' },
    ]);

    expect(gatesForStage(route, 'test')).toEqual([{ area: 'backend', test: 'npm test' }]);
    expect(gatesForStage(route, 'build')).toEqual([{ area: 'frontend', build: 'npm run build' }]);
  });

  it('returns nothing when no area is gated at all', () => {
    expect(gatesForStage(decision([{ area: 'docs' }]), 'test')).toEqual([]);
  });

  it('keeps one entry per area when several areas are gated', () => {
    const route = decision([
      { area: 'frontend', test: 'npm run test:fe' },
      { area: 'backend', test: 'npm run test:be' },
    ]);

    expect(gatesForStage(route, 'test')).toHaveLength(2);
  });
});
