# Bugfixes — rollup

Two lines per task, appended in each task's ship step and read in Step 0 of every future task.
What was wrong on the first line; where the fix lives and what a future change must not undo on
the second. If a fix lives in a shared helper, name the helper — that is the sentence a later task
will match on.

This rollup starts at 042, the first bugfix to open a folder under `docs/bugfixes/`. Earlier
bugfixes are discoverable by branch name (`bugfixes/NNN-<slug>`) and by their merge commits; they
are not back-filled here, for the same reason the features rollup gives — inventing rollup lines
for work someone else shipped is a worse record than an honest gap.

Newest entries at the bottom.

- `bugfixes/042-artifacts-checked-after-r4` — The task-folder check sat below the R4 protected-paths
  guard, which `return`s, so it never ran on any pull request touching `rules/`, `prompts/`, config
  or workflows. It now runs before that guard, and `protectedPathsComment` carries its findings
  inside R4's own comment — because an escalation returns before the review and the verdict, so
  anything not in that one comment is reported nowhere at all.
