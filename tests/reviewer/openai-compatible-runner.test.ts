import { describe, expect, it, vi } from 'vitest';
import { parseReviewVerdict } from '../../src/reviewer/response-parser.js';
import {
  createOpenAiCompatibleReviewer,
  readAgentApiKeyFromEnv,
} from '../../src/reviewer/openai-compatible-runner.js';

const DUMMY_KEY = 'sk-test-not-a-real-key';
const BASE_URL = 'https://llm.example.com/v1';

function completionBody(content: string): string {
  return JSON.stringify({
    choices: [{ message: { role: 'assistant', content } }],
  });
}

describe('readAgentApiKeyFromEnv', () => {
  it('prefers QL_PIPELINE_AGENT_API_KEY over OPENAI_API_KEY', () => {
    expect(
      readAgentApiKeyFromEnv({
        QL_PIPELINE_AGENT_API_KEY: DUMMY_KEY,
        OPENAI_API_KEY: 'sk-other-unused',
      }),
    ).toBe(DUMMY_KEY);
  });

  it('falls back to OPENAI_API_KEY when the dedicated key is unset', () => {
    expect(readAgentApiKeyFromEnv({ OPENAI_API_KEY: DUMMY_KEY })).toBe(DUMMY_KEY);
  });

  it('treats an empty dedicated key as unset and uses the fallback', () => {
    expect(
      readAgentApiKeyFromEnv({
        QL_PIPELINE_AGENT_API_KEY: '',
        OPENAI_API_KEY: DUMMY_KEY,
      }),
    ).toBe(DUMMY_KEY);
  });

  it('throws an honest message naming both variables when neither is set', () => {
    expect(() => readAgentApiKeyFromEnv({})).toThrow(
      /QL_PIPELINE_AGENT_API_KEY or OPENAI_API_KEY/,
    );
  });
});

describe('createOpenAiCompatibleReviewer', () => {
  it('POSTs chat/completions and wraps assistant text in the cursor-agent envelope', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(completionBody('{"verdict":"PASS","findings":[]}'), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const runner = createOpenAiCompatibleReviewer({
      baseUrl: BASE_URL,
      model: 'gpt-4.1',
      apiKey: DUMMY_KEY,
      fetchImpl,
    });

    const invocation = await runner('review this diff', { cwd: '/repo', mode: 'ask' });

    expect(invocation.exitCode).toBe(0);
    expect(invocation.stderr).toBe('');
    expect(JSON.parse(invocation.stdout)).toEqual({
      type: 'result',
      is_error: false,
      result: '{"verdict":"PASS","findings":[]}',
    });
    expect(parseReviewVerdict(invocation.stdout)).toEqual({
      ok: true,
      value: { verdict: 'PASS', findings: [] },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/chat/completions`);
    expect(init).toMatchObject({ method: 'POST' });
    const headers = init?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers.authorization).toBe(`Bearer ${DUMMY_KEY}`);
    const body = init?.body;
    if (typeof body !== 'string') {
      throw new Error('expected JSON string body');
    }
    expect(JSON.parse(body)).toEqual({
      model: 'gpt-4.1',
      temperature: 0,
      messages: [{ role: 'user', content: 'review this diff' }],
    });
  });

  it('reports HTTP status only and does not echo the body or the API key', async () => {
    const leak = `${DUMMY_KEY} leaked-in-body`;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: leak }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const runner = createOpenAiCompatibleReviewer({
      baseUrl: BASE_URL,
      model: 'gpt-4.1',
      apiKey: DUMMY_KEY,
      fetchImpl,
    });

    const invocation = await runner('review this', { cwd: '/repo', mode: 'ask' });

    expect(invocation.exitCode).toBe(1);
    expect(invocation.stdout).toBe('');
    expect(invocation.stderr).toBe('openai-compatible review returned HTTP 502');
    expect(invocation.stderr).not.toContain(DUMMY_KEY);
    expect(invocation.stderr).not.toContain(leak);
    expect(invocation.stderr).not.toContain('leaked-in-body');
  });

  it('refuses agent/fix mode with an honest Cursor-only message', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const runner = createOpenAiCompatibleReviewer({
      baseUrl: BASE_URL,
      model: 'gpt-4.1',
      apiKey: DUMMY_KEY,
      fetchImpl,
    });

    const invocation = await runner('fix this', { cwd: '/repo', mode: 'agent' });

    expect(invocation.exitCode).toBe(1);
    expect(invocation.stdout).toBe('');
    expect(invocation.stderr).toMatch(/review-only/);
    expect(invocation.stderr).toMatch(/cursor-agent/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when the response has no assistant text', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const runner = createOpenAiCompatibleReviewer({
      baseUrl: BASE_URL,
      model: 'gpt-4.1',
      apiKey: DUMMY_KEY,
      fetchImpl,
    });

    const invocation = await runner('review this', { cwd: '/repo', mode: 'ask' });

    expect(invocation.exitCode).toBe(1);
    expect(invocation.stderr).toMatch(/no assistant text/);
  });
});
