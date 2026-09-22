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

- `bugfixes/043-pipeline-reads-own-comments` — `humanComments` decided what counts as human
  direction from `isBot` alone, so on any repository running as `secrets.GH_TOKEN` the pipeline's
  own summary, complaint and thread replies came back as `type: 'User'` and were handed to the fix
  agent as instructions from a person. The guard now also drops any body carrying
  `AUTOMATION_MARKER`, which moved to `shared/types.ts` so both halves of the loop guard read one
  constant — `github-client.ts` stamps it, `human-direction.ts` filters on it. Do not make the
  second test key on the author instead: the operator comments from that same account, and
  declining their direction is the failure `026` and `030` were both trying to avoid. Shipped in
  `0.3.1`.

- `bugfixes/044-fix-attempt-starts-silently` — A `FIX` verdict ran `cursor-agent` for minutes with
  nothing on the pull request saying so: the summary comment is posted before `runFix`, but its
  `Decision: FIX` line names a verdict, not an activity, and no part of `src/` read
  `GITHUB_RUN_ID`, so there was no run to link. `formatAuditSummary` now announces the attempt and
  links the run, and warns that a push cancels it — consumers set `cancel-in-progress`. The
  environment is read in `bootstrap.ts` (`actionsRunUrl`) and passed in as an argument: do not move
  that read into `audit-summary.ts`, whose neuron declares it `pure` with no receptors or
  effectors. Do not add a *second* comment for status either — PR comments reach the fix agent as
  human direction, which `043` had just closed off. Shipped in `0.3.2`.
