// ---------------------------------------------------------------------------
// GroqProvider tests – mocked Groq SDK (no real API calls)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GroqProvider } from '../src/providers/groq/groq-provider.js';
import { AIProviderError, AIProviderErrorCode } from '../src/errors.js';
import type { GroqRawResponse } from '../src/providers/groq/groq-mapper.js';

// Shared mock function – accessible across all test cases
const mockCreate = vi.fn();

// Mock the Groq SDK to return our shared mock
vi.mock('groq-sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}));

function makeResponse(overrides: Partial<GroqRawResponse> = {}): GroqRawResponse {
  return {
    id: 'chatcmpl-test-001',
    model: 'openai/gpt-oss-120b',
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

describe('GroqProvider – Configuration', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    vi.stubEnv('GROQ_API_KEY', 'test-key-123');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates provider with valid config', () => {
    const provider = new GroqProvider({ apiKey: 'explicit-key' });
    expect(provider.name).toBe('groq');
  });

  it('throws CONFIG_ERROR when API key is missing', () => {
    vi.unstubAllEnvs();
    expect(() => new GroqProvider()).toThrow(/GROQ_API_KEY/);
    try {
      new GroqProvider();
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).code).toBe(AIProviderErrorCode.CONFIG_ERROR);
    }
  });

  it('uses default model when none specified', async () => {
    const provider = new GroqProvider();
    mockCreate.mockResolvedValue(makeResponse());

    await provider.generate({
      messages: [{ role: 'user', content: 'test' }],
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('openai/gpt-oss-120b');
  });

  it('uses custom model when specified', async () => {
    const provider = new GroqProvider({ model: 'llama-3.3-70b-versatile' });
    mockCreate.mockResolvedValue(makeResponse());

    await provider.generate({
      messages: [{ role: 'user', content: 'test' }],
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('llama-3.3-70b-versatile');
  });

  it('allows per-request model override', async () => {
    const provider = new GroqProvider();
    mockCreate.mockResolvedValue(makeResponse());

    await provider.generate({
      model: 'custom-model',
      messages: [{ role: 'user', content: 'test' }],
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('custom-model');
  });
});

describe('GroqProvider – Request mapping', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    vi.stubEnv('GROQ_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('maps system + user messages correctly', async () => {
    const provider = new GroqProvider();
    mockCreate.mockResolvedValue(makeResponse());

    await provider.generate({
      messages: [
        { role: 'system', content: 'You are a helper.' },
        { role: 'user', content: 'Hello' },
      ],
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages).toEqual([
      { role: 'system', content: 'You are a helper.' },
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('sets temperature and max_tokens', async () => {
    const provider = new GroqProvider();
    mockCreate.mockResolvedValue(makeResponse());

    await provider.generate({
      messages: [{ role: 'user', content: 'test' }],
      temperature: 0.5,
      maxOutputTokens: 1000,
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.temperature).toBe(0.5);
    expect(callArgs.max_tokens).toBe(1000);
  });

  it('injects schema instruction and json_object format when responseSchema is set', async () => {
    const provider = new GroqProvider();
    mockCreate.mockResolvedValue(makeResponse());

    const schema = {
      type: 'object',
      properties: { status: { type: 'string' } },
      required: ['status'],
    };

    await provider.generate({
      messages: [{ role: 'user', content: 'test' }],
      responseSchema: schema,
    });

    const callArgs = mockCreate.mock.calls[0][0];
    // First message should be the schema instruction
    expect(callArgs.messages[0].role).toBe('system');
    expect(callArgs.messages[0].content).toContain('JSON Schema');
    // response_format should be json_object
    expect(callArgs.response_format).toEqual({ type: 'json_object' });
  });

  it('does NOT set response_format when no schema is provided', async () => {
    const provider = new GroqProvider();
    mockCreate.mockResolvedValue(makeResponse());

    await provider.generate({
      messages: [{ role: 'user', content: 'test' }],
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.response_format).toBeUndefined();
  });
});

describe('GroqProvider – Response handling', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    vi.stubEnv('GROQ_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns valid JSON response with parsed data', async () => {
    const provider = new GroqProvider();
    mockCreate.mockResolvedValue(makeResponse());

    const result = await provider.generate<{ status: string }>({
      messages: [{ role: 'user', content: 'test' }],
    });

    expect(result.provider).toBe('groq');
    expect(result.model).toBe('openai/gpt-oss-120b');
    expect(result.data).toEqual({ status: 'ok' });
    expect(result.rawText).toBe('{"status":"ok"}');
    expect(result.finishReason).toBe('stop');
    expect(result.requestId).toBe('chatcmpl-test-001');
  });

  it('maps usage metadata correctly', async () => {
    const provider = new GroqProvider();
    mockCreate.mockResolvedValue(makeResponse());

    const result = await provider.generate({
      messages: [{ role: 'user', content: 'test' }],
    });

    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    });
  });

  it('throws RESPONSE_EMPTY on empty content', async () => {
    const provider = new GroqProvider();
    mockCreate.mockResolvedValue(makeResponse({
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
    }));

    await expect(provider.generate({
      messages: [{ role: 'user', content: 'test' }],
    })).rejects.toThrow(/empty response/);
  });

  it('throws RESPONSE_EMPTY on null content', async () => {
    const provider = new GroqProvider();
    mockCreate.mockResolvedValue(makeResponse({
      choices: [{ message: { content: null }, finish_reason: 'stop' }],
    }));

    await expect(provider.generate({
      messages: [{ role: 'user', content: 'test' }],
    })).rejects.toThrow(/empty response/);
  });

  it('throws RESPONSE_PARSE_ERROR on invalid JSON', async () => {
    const provider = new GroqProvider();
    mockCreate.mockResolvedValue(makeResponse({
      choices: [{ message: { content: 'not json' }, finish_reason: 'stop' }],
    }));

    await expect(provider.generate({
      messages: [{ role: 'user', content: 'test' }],
      responseSchema: { type: 'object' },
    })).rejects.toThrow(/not valid JSON/);
  });

  it('throws RESPONSE_SCHEMA_ERROR on schema mismatch', async () => {
    const provider = new GroqProvider();
    mockCreate.mockResolvedValue(makeResponse({
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

describe('GroqProvider – Error mapping', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    vi.stubEnv('GROQ_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('maps 401 to AUTH_ERROR', async () => {
    const provider = new GroqProvider();
    mockCreate.mockRejectedValue({ status: 401, error: { message: 'Invalid key' } });

    await expect(provider.generate({
      messages: [{ role: 'user', content: 'test' }],
    })).rejects.toThrow(/Authentication failed/);
  });

  it('maps 400 to BAD_REQUEST (non-retryable)', async () => {
    const provider = new GroqProvider({ maxRetries: 1 });
    mockCreate.mockRejectedValue({ status: 400, error: { message: 'Bad input' } });

    try {
      await provider.generate({ messages: [{ role: 'user', content: 'test' }] });
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).code).toBe(AIProviderErrorCode.BAD_REQUEST);
      expect((err as AIProviderError).retryable).toBe(false);
    }
  });

  it('maps 429 to RATE_LIMITED (retryable)', async () => {
    const provider = new GroqProvider({ maxRetries: 1 });
    mockCreate.mockRejectedValue({ status: 429, error: { message: 'Too many requests' } });

    try {
      await provider.generate({ messages: [{ role: 'user', content: 'test' }] });
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).code).toBe(AIProviderErrorCode.RATE_LIMITED);
      expect((err as AIProviderError).retryable).toBe(true);
    }
  });

  it('maps 500 to PROVIDER_UNAVAILABLE (retryable)', async () => {
    const provider = new GroqProvider({ maxRetries: 1 });
    mockCreate.mockRejectedValue({ status: 500, error: { message: 'Internal error' } });

    try {
      await provider.generate({ messages: [{ role: 'user', content: 'test' }] });
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).code).toBe(AIProviderErrorCode.PROVIDER_UNAVAILABLE);
      expect((err as AIProviderError).retryable).toBe(true);
    }
  });

  it('maps timeout error correctly', async () => {
    const provider = new GroqProvider({ maxRetries: 1 });
    const timeoutErr = new Error('Request timeout');
    timeoutErr.name = 'AbortError';
    mockCreate.mockRejectedValue(timeoutErr);

    try {
      await provider.generate({ messages: [{ role: 'user', content: 'test' }] });
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).code).toBe(AIProviderErrorCode.TIMEOUT);
    }
  });

  it('maps network error correctly', async () => {
    const provider = new GroqProvider({ maxRetries: 1 });
    mockCreate.mockRejectedValue(new Error('fetch failed'));

    try {
      await provider.generate({ messages: [{ role: 'user', content: 'test' }] });
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).code).toBe(AIProviderErrorCode.NETWORK_ERROR);
    }
  });
});

describe('GroqProvider – Capabilities', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    vi.stubEnv('GROQ_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports correct capabilities', () => {
    const provider = new GroqProvider();
    expect(provider.capabilities.structuredOutput).toBe(true);
    expect(provider.capabilities.strictStructuredOutput).toBe(false);
    expect(provider.capabilities.streaming).toBe(false);
  });

  it('supportsStructuredOutput returns true', () => {
    const provider = new GroqProvider();
    expect(provider.supportsStructuredOutput()).toBe(true);
  });
});

describe('GroqProvider – Deterministic request construction', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    vi.stubEnv('GROQ_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('produces identical request bodies for identical inputs', async () => {
    const provider = new GroqProvider();
    mockCreate.mockResolvedValue(makeResponse());

    const request = {
      messages: [
        { role: 'system' as const, content: 'You are a helper.' },
        { role: 'user' as const, content: 'Analyze this data.' },
      ],
      temperature: 0,
    };

    await provider.generate(request);
    const firstCall = JSON.parse(JSON.stringify(mockCreate.mock.calls[0][0]));

    mockCreate.mockClear();
    mockCreate.mockResolvedValue(makeResponse());

    await provider.generate(request);
    const secondCall = JSON.parse(JSON.stringify(mockCreate.mock.calls[0][0]));

    expect(firstCall).toEqual(secondCall);
  });
});
