import { describe, it, expect, beforeAll } from 'vitest';
import { MarkdownSourceConnector } from '../src/markdown-connector.js';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Phase 4B.1 — Markdown position-shift acceptance', () => {
  const tmpDir = join(tmpdir(), 'tirai-phase4b1-test');
  const connector = new MarkdownSourceConnector();

  beforeAll(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  it('block identity is stable across revisions with same content', async () => {
    // Revision A
    const contentA = `# Orders

Block A content here

## Cancellation

Business rule B

Business rule C`;

    // Revision B: new block inserted, Block A moves down
    const contentB = `# Orders

NEW unrelated block inserted here

Block A content here

## Cancellation

Business rule B

Business rule C`;

    const pathA = join(tmpDir, 'revision-a.md');
    const pathB = join(tmpDir, 'revision-b.md');

    await writeFile(pathA, contentA, 'utf8');
    await writeFile(pathB, contentB, 'utf8');

    try {
      const docA = await connector.open({ path: pathA });
      const docB = await connector.open({ path: pathB });

      // Find the content block for "Block A content here"
      const blockA_A = docA.contexts.find(c => c.content.includes('Block A content here'));
      const blockA_B = docB.contexts.find(c => c.content.includes('Block A content here'));

      expect(blockA_A).toBeDefined();
      expect(blockA_B).toBeDefined();

      // Content hash should be identical (content hasn't changed)
      expect(blockA_A!.contentHash).toBe(blockA_B!.contentHash);

      // Find the content blocks for "Business rule B" and "Business rule C"
      const ruleB_A = docA.contexts.find(c => c.content.includes('Business rule B'));
      const ruleB_B = docB.contexts.find(c => c.content.includes('Business rule B'));
      const ruleC_A = docA.contexts.find(c => c.content.includes('Business rule C'));
      const ruleC_B = docB.contexts.find(c => c.content.includes('Business rule C'));

      expect(ruleB_A).toBeDefined();
      expect(ruleB_B).toBeDefined();
      expect(ruleC_A).toBeDefined();
      expect(ruleC_B).toBeDefined();

      // Content hashes should be stable
      expect(ruleB_A!.contentHash).toBe(ruleB_B!.contentHash);
      expect(ruleC_A!.contentHash).toBe(ruleC_B!.contentHash);

      // Verify new block is detected as added
      const newBlock_B = docB.contexts.find(c => c.content.includes('NEW unrelated block'));
      expect(newBlock_B).toBeDefined();
      expect(newBlock_B!.contentHash).not.toBe(blockA_A!.contentHash);
    } finally {
      await unlink(pathA).catch(() => {});
      await unlink(pathB).catch(() => {});
    }
  });

  it('no mass churn when only position changes', async () => {
    const contentA = `# Section 1

First block

Second block`;

    const contentB = `# Section 1

NEW block inserted here

First block

Second block`;

    const pathA = join(tmpDir, 'churn-a.md');
    const pathB = join(tmpDir, 'churn-b.md');

    await writeFile(pathA, contentA, 'utf8');
    await writeFile(pathB, contentB, 'utf8');

    try {
      const docA = await connector.open({ path: pathA });
      const docB = await connector.open({ path: pathB });

      // Count contexts in each
      const contextsA = docA.contexts.length;
      const contextsB = docB.contexts.length;

      // Only 1 new context should be added, not mass churn
      expect(contextsB - contextsA).toBe(1);

      // Existing content blocks should maintain content hashes
      const firstBlock_A = docA.contexts.find(c => c.content.includes('First block'));
      const firstBlock_B = docB.contexts.find(c => c.content.includes('First block'));
      expect(firstBlock_A!.contentHash).toBe(firstBlock_B!.contentHash);

      const secondBlock_A = docA.contexts.find(c => c.content.includes('Second block'));
      const secondBlock_B = docB.contexts.find(c => c.content.includes('Second block'));
      expect(secondBlock_A!.contentHash).toBe(secondBlock_B!.contentHash);
    } finally {
      await unlink(pathA).catch(() => {});
      await unlink(pathB).catch(() => {});
    }
  });
});
