// @neuron shared.core.humanDirection
/** Longest direction block handed to an agent, in characters. */
export const MAX_DIRECTION_CHARS = 8_000;
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
// @signal humanComments
export function humanComments(comments) {
    return comments.filter((comment) => !comment.isBot && comment.body.trim() !== '');
}
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
// @signal formatDirection
export function formatDirection(comments) {
    const kept = humanComments(comments);
    if (kept.length === 0)
        return '';
    const rendered = kept.map((comment) => {
        const where = comment.path === undefined ? '' : ` on ${comment.path}${comment.line === undefined ? '' : `:${String(comment.line)}`}`;
        return `@${comment.author}${where}:\n${comment.body.trim()}`;
    });
    let block = rendered.join('\n\n');
    if (block.length > MAX_DIRECTION_CHARS) {
        while (rendered.length > 1 && block.length > MAX_DIRECTION_CHARS) {
            rendered.shift();
            block = rendered.join('\n\n');
        }
        block = `[earlier comments omitted to fit]\n\n${block}`.slice(0, MAX_DIRECTION_CHARS);
    }
    return block;
}
//# sourceMappingURL=human-direction.js.map