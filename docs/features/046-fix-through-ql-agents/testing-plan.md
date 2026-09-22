# 046-fix-through-ql-agents — Test Plan

<!-- GENERATED from testing-plan.xlsx by workflow/flows/assets/render-testing-plan.py — do not hand-edit. -->

The workbook `testing-plan.xlsx` is the source of truth. This rendering exists so the plan is diffable in a pull request and readable by the AI review.

## MCP Cases

| Case-id | Feature area | Precondition | Call | Input | Expected result | Severity | Obtained result | Status |
|---|---|---|---|---|---|---|---|---|
| _none_ |  |  |  |  |  |  |  |  |

## Agents Fixer

| Test-id | Description | Expected result | Obtained result | Status | Tester Observations | Programmer Observations |
|---|---|---|---|---|---|---|
| TASK046-1 | agentsFixerCredentialsFromEnv reads all five variables | Credentials object with agentsUrl, worktreeBaseDir and the three ql-auth values | Exact match | OK |  |  |
| TASK046-2 | It is undefined when any single one of the five is missing | undefined for each of the five, never a half-configured object | undefined in all five cases | OK | Loops the keys, so adding a sixth without adding it to the guard fails |  |
| TASK046-3 | A blank variable counts as absent | undefined | undefined | OK |  |  |
| TASK046-4 | buildAgentsBrief names every finding with rule, place and problem | Each finding appears with its rule id and file:line | All present | OK |  |  |
| TASK046-5 | A suggested fix is carried into the brief when the review offered one | The suggested fix text appears | Present | OK |  |  |
| TASK046-6 | The brief states the protected paths this provider cannot revert | Every protected path is named, with an instruction not to edit them | Present | OK | The one compensating control for the R4 guarantee this provider gives up |  |
| TASK046-7 | A repo declaring no protected paths gets no such section | No 'do not edit' text | Absent | OK |  |  |
| TASK046-8 | The run id is announced BEFORE the run finishes | onDispatched fires with the run id, and fires before the first poll wait | announced first, then waited | OK | Asserts order, not merely that the callback ran. The ordering is the whole feature |  |
| TASK046-9 | A completed run is reported as committed | FixOutcome kind committed | committed | OK |  |  |
| TASK046-10 | Polling continues while the run is queued or running | Walks queued -> running -> running -> completed and returns committed | committed | OK |  |  |
| TASK046-11 | A failed or cancelled run is an agent error naming the run | kind agent-error, reason contains the run id and the terminal status | Both statuses behave so | OK |  |  |
| TASK046-12 | The dispatch sends implement mode, the branch, the worktree and the model | mode implement, branch as given, worktree baseDir and taskId, model forwarded | All as expected | OK | The model comes from agent.fix.model, which already existed |  |
| TASK046-13 | No model key at all is sent when none is configured | 'model' absent from the request body, not null or empty | Absent | OK |  |  |
| TASK046-14 | A failed pickup comment does not abandon a running agent | onDispatched rejects; the outcome is still committed | committed | OK | The run is already executing; failing it over an unposted comment would be the messenger undoing the message |  |
| TASK046-15 | A refused dispatch never announces a pickup | 400 from ql-agents produces agent-error and zero announcements | agent-error, no announcement | OK | A comment claiming an agent has it, when none does, is worse than silence |  |
| TASK046-16 | An accepted dispatch carrying no run id is refused | agent-error mentioning the missing run id | agent-error | OK |  |  |
| TASK046-17 | A run that never finishes is given up on at the timeout | agent-error saying it did not finish, rather than polling forever | agent-error | OK | Injected clock, so a hung run cannot hang the job |  |
| TASK046-18 | pickedUpReply names the run and the attempt | Body contains the run id and 'attempt N of M' | Both present | OK |  |  |
| TASK046-19 | pickedUpReply says the agent holds every finding, not just this thread | Body says every finding in this review | Present | OK | The same overstatement replyForFinding already refuses to make |  |
| TASK046-20 | pickedUpReply never claims the finding is fixed | No 'fixed' or 'resolved' in the body | Neither present | OK |  |  |
| TASK046-21 | The cursor provider is entirely unaffected | runFix untouched; the full pre-existing suite still green | 759 passed, 56 files (738 + 21) | OK |  |  |
| TASK046-22 | Asking for ql_agents without credentials is refused loudly | Threads answered 'not attempted', PR escalated to a human, never a silent fall back to cursor | Escalation path wired in govern-command | PENDING | Covered by reading, not by a test: runGovern has no unit harness in this repo |  |
| TASK046-23 | ql-agents is reachable from a governance run | agents.rvproxy.com answers, protected, port 4100 | Exposed and live; proxyList confirms protected true | OK | Exposure verified. An end-to-end dispatch from Actions is TASK046-24 |  |
| TASK046-24 | A real FIX verdict dispatches a real ql-agents run | A run appears in ql-agents, the threads carry its id, and the push retriggers the pipeline | PENDING - needs a repository configured for ql_agents to reach a FIX verdict | PENDING | Gate 3. Nothing here is proven against a live ql-agents beyond the exposure |  |
| TASK046-25 | Build, typecheck, lint, neurons and the harness are clean | All clean; harness identical to the pre-change baseline | All clean; 90 errors before and after, same breakdown | OK | Baseline pre-exists on main |  |
