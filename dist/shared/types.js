export const AREAS = [
    'frontend',
    'backend',
    'mobile',
    'ios',
    'android',
    'infrastructure',
    'tooling',
    'docs',
];
export const COMMIT_TYPES = [
    'feat',
    'fix',
    'refactor',
    'perf',
    'chore',
    'docs',
    'test',
    'ci',
    'build',
    'revert',
];
export const REQUIRED_CHECKS = ['build', 'test', 'ai-review'];
export const AGENT_PROVIDERS = ['cursor', 'openai_compatible'];
/** The two phases that spend a model: the AI review, and the auto-fix agent. */
export const AGENT_PHASES = ['review', 'fix'];
//# sourceMappingURL=types.js.map