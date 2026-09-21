/** Where the preview stack published its MCP server, on the runner's own compose network. */
export declare const MCP_ENDPOINT_VAR = "QL_PREVIEW_MCP_URL";
/**
 * The last job in the chain: a green pull request with a live preview, seeded with its own test
 * data, driven over MCP so an agent can say what broke.
 *
 * It reaches the application over the **internal compose network**, which is why the job runs on
 * the same self-hosted host as the preview. The MCP surface is never publicly routed: the preview
 * URL's only lock is a gate token meant for showing somebody a demo, and a token that opens a demo
 * must not also open a tool that can read every user.
 *
 * Everything that goes wrong here is reported, never swallowed. An unparseable plan fails loudly,
 * because a silently skipped test run that reports success is worse than having no tester. An
 * unreachable MCP server is a finding about the feature, not an infrastructure hiccup.
 */
export declare function runTestPreview(): Promise<void>;
