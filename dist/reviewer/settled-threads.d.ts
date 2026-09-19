/** One review thread on the pull request, as the resolver needs to see it. */
export interface ReviewThread {
    /** GraphQL node id — the only handle `resolveReviewThread` accepts. */
    readonly id: string;
    readonly isResolved: boolean;
    /**
     * Whether this pipeline opened the thread, decided by the automation marker its client stamps
     * into everything it writes — not by who authored it. Once `GH_TOKEN` is set the pipeline and
     * the operator are the same GitHub account, so authorship answers nothing here either.
     */
    readonly openedByPipeline: boolean;
}
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
export declare function threadsToResolve(input: {
    readonly threads: readonly ReviewThread[];
    /** How many findings this review raised. Anything above zero resolves nothing. */
    readonly findingsRaised: number;
}): readonly string[];
