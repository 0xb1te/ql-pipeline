// @neuron review.reviewer.settledThreads
/**
 * Which threads this run should close.
 *
 * **A review that raises findings closes nothing.** The fixer works from every finding at once and
 * reports one commit, not a mapping from finding to edit, so a run that just pushed a fix cannot
 * say which complaints it settled — only that it tried. Task 025 made the thread replies careful
 * about exactly this, and resolving on the strength of a fix attempt would undo that care by
 * marking threads settled on a guess.
 *
 * The honest moment is the review that comes back with nothing to say. At that point every
 * complaint the pipeline ever made about this pull request has been re-examined against the
 * current code and none of them survived — which is the only evidence that actually exists for
 * "that is dealt with". A finding that persists keeps its thread open, correctly, because it is
 * still true.
 *
 * Deliberately blunt about *which* threads: all of the pipeline's own, or none. Matching a new
 * review's findings back to the threads of an older one would mean comparing on path, line and
 * wording, and a line number moves the moment anybody edits the file above it. A wrong match
 * closes a live complaint, which is worse than leaving a settled one open.
 *
 * A person's own thread is never touched. They opened it; it is theirs to close.
 */
// @signal threadsToResolve
export function threadsToResolve(input) {
    if (input.findingsRaised > 0)
        return [];
    return input.threads.filter((thread) => thread.openedByPipeline && !thread.isResolved).map((thread) => thread.id);
}
//# sourceMappingURL=settled-threads.js.map