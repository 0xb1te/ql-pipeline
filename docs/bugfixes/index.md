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

- `bugfixes/045-one-defect-six-times` — `dedupeFindings` keyed on `file:line:rule`, but the review
  slices its standards across passes and each pass cites whichever rule its slice gave it, so one
  defect survived once per pass: ql-desktop #103 reported one stray template line as six findings
  under six rule ids. It now takes one list per pass — `file:line` across passes, `file:line:rule`
  within one — and `govern-command.ts` stops flattening them. Do not put the rule back in the
  cross-pass key, and do not fill the anchor set during a pass rather than between passes: each
  undoes one of the two halves the neuron's `owns` bullet argues for. Shipped in `0.3.3`.

- `bugfixes/048-attempt-counter-blind-to-agents` — `countFixAttempts` read the attempt count off
  `[bot]`-suffixed commits, which is only pipeline evidence while the pipeline is what commits.
  Under `ql_agents` it is not — ql-agents commits on its own host with its own message — so the
  counter read 0 on every run, `max_fix_attempts` never tripped, and each push started another
  attempt: an unbounded fix loop, introduced by `046` and widened by `047`. It now also counts
  `FIX_ATTEMPT_MARKER`, stamped on the summary a FIX decision already posts, and takes the
  **larger** of the two sources — never the sum, which would report two attempts for one on the
  cursor provider and halve the budget. Do not drop the commit check either: a PR older than the
  marker has commits and no markers. Shipped in `0.5.1`.

- `bugfixes/051-dogfood-runs-main-not-the-pr` — `dogfood.yml` never set `ql-pipeline-ref`, so every
  job's "Checkout ql-pipeline" step took `main` and ran `main`'s `dist/main.js` against the branch:
  only the YAML came from the pull request (`uses: ./...` is local), and no change to govern, gate
  or tester code was ever exercised by the check meant to prove it — run 35728255439 on #43
  logged 0.5.1's lines against a 0.6.0 branch. The `resolve` job now decides which ql-pipeline
  runs (`ql-pipeline-repo` / `ql-pipeline-ref` outputs): the pull request's own head when the
  caller is this repository, the pinned input otherwise, and all four checkouts read that. Do not
  move the decision into `dogfood.yml` — `github.head_ref` is empty on both comment events, which
  run the default branch's copy of that file anyway. Shipped in `0.6.1`.

- `bugfixes/052-two-comments-per-preview` — Every preview got two comments: ql-proxy's own
  announce (posted as `github-actions[bot]` only because the deploy handed it `github.token`)
  and the pipeline's summary. ql-proxy 0.2.0 added `up --no-announce`; the deploy now passes it,
  `QL_PREVIEW_ANNOUNCE_TOKEN` and the `GH_TOKEN` mapping are gone, and the ql-proxy child holds no
  GitHub token at all. `--pr` stays — teardown resolves the stack by it. Needs 0.2.0 on the host;
  0.1.0 refuses the flag loudly on the first run. Shipped in `0.7.1`.
