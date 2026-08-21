// ---------------------------------------------------------------------------
// Consolidation prompt – builds user message for Pass 2
// ---------------------------------------------------------------------------

import type { ChunkSemanticResult } from '../models.js';

/**
 * Build the user message for global consolidation (Pass 2).
 *
 * Provides a summary of all chunk-level extractions so the AI can
 * identify merge candidates and cross-chunk relationships.
 */
export function buildConsolidationPrompt(
  chunkResults: ChunkSemanticResult[],
  sheetNames: string[],
): string {
  const parts: string[] = [];

  parts.push('You have analyzed multiple document chunks independently.');
  parts.push('Now consolidate the results into a unified semantic model.');
  parts.push('');
  parts.push(`Document sheets: ${sheetNames.join(', ')}`);
  parts.push(`Chunks analyzed: ${chunkResults.length}`);
  parts.push('');

  // Summarize each chunk's extractions
  for (const result of chunkResults) {
    parts.push(`--- Chunk: ${result.contextId} ---`);

    if (result.entities.length > 0) {
      parts.push(`Entities (${result.entities.length}):`);
      for (const e of result.entities) {
        const aliases = e.aliases?.length ? ` [aliases: ${e.aliases.join(', ')}]` : '';
        parts.push(`  - ${e.localId}: "${e.name}" (${e.type})${aliases}`);
      }
    }

    if (result.flows.length > 0) {
      parts.push(`Flows (${result.flows.length}):`);
      for (const f of result.flows) {
        parts.push(`  - ${f.localId}: "${f.name}" (${f.steps.length} steps)`);
      }
    }

    if (result.rules.length > 0) {
      parts.push(`Rules (${result.rules.length}):`);
      for (const r of result.rules) {
        parts.push(`  - ${r.localId}: [${r.type}] "${truncate(r.statement, 80)}"`);
      }
    }

    if (result.relationships.length > 0) {
      parts.push(`Relationships (${result.relationships.length}):`);
      for (const rel of result.relationships) {
        parts.push(`  - ${rel.localId}: ${rel.sourceLocalId} --[${rel.type}]--> ${rel.targetLocalId}`);
      }
    }

    if (result.sections.length > 0) {
      parts.push(`Sections (${result.sections.length}):`);
      for (const s of result.sections) {
        parts.push(`  - ${s.localId}: "${s.title}"${s.type ? ` (${s.type})` : ''}`);
      }
    }

    if (result.unresolved.length > 0) {
      parts.push(`Unresolved (${result.unresolved.length}):`);
      for (const u of result.unresolved) {
        parts.push(`  - ${u.localId}: [${u.type}] "${truncate(u.description, 80)}"`);
      }
    }

    parts.push('');
  }

  parts.push('Your tasks:');
  parts.push('1. Identify entities from different chunks that represent the SAME concept (merge candidates).');
  parts.push('   - Only merge when names/aliases/types clearly match.');
  parts.push('   - Do NOT merge entities that merely share a common word.');
  parts.push('2. Identify cross-chunk relationships supported by evidence.');
  parts.push('   - Reference entities by their local IDs (e.g. "ctx-s000-c000:local-entity-001").');
  parts.push('   - Only create relationships when the context supports them.');
  parts.push('3. Provide a document-level summary if possible.');
  parts.push('4. Do not invent relationships or merges without evidence.');

  return parts.join('\n');
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
