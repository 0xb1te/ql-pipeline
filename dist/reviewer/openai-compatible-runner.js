/**
 * Reads the bearer token for an OpenAI-compatible review. Prefers
 * `QL_PIPELINE_AGENT_API_KEY`, then `OPENAI_API_KEY`. Never logs the value.
 */
// @signal readAgentApiKeyFromEnv
export function readAgentApiKeyFromEnv(env = process.env) {
    const dedicated = env['QL_PIPELINE_AGENT_API_KEY'];
    if (dedicated !== undefined && dedicated.length > 0) {
        return dedicated;
    }
    const openai = env['OPENAI_API_KEY'];
    if (openai !== undefined && openai.length > 0) {
        return openai;
    }
    throw new Error('missing QL_PIPELINE_AGENT_API_KEY or OPENAI_API_KEY — required when agent.provider is openai_compatible');
}
/**
 * Review-only runner: POST {baseUrl}/chat/completions, then wrap the
 * assistant text in the same envelope parseReviewVerdict already unwraps.
 * Agent (fixer) mode is refused — a chat completion is not a write agent.
 */
// @signal createOpenAiCompatibleReviewer
export function createOpenAiCompatibleReviewer(options) {
    const fetchImpl = options.fetchImpl ?? fetch;
    return async (prompt, run) => {
        if (run.mode === 'agent') {
            return {
                stdout: '',
                stderr: 'agent.provider openai_compatible is review-only; the fixer still requires cursor-agent',
                exitCode: 1,
            };
        }
        const url = `${options.baseUrl}/chat/completions`;
        let response;
        try {
            response = await fetchImpl(url, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${options.apiKey}`,
                },
                body: JSON.stringify({
                    model: options.model,
                    temperature: 0,
                    messages: [{ role: 'user', content: prompt }],
                }),
            });
        }
        catch (cause) {
            return { stdout: '', stderr: `openai-compatible request failed: ${String(cause)}`, exitCode: 1 };
        }
        const rawBody = await response.text();
        if (!response.ok) {
            return {
                stdout: '',
                stderr: `openai-compatible review returned HTTP ${response.status}`,
                exitCode: 1,
            };
        }
        const content = extractAssistantText(rawBody);
        if (content === null) {
            return { stdout: '', stderr: 'openai-compatible response had no assistant text', exitCode: 1 };
        }
        return {
            stdout: JSON.stringify({ type: 'result', is_error: false, result: content }),
            stderr: '',
            exitCode: 0,
        };
    };
}
function extractAssistantText(rawBody) {
    let parsed;
    try {
        parsed = JSON.parse(rawBody);
    }
    catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return null;
    }
    const choices = parsed.choices;
    if (!Array.isArray(choices) || choices[0] === undefined) {
        return null;
    }
    const first = choices[0];
    if (typeof first !== 'object' || first === null || Array.isArray(first)) {
        return null;
    }
    const message = first.message;
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
        return null;
    }
    const content = message.content;
    return typeof content === 'string' && content.length > 0 ? content : null;
}
//# sourceMappingURL=openai-compatible-runner.js.map