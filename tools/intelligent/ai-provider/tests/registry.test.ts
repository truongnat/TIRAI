// ---------------------------------------------------------------------------
// FakeProvider + Registry tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeAIProvider } from '../src/fake-provider.js';
import { createAIProvider, registerProvider, listProviders } from '../src/registry.js';
import { AIProviderError, AIProviderErrorCode } from '../src/errors.js';

// ---- FakeProvider ---------------------------------------------------------

describe('FakeAIProvider', () => {
  it('returns static response', async () => {
    const fake = new FakeAIProvider({ response: { status: 'ok' } });
    const result = await fake.generate({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(result.data).toEqual({ status: 'ok' });
    expect(result.provider).toBe('fake');
    expect(result.model).toBe('fake-model');
    expect(result.finishReason).toBe('stop');
  });

  it('supports queued responses', async () => {
    const fake = new FakeAIProvider({
      responses: [{ a: 1 }, { a: 2 }, { a: 3 }],
    });

    const r1 = await fake.generate({ messages: [{ role: 'user', content: '1' }] });
    const r2 = await fake.generate({ messages: [{ role: 'user', content: '2' }] });
    const r3 = await fake.generate({ messages: [{ role: 'user', content: '3' }] });

    expect(r1.data).toEqual({ a: 1 });
    expect(r2.data).toEqual({ a: 2 });
    expect(r3.data).toEqual({ a: 3 });
  });

  it('throws when queue is exhausted', async () => {
    const fake = new FakeAIProvider({ response: { status: 'ok' } });
    await fake.generate({ messages: [{ role: 'user', content: 'test' }] });

    await expect(
      fake.generate({ messages: [{ role: 'user', content: 'test' }] }),
    ).rejects.toThrow('no more responses');
  });

  it('simulates errors', async () => {
    const fake = new FakeAIProvider({
      error: new AIProviderError({
        code: AIProviderErrorCode.AUTH_ERROR,
        provider: 'fake',
        message: 'Simulated auth error',
      }),
    });

    await expect(
      fake.generate({ messages: [{ role: 'user', content: 'test' }] }),
    ).rejects.toThrow('Simulated auth error');
  });

  it('logs requests for assertion', async () => {
    const fake = new FakeAIProvider({ response: { ok: true } });
    await fake.generate({
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.5,
    });

    expect(fake.requestLog).toHaveLength(1);
    expect(fake.requestLog[0].messages[0].content).toBe('hello');
    expect(fake.requestLog[0].temperature).toBe(0.5);
  });

  it('validates response against schema when provided', async () => {
    const fake = new FakeAIProvider({ response: { status: 'ok' } });
    const schema = {
      type: 'object',
      properties: { status: { type: 'string' } },
      required: ['status'],
    };

    const result = await fake.generate({
      messages: [{ role: 'user', content: 'test' }],
      responseSchema: schema,
    });
    expect(result.data).toEqual({ status: 'ok' });
  });

  it('throws schema error when response does not match', async () => {
    const fake = new FakeAIProvider({ response: { wrong: 'field' } });
    const schema = {
      type: 'object',
      properties: { status: { type: 'string' } },
      required: ['status'],
      additionalProperties: false,
    };

    await expect(
      fake.generate({
        messages: [{ role: 'user', content: 'test' }],
        responseSchema: schema,
      }),
    ).rejects.toThrow(/does not match schema/);
  });

  it('reports custom capabilities', async () => {
    const fake = new FakeAIProvider({
      response: {},
      capabilities: { structuredOutput: false, strictStructuredOutput: false, streaming: true },
    });
    expect(fake.capabilities.structuredOutput).toBe(false);
    expect(fake.capabilities.streaming).toBe(true);
  });

  it('returns usage metadata when configured', async () => {
    const fake = new FakeAIProvider({
      response: { ok: true },
      usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
    });
    const result = await fake.generate({ messages: [{ role: 'user', content: 'test' }] });
    expect(result.usage).toEqual({ inputTokens: 50, outputTokens: 10, totalTokens: 60 });
  });
});

// ---- Registry -------------------------------------------------------------

describe('Provider Registry', () => {
  beforeEach(() => {
    vi.stubEnv('GROQ_API_KEY', 'test-key');
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-ds-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates Groq provider via factory', () => {
    const provider = createAIProvider({ provider: 'groq' });
    expect(provider.name).toBe('groq');
  });

  it('creates DeepSeek provider via factory', () => {
    const provider = createAIProvider({ provider: 'deepseek' });
    expect(provider.name).toBe('deepseek');
  });

  it('creates DeepSeek provider with config', () => {
    const provider = createAIProvider({
      provider: 'deepseek',
      config: { model: 'deepseek-v4-flash' },
    });
    expect(provider.name).toBe('deepseek');
  });

  it('creates Groq provider with config', () => {
    const provider = createAIProvider({
      provider: 'groq',
      config: { model: 'llama-3.3-70b-versatile' },
    });
    expect(provider.name).toBe('groq');
  });

  it('throws CONFIG_ERROR for unknown provider', () => {
    expect(() => createAIProvider({ provider: 'nonexistent' }))
      .toThrow(/Unknown provider/);
  });

  it('lists registered providers', () => {
    const providers = listProviders();
    expect(providers).toContain('groq');
    expect(providers).toContain('deepseek');
  });

  it('allows registering custom providers', () => {
    const customFake = new FakeAIProvider({ response: { custom: true } });
    registerProvider('custom-test', () => customFake);
    const provider = createAIProvider({ provider: 'custom-test' });
    expect(provider.name).toBe('fake');
    expect(listProviders()).toContain('custom-test');
  });
});
