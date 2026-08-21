// ---------------------------------------------------------------------------
// Chunk analysis prompt – builds user message for Pass 1
// ---------------------------------------------------------------------------

import type { ContextChunk } from '../persistence/loader.js';

/**
 * Build the user message for chunk-level semantic analysis.
 *
 * The message includes the chunk content and explicit instructions
 * about provenance and local IDs.
 */
export function buildChunkAnalysisPrompt(chunk: ContextChunk): string {
  const parts: string[] = [];

  parts.push(`Analyze the following document context chunk and extract semantic information.`);
  parts.push('');
  parts.push(`Context ID: ${chunk.id}`);
  parts.push(`Sheet: ${chunk.sheet.name} (index: ${chunk.sheet.index})`);
  parts.push(`Range: ${chunk.range ?? 'N/A'}`);
  parts.push(`Type: ${chunk.type}`);

  if (chunk.layoutHints?.headerRows && chunk.layoutHints.headerRows.length > 0) {
    parts.push(`Header rows: ${chunk.layoutHints.headerRows.join(', ')}`);
  }

  parts.push('');
  parts.push('--- BEGIN CONTEXT CONTENT ---');
  parts.push(chunk.content);
  parts.push('--- END CONTEXT CONTENT ---');
  parts.push('');

  parts.push('Instructions:');
  parts.push(`1. Set contextId to "${chunk.id}" in your response.`);
  parts.push('2. Extract sections, entities, flows, rules, relationships, and unresolved items from this content.');
  parts.push('3. Use local IDs: "local-section-001", "local-entity-001", "local-flow-001", "local-rule-001", etc.');
  parts.push(`4. For provenance, use contextId="${chunk.id}", sheet="${chunk.sheet.name}".`);
  parts.push('5. Include ranges or cells from the source that support each extracted object.');
  parts.push('6. If something is ambiguous, add it to unresolved instead of guessing.');
  parts.push('7. Relationships within this chunk should reference local IDs of entities found in this same chunk.');
  parts.push('8. Do not invent information not present in the context.');

  return parts.join('\n');
}
