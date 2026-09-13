import type { CursorAgentRunner } from './cursor-runner.js';
export interface OpenAiCompatibleReviewerOptions {
    readonly baseUrl: string;
    readonly model: string;
    readonly apiKey: string;
    readonly fetchImpl?: typeof fetch;
}
/**
 * Reads the bearer token for an OpenAI-compatible review. Prefers
 * `QL_PIPELINE_AGENT_API_KEY`, then `OPENAI_API_KEY`. Never logs the value.
 */
export declare function readAgentApiKeyFromEnv(env?: NodeJS.ProcessEnv): string;
/**
 * Review-only runner: POST {baseUrl}/chat/completions, then wrap the
 * assistant text in the same envelope parseReviewVerdict already unwraps.
 * Agent (fixer) mode is refused — a chat completion is not a write agent.
 */
export declare function createOpenAiCompatibleReviewer(options: OpenAiCompatibleReviewerOptions): CursorAgentRunner;
