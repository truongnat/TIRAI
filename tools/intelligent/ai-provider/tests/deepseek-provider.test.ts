// ---------------------------------------------------------------------------
// DeepSeekProvider tests – mocked fetch (no real API calls)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeepSeekProvider } from '../src/providers/deepseek/deepseek-provider.js';
import { AIProviderError, AIProviderErrorCode } from '../src/errors.js';
import type { DeepSeekRawResponse } from '../src/providers/deepseek/deepseek-mapper.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeResponse(overrides: Partial<DeepSeekRawResponse> = {}): DeepSeekRawResponse {
  return {
    id: 'chatcmpl-test-001',
    model: 'deepseek-v4-pro',
    choices: [{
      message: { content: '{"status":"ok"}' },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
    },
    ...overrides,
  };
}

function mockOkResponse(raw: DeepSeekRawResponse = makeResponse()): void {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => raw,
  });
}

function mockErrorResponse(status: number, body: Record<string, unknown> = { message: 'Error' }): void {
  mockFetch.mockResolvedValue({
    ok: false,
    status,
    statusText: `Status ${status}`,
    json: async () => body,
  });
}

describe('DeepSeekProvider – Configuration', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key-123');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates provider with valid config', () => {
    const provider = new DeepSeekProvider({ apiKey: 'explicit-key' });
    expect(provider.name).toBe('deepseek');
  });

  it('throws CONFIG_ERROR when API key is missing', () => {
    vi.unstubAllEnvs();
    expect(() => new DeepSeekProvider()).toThrow(/DEEPSEEK_API_KEY/);
    try {
      new DeepSeekProvider();
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).code).toBe(AIProviderErrorCode.CONFIG_ERROR);
    }
  });

  it('uses default model when none specified', async () => {
    const provider = new DeepSeekProvider();
    mockOkResponse();

    await provider.generate({
      messages: [{ role: 'user', content: 'test' }],
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.model).toBe('deepseek-v4-pro');
  });

  it('uses custom model when specified', async () => {
    const provider = new DeepSeekProvider({ model: 'deepseek-v4-flash' });
    mockOkResponse();

    await provider.generate({
      messages: [{ role: 'user', content: 'test' }],
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.model).toBe('deepseek-v4-flash');
  });

  it('allows per-request model override', async () => {
    const provider = new DeepSeekProvider();
    mockOkResponse();

    await provider.generate({
      model: 'custom-model',
      messages: [{ role: 'user', content: 'test' }],
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.model).toBe('custom-model');
  });

  it('uses default base URL', async () => {
    const provider = new DeepSeekProvider();
    mockOkResponse();

    await provider.generate({
      messages: [{ role: 'user', content: 'test' }],
    });

    const url = mockFetch.mock.calls[0][0];
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('allows custom base URL', async () => {
    const provider = new DeepSeekProvider({ baseUrl: 'https://custom.proxy.com' });
    mockOkResponse();

    await provider.generate({
      messages: [{ role: 'user', content: 'test' }],
    });

    const url = mockFetch.mock.calls[0][0];
    expect(url).toBe('https://custom.proxy.com/v1/chat/completions');
  });
});

describe('DeepSeekProvider – Request mapping', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('maps system + user messages correctly', async () => {
    const provider = new DeepSeekProvider();
    mockOkResponse();

    await provider.generate({
      messages: [
        { role: 'system', content: 'You are a helper.' },
        { role: 'user', content: 'Hello' },
      ],
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.messages).toEqual([
      { role: 'system', content: 'You are a helper.' },
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('sets temperature and max_tokens', async () => {
    const provider = new DeepSeekProvider();
    mockOkResponse();

    await provider.generate({
      messages: [{ role: 'user', content: 'test' }],
      temperature: 0.5,
      maxOutputTokens: 1000,
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.temperature).toBe(0.5);
    expect(callBody.max_tokens).toBe(1000);
  });

  it('sends explicit DeepSeek V4 thinking mode when configured', async () => {
    const provider = new DeepSeekProvider({ model: 'deepseek-v4-flash' });
    mockOkResponse();

    await provider.generate({
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'Return JSON only.' }],
      providerOptions: { deepseek: { thinking: 'disabled' } },
      responseSchema: { type: 'object' },
      maxOutputTokens: 256,
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.thinking).toEqual({ type: 'disabled' });
    expect(callBody.response_format).toEqual({ type: 'json_object' });
    expect(callBody.max_tokens).toBe(256);
  });

  it('does not send thinking when it is deliberately unspecified', async () => {
    const provider = new DeepSeekProvider({ model: 'deepseek-v4-flash' });
    mockOkResponse();

    await provider.generate({ messages: [{ role: 'user', content: 'Return JSON only.' }] });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.thinking).toBeUndefined();
  });

  it('injects schema instruction and json_object format when responseSchema is set', async () => {
    const provider = new DeepSeekProvider();
    mockOkResponse();

    const schema = {
      type: 'object',
      properties: { status: { type: 'string' } },
      required: ['status'],
    };

    await provider.generate({
      messages: [{ role: 'user', content: 'test' }],
      responseSchema: schema,
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    // First message should be the schema instruction
    expect(callBody.messages[0].role).toBe('system');
    expect(callBody.messages[0].content).toContain('JSON Schema');
    // response_format should be json_object
    expect(callBody.response_format).toEqual({ type: 'json_object' });
  });

  it('does NOT set response_format when no schema is provided', async () => {
    const provider = new DeepSeekProvider();
    mockOkResponse();

    await provider.generate({
      messages: [{ role: 'user', content: 'test' }],
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.response_format).toBeUndefined();
  });

  it('includes Authorization header with API key', async () => {
    const provider = new DeepSeekProvider({ apiKey: 'my-secret-key' });
    mockOkResponse();

    await provider.generate({
      messages: [{ role: 'user', content: 'test' }],
    });

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['Authorization']).toBe('Bearer my-secret-key');
  });
});

describe('DeepSeekProvider – Response handling', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns valid JSON response with parsed data', async () => {
    const provider = new DeepSeekProvider();
    mockOkResponse();

    const result = await provider.generate<{ status: string }>({
      messages: [{ role: 'user', content: 'test' }],
    });

    expect(result.provider).toBe('deepseek');
    expect(result.model).toBe('deepseek-v4-pro');
    expect(result.data).toEqual({ status: 'ok' });
    expect(result.rawText).toBe('{"status":"ok"}');
    expect(result.finishReason).toBe('stop');
    expect(result.requestId).toBe('chatcmpl-test-001');
  });

  it('maps usage metadata correctly', async () => {
    const provider = new DeepSeekProvider();
    mockOkResponse();

    const result = await provider.generate({
      messages: [{ role: 'user', content: 'test' }],
    });

    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    });
  });

  it('retries a JSON-mode empty response and succeeds', async () => {
    const provider = new DeepSeekProvider({ maxRetries: 2 });
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => makeResponse({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => makeResponse() });

    const result = await provider.generate({
      messages: [{ role: 'user', content: 'Return JSON only.' }],
      responseSchema: { type: 'object' },
    });

    expect(result.data).toEqual({ status: 'ok' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('classifies an exhausted empty response as RESPONSE_EMPTY', async () => {
    const provider = new DeepSeekProvider({ maxRetries: 1 });
    mockOkResponse(makeResponse({
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
    }));

    await expect(provider.generate({
      messages: [{ role: 'user', content: 'test' }],
      responseSchema: { type: 'object' },
    })).rejects.toMatchObject({ code: AIProviderErrorCode.RESPONSE_EMPTY, retryable: true });
  });

  it('throws RESPONSE_EMPTY on null content', async () => {
    const provider = new DeepSeekProvider({ maxRetries: 1 });
    mockOkResponse(makeResponse({
      choices: [{ message: { content: null }, finish_reason: 'stop' }],
    }));

    await expect(provider.generate({
      messages: [{ role: 'user', content: 'test' }],
    })).rejects.toMatchObject({ code: AIProviderErrorCode.RESPONSE_EMPTY });
  });

  it('classifies finish_reason length as OUTPUT_LIMIT_EXCEEDED', async () => {
    const provider = new DeepSeekProvider({ maxRetries: 1 });
    mockOkResponse(makeResponse({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }));

    await expect(provider.generate({ messages: [{ role: 'user', content: 'test' }] }))
      .rejects.toMatchObject({ code: AIProviderErrorCode.OUTPUT_LIMIT_EXCEEDED, retryable: false });
  });

  it('classifies a missing choices array as MALFORMED_PROVIDER_RESPONSE', async () => {
    const provider = new DeepSeekProvider({ maxRetries: 1 });
    mockOkResponse({ id: 'bad-response', choices: [] });

    await expect(provider.generate({ messages: [{ role: 'user', content: 'test' }] }))
      .rejects.toMatchObject({ code: AIProviderErrorCode.MALFORMED_PROVIDER_RESPONSE });
  });

  it('does not persist reasoning_content in the generic response', async () => {
    const provider = new DeepSeekProvider();
    mockOkResponse(makeResponse({
      choices: [{ message: { content: '{"status":"ok"}', reasoning_content: 'private reasoning' }, finish_reason: 'stop' }],
    }));

    const result = await provider.generate({
      messages: [{ role: 'user', content: 'Return JSON only.' }],
      responseSchema: { type: 'object' },
    });

    expect(JSON.stringify(result)).not.toContain('private reasoning');
  });

  it('throws RESPONSE_PARSE_ERROR on invalid JSON', async () => {
    const provider = new DeepSeekProvider();
    mockOkResponse(makeResponse({
      choices: [{ message: { content: 'not json' }, finish_reason: 'stop' }],
    }));

    await expect(provider.generate({
      messages: [{ role: 'user', content: 'test' }],
      responseSchema: { type: 'object' },
    })).rejects.toThrow(/not valid JSON/);
  });

  it('throws RESPONSE_SCHEMA_ERROR on schema mismatch', async () => {
    const provider = new DeepSeekProvider();
    mockOkResponse(makeResponse({
      choices: [{ message: { content: '{"wrong":"field"}' }, finish_reason: 'stop' }],
    }));

    const schema = {
      type: 'object',
      properties: { status: { type: 'string' } },
      required: ['status'],
      additionalProperties: false,
    };

    await expect(provider.generate({
      messages: [{ role: 'user', content: 'test' }],
      responseSchema: schema,
    })).rejects.toThrow(/does not match schema/);
  });
});

describe('DeepSeekProvider – Error mapping', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('maps 401 to AUTH_ERROR', async () => {
    const provider = new DeepSeekProvider({ maxRetries: 1 });
    mockErrorResponse(401, { message: 'Invalid key' });

    try {
      await provider.generate({ messages: [{ role: 'user', content: 'test' }] });
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).code).toBe(AIProviderErrorCode.AUTH_ERROR);
      expect((err as AIProviderError).retryable).toBe(false);
    }
  });

  it('maps 400 to BAD_REQUEST (non-retryable)', async () => {
    const provider = new DeepSeekProvider({ maxRetries: 1 });
    mockErrorResponse(400, { message: 'Bad input' });

    try {
      await provider.generate({ messages: [{ role: 'user', content: 'test' }] });
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).code).toBe(AIProviderErrorCode.BAD_REQUEST);
      expect((err as AIProviderError).retryable).toBe(false);
    }
  });

  it('maps 429 to RATE_LIMITED (retryable)', async () => {
    const provider = new DeepSeekProvider({ maxRetries: 1 });
    mockErrorResponse(429, { message: 'Too many requests' });

    try {
      await provider.generate({ messages: [{ role: 'user', content: 'test' }] });
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).code).toBe(AIProviderErrorCode.RATE_LIMITED);
      expect((err as AIProviderError).retryable).toBe(true);
    }
  });

  it('maps 500 to PROVIDER_UNAVAILABLE (retryable)', async () => {
    const provider = new DeepSeekProvider({ maxRetries: 1 });
    mockErrorResponse(500, { message: 'Internal error' });

    try {
      await provider.generate({ messages: [{ role: 'user', content: 'test' }] });
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).code).toBe(AIProviderErrorCode.PROVIDER_UNAVAILABLE);
      expect((err as AIProviderError).retryable).toBe(true);
    }
  });

  it('retries on 5xx then succeeds', async () => {
    const provider = new DeepSeekProvider({ maxRetries: 3 });
    // First call: 500, second call: success
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Error', json: async () => ({ message: 'fail' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => makeResponse() });

    const result = await provider.generate({
      messages: [{ role: 'user', content: 'test' }],
    });

    expect(result.data).toEqual({ status: 'ok' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('maps timeout error correctly', async () => {
    const provider = new DeepSeekProvider({ maxRetries: 1 });
    const timeoutErr = new Error('The operation was aborted');
    timeoutErr.name = 'AbortError';
    mockFetch.mockRejectedValue(timeoutErr);

    try {
      await provider.generate({ messages: [{ role: 'user', content: 'test' }] });
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).code).toBe(AIProviderErrorCode.TIMEOUT);
    }
  });

  it('maps network error correctly', async () => {
    const provider = new DeepSeekProvider({ maxRetries: 1 });
    mockFetch.mockRejectedValue(new Error('fetch failed'));

    try {
      await provider.generate({ messages: [{ role: 'user', content: 'test' }] });
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).code).toBe(AIProviderErrorCode.NETWORK_ERROR);
    }
  });
});

