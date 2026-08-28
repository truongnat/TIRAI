import { describe, it, expect } from 'vitest';
import { sanitizePayload, sanitizeForJournal } from '../src/sanitization.js';

describe('sanitization', () => {
  describe('sanitizePayload', () => {
    it('detects secret sentinel values', () => {
      const payload = {
        config: {
          apiKey: 'OPENAI_SECRET_SENTINEL',
          password: 'DB_PASSWORD_SENTINEL',
        },
      };

      const result = sanitizePayload(payload);

      expect(result.secretLeakCount).toBe(2);
      expect(result.leaksFound.length).toBe(2);
    });

    it('redacts sensitive keys', () => {
      const payload = {
        data: {
          password: 'secret123',
          token: 'abc123',
          normalField: 'safe',
        },
      };

      const result = sanitizePayload(payload);

      expect(result.secretLeakCount).toBeGreaterThan(0);
      expect((result.sanitized as any).data.password).toBe('***REDACTED***');
      expect((result.sanitized as any).data.token).toBe('***REDACTED***');
      expect((result.sanitized as any).data.normalField).toBe('safe');
    });

    it('redacts patterns in strings', () => {
      const payload = {
        log: 'User logged in with password="secret123"',
      };

      const result = sanitizePayload(payload);

      expect((result.sanitized as any).log).toContain('***REDACTED***');
    });

    it('handles nested objects', () => {
      const payload = {
        level1: {
          level2: {
            secret: 'OPENAI_SECRET_SENTINEL',
          },
        },
      };

      const result = sanitizePayload(payload);

      expect(result.secretLeakCount).toBeGreaterThan(0);
    });

    it('handles arrays', () => {
      const payload = {
        items: [
          { token: 'abc123' },
          { password: 'secret' },
        ],
      };

      const result = sanitizePayload(payload);

      expect(result.secretLeakCount).toBe(2);
    });

    it('returns clean result for safe payload', () => {
      const payload = {
        data: {
          normalField: 'safe value',
          count: 42,
        },
      };

      const result = sanitizePayload(payload);

      expect(result.secretLeakCount).toBe(0);
      expect(result.leaksFound).toHaveLength(0);
    });
  });

  describe('sanitizeForJournal', () => {
    it('redacts sensitive fields', () => {
      const entry = {
        id: 'test_001',
        password: 'secret123',
        token: 'abc123',
        status: 'delivered',
      };

      const result = sanitizeForJournal(entry);

      expect(result.password).toBe('***REDACTED***');
      expect(result.token).toBe('***REDACTED***');
      expect(result.status).toBe('delivered');
    });
  });
});
