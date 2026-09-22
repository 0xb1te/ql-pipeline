/** One thing a person said on the pull request, as the agent should hear it. */
export interface PrComment {
    readonly author: string;
    /**
     * True for a GitHub App / Actions account.
     *
     * Only ever true where the workflow runs as the default `GITHUB_TOKEN`. Once `GH_TOKEN` is
     * set the pipeline posts as a person and this is false on its own comments, which is why it
     * cannot be the whole guard — see {@link humanComments}.
     */
    readonly isBot: boolean;
    readonly body: string;
    /** Present when the comment sits on a specific line rather than the conversation. */
    readonly path?: string;
    readonly line?: number;
}
/** Longest direction block handed to an agent, in characters. */
export declare const MAX_DIRECTION_CHARS = 8000;
/**
 * The comments a person wrote, newest last, with everything the pipeline said removed.
 *
 * **Dropping what the pipeline wrote is not tidiness, it is the loop guard.** The pipeline posts
 * a summary and a review on every run; feeding those back to itself as "direction" would have it
 * answering its own complaints, and on a comment-triggered workflow it would re-trigger on its
 * own writing and never stop.
 *
 * It takes two tests, because the pipeline has two voices and neither test catches both:
 *
 * - `isBot` catches `github-actions[bot]`, which is who posts when a repository runs on the
 *   default `GITHUB_TOKEN`.
 * - {@link AUTOMATION_MARKER} catches the rest. With `secrets.GH_TOKEN` set — the configuration
 *   that lets the fix loop push at all — the pipeline posts as the operator's own account, so
 *   GitHub reports `type: 'User'` and `isBot` is false on its own summary, its complaint body
 *   and every reply it writes into a finding thread. Author identity cannot separate the two;
 *   what they say can, which is why `stampAutomated` stamps every body the client sends.
 *
 * Asking only the first question is how this unit spent three releases handing the fix agent the
 * pipeline's own verdict as though a person had asked for it.
 *
 * The marker test is deliberately the discriminator rather than the author: declining everything
 * the operator's account wrote would throw away their real direction along with the chatter, and
 * that direction is the only way anyone steers a fix attempt.
 *
 * Empty bodies go too: a reaction or an attachment-only comment carries no instruction, and a
 * blank entry in the prompt reads as a person who said nothing on purpose.
 */
export declare function humanComments(comments: readonly PrComment[]): readonly PrComment[];
/**
 * Those comments as a prompt block, or the empty string when there are none.
 *
 * The empty string matters: the caller substitutes this into a template, and a heading with
 * nothing under it invites an agent to invent a reason for the silence. No comments means no
 * section.
 *
 * Oldest first, because a conversation reads forwards and later instructions are meant to
 * override earlier ones — the agent needs to see which way time runs.
 *
 * Truncation drops the *oldest*, for the same reason: when a person has said more than fits, the
 * most recent word is the one they expect to be followed.
 */
export declare function formatDirection(comments: readonly PrComment[]): string;
