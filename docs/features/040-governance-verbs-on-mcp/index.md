# 040 — governance verbs on the MCP

## What this is, in plain language

ql-pipeline decides things about pull requests all day: which area a PR belongs to, whether its
gates passed, whether it merges, and whether it is waiting on a person. Until now, an agent
holding ql-pipeline's MCP could ask it exactly three questions — all about *setting up* a repo
(`doctor`, `init`, `upgrade`). None of them were about the governing.

So if you wanted to know "what did the pipeline decide about PR 31, and why", the only way to
find out was to run the whole governance pass again. That pass is not a question. It reviews the
PR with a paid model, writes comments, pushes fix commits, approves, labels, and merges. Asking
it what it thinks changes the thing you were asking about.

## What changes

Four new read-only questions an agent can ask, which together follow the pipeline's own chain of
reasoning end to end:

- **Which areas does this PR route to, and which gates and rules does that pull in?**
- **What did the gate jobs actually report?**
- **Given those gates and these review findings, what is the verdict — merge, fix, or block —
  and why that one?**
- **Which pull requests in this repository are sitting in the human queue right now?**

Every one of them only reads. None writes a comment, pushes a commit, adds a label, or merges
anything.

## What deliberately does not change

The two verbs that *act* — `gate` and `govern` — stay off the MCP. `govern` merges to `main`,
approves, comments and pushes; `gate` runs shell commands named in a config file. Giving an agent
a one-call path to any of that is the exact thing this repository's own configuration
(`require_human_approval: true`) exists to prevent.

That is a deliberate carve-out, not an oversight, and it is written down as one — see
`plan.md` §"The CI-verb carve-out". It is also a real deviation from the suite's parity rule,
which is recorded rather than glossed over.

## Where you will see it

Nowhere in a browser — ql-pipeline has no UI. You see it from an agent or an MCP client
connected to `ql-pipeline-mcp`: `tools/list` now returns seven tools instead of three.