describe('DeepSeekProvider – Capabilities', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports correct capabilities', () => {
    const provider = new DeepSeekProvider();
    expect(provider.capabilities.structuredOutput).toBe(true);
    expect(provider.capabilities.strictStructuredOutput).toBe(false);
    expect(provider.capabilities.streaming).toBe(false);
  });

  it('supportsStructuredOutput returns true', () => {
    const provider = new DeepSeekProvider();
    expect(provider.supportsStructuredOutput()).toBe(true);
  });
});

describe('DeepSeekProvider – Security', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubEnv('DEEPSEEK_API_KEY', 'super-secret-key-xyz');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not leak API key in error messages', async () => {
    const provider = new DeepSeekProvider({ maxRetries: 1 });
    mockErrorResponse(500, { message: 'Internal error' });

    try {
      await provider.generate({ messages: [{ role: 'user', content: 'test' }] });
    } catch (err) {
      const errorMsg = (err as Error).message;
      expect(errorMsg).not.toContain('super-secret-key-xyz');
    }
  });

  it('does not include API key in request body', async () => {
    const provider = new DeepSeekProvider({ apiKey: 'my-secret-api-key' });
    mockOkResponse();

    await provider.generate({
      messages: [{ role: 'user', content: 'test' }],
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const bodyStr = JSON.stringify(callBody);
    expect(bodyStr).not.toContain('my-secret-api-key');
  });
});

describe('DeepSeekProvider – JSON output', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses valid JSON response with responseSchema', async () => {
    const provider = new DeepSeekProvider();
    mockOkResponse(makeResponse({
      choices: [{ message: { content: '{"name":"test","value":42}' }, finish_reason: 'stop' }],
    }));

    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        value: { type: 'number' },
      },
      required: ['name', 'value'],
    };

    const result = await provider.generate<{ name: string; value: number }>({
      messages: [{ role: 'user', content: 'test' }],
      responseSchema: schema,
    });

    expect(result.data).toEqual({ name: 'test', value: 42 });
  });

  it('handles invalid JSON in response', async () => {
    const provider = new DeepSeekProvider();
    mockOkResponse(makeResponse({
      choices: [{ message: { content: '{invalid json}' }, finish_reason: 'stop' }],
    }));

    await expect(provider.generate({
      messages: [{ role: 'user', content: 'test' }],
      responseSchema: { type: 'object' },
    })).rejects.toThrow(/not valid JSON/);
  });
});
