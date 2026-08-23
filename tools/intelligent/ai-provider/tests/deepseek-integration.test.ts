// ---------------------------------------------------------------------------
// Integration test – live DeepSeek API (opt-in)
// ---------------------------------------------------------------------------
// Run with: RUN_DEEPSEEK_INTEGRATION=true DEEPSEEK_API_KEY=... npx vitest run
// Skips automatically if env vars are not set.

import { describe, it, expect } from 'vitest';
import { DeepSeekProvider } from '../src/providers/deepseek/deepseek-provider.js';

const RUN_INTEGRATION = process.env.RUN_DEEPSEEK_INTEGRATION === 'true';
const HAS_API_KEY = !!process.env.DEEPSEEK_API_KEY;

describe.skipIf(!RUN_INTEGRATION || !HAS_API_KEY)('DeepSeekProvider – Integration', () => {
  it('returns structured output for simple prompt', async () => {
    const provider = new DeepSeekProvider();

    const schema = {
      type: 'object',
      properties: {
        status: { type: 'string' },
      },
      required: ['status'],
      additionalProperties: false,
    };

    const result = await provider.generate<{ status: string }>({
      messages: [
        { role: 'system', content: 'You return structured JSON only.' },
        { role: 'user', content: 'Return status = "ok".' },
      ],
      responseSchema: schema,
      temperature: 0,
    });

    expect(result.data.status).toBe('ok');
    expect(result.provider).toBe('deepseek');
    expect(result.usage?.totalTokens).toBeGreaterThan(0);
  }, 30000);
});
