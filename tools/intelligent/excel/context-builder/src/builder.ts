// ---------------------------------------------------------------------------
// Excel AI Context Builder – main builder
// ---------------------------------------------------------------------------

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadInputs } from './loader.js';
import { planChunks, generateChunkContent } from './chunker.js';
import { buildProvenance, generateChunkId } from './provenance.js';
import { detectCrossSheetReferences, buildContinuationRelations } from './relations.js';
import type {
  ContextBuilderOptions,
  ExcelContextPackage,
  ContextChunk,
  ContextWarning,
  SheetChunkIndex,
  ChunkStats,
} from './models.js';

const DEFAULT_OPTIONS: ContextBuilderOptions = {
  maxChars: 50_000,
  maxCells: 500,
};

/**
 * Build an AI-friendly context package from deterministic Excel outputs.
 */
export async function buildExcelContext(
  inputPath: string,
  options?: ContextBuilderOptions,
): Promise<ExcelContextPackage> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Phase 1: Load + validate
  const { workbook, layout, warnings: loadWarnings } = loadInputs(inputPath);

  const allWarnings: ContextWarning[] = [...loadWarnings];
  const allSheetNames = layout.sheets.map((s) => s.name);

  // Phase 2-5: Build context per sheet
  const allChunks: ContextChunk[] = [];
  const sheetIndices: SheetChunkIndex[] = [];
  let totalChars = 0;

  // Filter sheets if requested
  const sheetsToProcess = opts.sheets
    ? layout.sheets.filter((s) => opts.sheets!.includes(s.name))
    : layout.sheets;

  for (const sheet of sheetsToProcess) {
    // Plan chunks for this sheet
    const { plans, warnings: chunkWarnings } = planChunks(sheet, opts);
    allWarnings.push(...chunkWarnings);

    // Detect cross-sheet references
    const crossRefs = detectCrossSheetReferences(sheet, allSheetNames);

    // Build chunk IDs for continuation relations
    const chunkIds = plans.map((_, ci) => generateChunkId(sheet.index, ci));
    const continuations = buildContinuationRelations(chunkIds);

    // Generate each chunk
    const sheetChunkIds: string[] = [];

    for (let ci = 0; ci < plans.length; ci++) {
      const plan = plans[ci];
      const chunkId = chunkIds[ci];
      const isFirst = ci === 0;

      // Generate content
      const content = generateChunkContent(plan, isFirst);

      // Compute stats
      const stats: ChunkStats = {
        cells: plan.cells.length,
        characters: content.length,
        estimatedTokens: Math.ceil(content.length / 4),
      };
      totalChars += content.length;

      // Build provenance
      const provenance = buildProvenance(
        sheet.index,
        sheet.name,
        plan.cells,
        plan.headerCells,
      );

      // For multi-chunk sheets, provenance includes header range if repeated
      if (plans.length > 1 && !isFirst && plan.headerCells.length > 0) {
        const headerRange = `${plan.headerCells[0].address}:${plan.headerCells[plan.headerCells.length - 1].address}`;
        const dataRange = plan.cells.length > 0
          ? `${plan.cells[0].address}:${plan.cells[plan.cells.length - 1].address}`
          : '';
        provenance.ranges = [dataRange];
        provenance.repeatedHeaders = [headerRange];
      }

      // Build relations
      const relations = {
        previous: continuations[ci].previous,
        next: continuations[ci].next,
        references: crossRefs.length > 0 ? crossRefs : [],
      };

      // Determine context type
      const type = plan.cells.length > 0 && isTabular(plan.cells) ? 'tabular' as const : 'cell-block' as const;

      // Compute range
      const range = plan.cells.length > 0
        ? provenance.ranges[0] || null
        : null;

      const chunk: ContextChunk = {
        schemaVersion: '1.0',
        id: chunkId,
        type,
        sheet: { index: sheet.index, name: sheet.name },
        range,
        content,
        provenance,
        relations,
        layoutHints: plan.layoutHints,
        stats,
        warnings: [],
      };

      allChunks.push(chunk);
      sheetChunkIds.push(chunkId);
    }

    // Build sheet index entry
    const wbSheet = workbook.workbook.sheets.find((s) => s.index === sheet.index);
    sheetIndices.push({
      index: sheet.index,
      name: sheet.name,
      dimension: wbSheet?.dimension || sheet.dimension,
      chunks: sheetChunkIds,
    });
  }

  // Build final package
  const pkg: ExcelContextPackage = {
    schemaVersion: '1.0',
    source: {
      file: workbook.file.name,
      sizeBytes: workbook.file.sizeBytes,
    },
    stats: {
      sheets: sheetIndices.length,
      chunks: allChunks.length,
      characters: totalChars,
      estimatedTokens: Math.ceil(totalChars / 4),
    },
    sheets: sheetIndices,
    chunks: allChunks,
    warnings: allWarnings,
  };

  return pkg;
}

/**
 * Write the context package to disk.
 */
export function writeContextPackage(
  pkg: ExcelContextPackage,
  outputDir: string,
  pretty: boolean = false,
): void {
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(outputDir, 'chunks'), { recursive: true });

  const stringify = pretty
    ? (obj: unknown) => JSON.stringify(obj, null, 2)
    : (obj: unknown) => JSON.stringify(obj);

  // manifest.json
  const manifest = {
    schemaVersion: pkg.schemaVersion,
    source: pkg.source,
    stats: pkg.stats,
    sheets: pkg.sheets,
    warnings: pkg.warnings,
  };
  writeFileSync(join(outputDir, 'manifest.json'), stringify(manifest));

  // workbook-context.json
  const workbookContext = {
    schemaVersion: pkg.schemaVersion,
    file: { name: pkg.source.file },
    sheets: pkg.sheets.map((s) => ({
      index: s.index,
      name: s.name,
      dimension: s.dimension,
    })),
  };
  writeFileSync(join(outputDir, 'workbook-context.json'), stringify(workbookContext));

  // Individual chunk files
  for (const chunk of pkg.chunks) {
    const filename = `${chunk.id}.json`;
    writeFileSync(join(outputDir, 'chunks', filename), stringify(chunk));
  }
}

// ---- Helpers --------------------------------------------------------------

/**
 * Check if cells form a tabular pattern (multiple columns, contiguous rows).
 */
function isTabular(cells: import('./models.js').CellInput[]): boolean {
  if (cells.length < 2) return false;
  const cols = new Set(cells.map((c) => c.column));
  return cols.size >= 2;
}
