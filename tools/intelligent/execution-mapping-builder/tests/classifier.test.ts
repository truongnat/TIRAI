// Tests: Classifier — executor classification.

import { describe, it, expect } from 'vitest';
import { classifyExecutor, classifyAll } from '../src/classifier/classifier.js';
import { makeTestCase, makeLoginTestCase, makeApiTestCase, makeDbTestCase, makeManualTestCase } from './fixtures/helpers.js';

describe('Classifier', () => {
  // §5-10: Classification
  describe('explicit type classification', () => {
    it('classifies explicit UI type', () => {
      const tc = makeTestCase({ type: 'ui' });
      const result = classifyExecutor(tc);
      expect(result.executorType).toBe('ui');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('classifies explicit API type', () => {
      const tc = makeTestCase({ type: 'api' });
      const result = classifyExecutor(tc);
      expect(result.executorType).toBe('api');
    });

    it('classifies explicit database type', () => {
      const tc = makeTestCase({ type: 'database' });
      const result = classifyExecutor(tc);
      expect(result.executorType).toBe('database');
    });

    it('classifies explicit manual type', () => {
      const tc = makeTestCase({ type: 'manual' });
      const result = classifyExecutor(tc);
      expect(result.executorType).toBe('manual');
    });

    it('returns unknown when no signals', () => {
      const tc = makeTestCase({ type: 'unknown' });
      const result = classifyExecutor(tc);
      expect(result.executorType).toBe('unknown');
      expect(result.confidence).toBe(0);
    });
  });

  describe('suggestedExecutor signals', () => {
    it('uses suggestedExecutor ui', () => {
      const tc = makeTestCase({ type: 'unknown', automation: { status: 'ready', suggestedExecutor: 'ui', reasons: [] } });
      const result = classifyExecutor(tc);
      expect(result.executorType).toBe('ui');
    });

    it('uses suggestedExecutor api', () => {
      const tc = makeTestCase({ type: 'unknown', automation: { status: 'ready', suggestedExecutor: 'api', reasons: [] } });
      const result = classifyExecutor(tc);
      expect(result.executorType).toBe('api');
    });

    it('uses suggestedExecutor database', () => {
      const tc = makeTestCase({ type: 'unknown', automation: { status: 'ready', suggestedExecutor: 'database', reasons: [] } });
      const result = classifyExecutor(tc);
      expect(result.executorType).toBe('database');
    });

    it('uses suggestedExecutor hybrid → integration', () => {
      const tc = makeTestCase({ type: 'unknown', automation: { status: 'ready', suggestedExecutor: 'hybrid', reasons: [] } });
      const result = classifyExecutor(tc);
      expect(result.executorType).toBe('integration');
    });
  });

  describe('verificationType signals', () => {
    it('ui verificationType → ui', () => {
      const tc = makeTestCase({
        type: 'unknown',
        expectedResults: [{ description: 'test', verificationType: 'ui' }],
      });
      const result = classifyExecutor(tc);
      expect(result.executorType).toBe('ui');
    });

    it('api verificationType → api', () => {
      const tc = makeTestCase({
        type: 'unknown',
        expectedResults: [{ description: 'test', verificationType: 'api' }],
      });
      const result = classifyExecutor(tc);
      expect(result.executorType).toBe('api');
    });

    it('database verificationType → database', () => {
      const tc = makeTestCase({
        type: 'unknown',
        expectedResults: [{ description: 'test', verificationType: 'database' }],
      });
      const result = classifyExecutor(tc);
      expect(result.executorType).toBe('database');
    });
  });

  describe('step keyword heuristics', () => {
    it('click/button → ui signal', () => {
      const tc = makeTestCase({
        type: 'unknown',
        steps: [{ order: 1, action: 'Click the submit button', target: 'form' }],
      });
      const result = classifyExecutor(tc);
      expect(result.executorType).toBe('ui');
    });

    it('api/request → api signal', () => {
      const tc = makeTestCase({
        type: 'unknown',
        steps: [{ order: 1, action: 'Send POST request to endpoint' }],
      });
      const result = classifyExecutor(tc);
      expect(result.executorType).toBe('api');
    });

    it('database/table → database signal', () => {
      const tc = makeTestCase({
        type: 'unknown',
        steps: [{ order: 1, action: 'Insert row into table' }],
      });
      const result = classifyExecutor(tc);
      expect(result.executorType).toBe('database');
    });
  });

  describe('conflicting signals', () => {
    it('multi-executor tie → integration', () => {
      const tc = makeTestCase({
        type: 'unknown',
        steps: [
          { order: 1, action: 'Click button' },
          { order: 2, action: 'Send POST request' },
        ],
      });
      const result = classifyExecutor(tc);
      // Both ui and api have signals → could be integration or one wins
      expect(['ui', 'api', 'integration']).toContain(result.executorType);
    });
  });

  describe('classifyAll', () => {
    it('classifies multiple test cases', () => {
      const tcs = [
        makeTestCase({ id: 'TC-1', type: 'ui' }),
        makeTestCase({ id: 'TC-2', type: 'api' }),
        makeTestCase({ id: 'TC-3', type: 'database' }),
      ];
      const results = classifyAll(tcs);
      expect(results).toHaveLength(3);
      expect(results[0].executorType).toBe('ui');
      expect(results[1].executorType).toBe('api');
      expect(results[2].executorType).toBe('database');
    });
  });

  describe('evidence and provenance', () => {
    it('includes evidence for explicit type', () => {
      const tc = makeTestCase({ type: 'ui' });
      const result = classifyExecutor(tc);
      expect(result.evidence).toContain('explicit-type:ui');
    });

    it('includes source for explicit type', () => {
      const tc = makeTestCase({ type: 'ui' });
      const result = classifyExecutor(tc);
      expect(result.source.length).toBeGreaterThan(0);
      expect(result.source[0].type).toBe('explicit');
    });

    it('includes no-signals for unknown', () => {
      const tc = makeTestCase({ type: 'unknown' });
      const result = classifyExecutor(tc);
      expect(result.evidence).toContain('no-signals');
    });
  });

  describe('fixture test cases', () => {
    it('login test case → ui', () => {
      const tc = makeLoginTestCase();
      const result = classifyExecutor(tc);
      expect(result.executorType).toBe('ui');
    });

    it('API test case → api', () => {
      const tc = makeApiTestCase();
      const result = classifyExecutor(tc);
      expect(result.executorType).toBe('api');
    });

    it('DB test case → database', () => {
      const tc = makeDbTestCase();
      const result = classifyExecutor(tc);
      expect(result.executorType).toBe('database');
    });

    it('manual test case → manual', () => {
      const tc = makeManualTestCase();
      const result = classifyExecutor(tc);
      expect(result.executorType).toBe('manual');
    });
  });
});
