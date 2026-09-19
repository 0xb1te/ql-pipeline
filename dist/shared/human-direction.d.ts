/** One thing a person said on the pull request, as the agent should hear it. */
export interface PrComment {
    readonly author: string;
    /** True for a GitHub App / Actions account. Those are the pipeline talking to itself. */
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
 * **Dropping bot comments is not tidiness, it is the loop guard.** The pipeline posts a summary
 * and a review on every run; feeding those back to itself as "direction" would have it answering
 * its own complaints, and on a comment-triggered workflow it would re-trigger on its own writing
 * and never stop.
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
