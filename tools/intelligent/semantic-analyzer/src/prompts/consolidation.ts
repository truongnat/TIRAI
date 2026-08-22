// ---------------------------------------------------------------------------
// Consolidation prompt – builds user message for Pass 2
// ---------------------------------------------------------------------------
// v1.1: Expanded beyond simple dedup to include cross-chunk flow composition,
// rule identification, and relationship detection.

import type { ChunkSemanticResult } from '../models.js';

/**
 * Build the user message for global consolidation (Pass 2).
 *
 * Provides a summary of all chunk-level extractions so the AI can:
 * 1. Identify merge candidates (same concept across chunks)
 * 2. Compose cross-chunk flows from fragments
 * 3. Identify cross-chunk rules supported by evidence
 * 4. Identify cross-chunk relationships with explicit evidence
 * 5. Provide a document-level summary
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
        const desc = e.description ? ` — ${e.description}` : '';
        parts.push(`  - ${e.localId}: "${e.name}" (${e.type})${aliases}${desc}`);
      }
    }

    if (result.flows.length > 0) {
      parts.push(`Flows (${result.flows.length}):`);
      for (const f of result.flows) {
        parts.push(`  - ${f.localId}: "${f.name}" (${f.steps.length} steps)`);
        for (const step of f.steps) {
          const actor = step.actor ? ` [actor: ${step.actor}]` : '';
          parts.push(`    step ${step.order}: ${step.action}${actor}`);
        }
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

  // ---- Consolidation tasks ------------------------------------------------
  parts.push('## YOUR CONSOLIDATION TASKS');
  parts.push('');
  parts.push('1. MERGE CANDIDATES: Identify entities from different chunks representing the SAME concept.');
  parts.push('   - Only merge when names/aliases/types clearly match.');
  parts.push('   - Do NOT merge entities that merely share a common word.');
  parts.push('   - Reference entities by "contextId:localId" (e.g. "ctx-s000-c000:local-entity-001").');
  parts.push('');
  parts.push('2. CROSS-CHUNK FLOWS: Check if flow fragments from different chunks form a complete flow.');
  parts.push('   - If one chunk has ordered steps and another chunk references the same process, compose them.');
  parts.push('   - Only compose when there is clear evidence they belong to the same process.');
  parts.push('');
  parts.push('3. CROSS-CHUNK RELATIONSHIPS: Identify semantic connections between concepts in different chunks.');
  parts.push('   - Look for: same API referenced in business flow and API design sheets.');
  parts.push('   - Look for: same entity/concept appearing in multiple sheets with different perspectives.');
  parts.push('   - Look for: module dependencies across FE design and other sheets.');
  parts.push('   - Reference entities by "contextId:localId" format.');
  parts.push('   - Only create relationships with EXPLICIT evidence — not architectural assumptions.');
  parts.push('   - If a connection is plausible but not clearly evidenced, do NOT create it.');
  parts.push('');
  parts.push('4. DOCUMENT SUMMARY: Provide title, summary, language, and domain hints if possible.');
  parts.push('');
  parts.push('5. Do not invent relationships or merges without evidence.');

  return parts.join('\n');
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
