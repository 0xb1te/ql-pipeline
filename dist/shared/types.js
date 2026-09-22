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
export const REQUIRED_CHECKS = ['build', 'test', 'ai-review', 'task-artifacts'];
/**
 * `ql_agents` does not name a model vendor, which is the point of it. It routes the fix to the
 * suite's own agent runner, where which coding agent actually runs is a descriptor on that side
 * rather than a code path here - so changing vendor stops being a change to this repository.
 */
export const AGENT_PROVIDERS = ['cursor', 'openai_compatible', 'ql_agents'];
/** The two phases that spend a model: the AI review, and the auto-fix agent. */
export const AGENT_PHASES = ['review', 'fix'];
/**
 * Stamped into every comment this pipeline writes, so a later run can recognise its own voice.
 *
 * Identity cannot do this job. The workflow acts as `secrets.GH_TOKEN` when one is set, and that
 * token belongs to a person — the same person who comments on the pull request. Once `GH_TOKEN`
 * is configured, the pipeline's comments and the operator's are written by the *same GitHub
 * account*, so "was this written by a bot?" has no answer, and "was this written by me?" would
 * decline the operator's own direction along with the pipeline's chatter.
 *
 * What the two do not share is what they say. An HTML comment renders as nothing, survives
 * GitHub's Markdown untouched, and is carried in the webhook payload the trigger reads — so the
 * guard can ask the one question that still separates them.
 *
 * Without this, a `GH_TOKEN` that finally closes the fix loop also makes every verdict comment
 * start another run that writes another verdict comment, forever.
 *
 * It lives here, rather than beside `stampAutomated` where it was introduced, because two
 * guards need it and one of them must stay pure. `shared/github-client.ts` already imports
 * `PrComment` from `shared/human-direction.ts`; that import is type-only and erases, so the
 * client has no runtime dependency on the formatter. Had the formatter imported this constant
 * back out of the client, that erasure would have reversed into a real one — a pure string
 * function pulling in `@actions/github` and the whole Octokit surface to read one string.
 */
export const AUTOMATION_MARKER = '<!-- ql-pipeline:automated -->';
//# sourceMappingURL=types.js.map