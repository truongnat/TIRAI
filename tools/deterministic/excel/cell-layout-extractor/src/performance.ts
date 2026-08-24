import type { CellRaw, MemorySnapshot, PerformanceProfile, SheetPerformanceProfile } from './models.js';

export function now(): number {
  return performance.now();
}

export function rssBytes(): number {
  return process.memoryUsage().rss;
}

export function memorySnapshot(label: string): MemorySnapshot {
  const usage = process.memoryUsage();
  return {
    label,
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    heapTotalBytes: usage.heapTotal,
    externalBytes: usage.external,
    arrayBuffersBytes: usage.arrayBuffers,
  };
}

export function createProfile(): PerformanceProfile {
  return {
    enabled: true,
    totalMs: 0,
    workbookLoadMs: 0,
    rssBeforeLoadBytes: rssBytes(),
    rssAfterLoadBytes: 0,
    rssBeforeSerializationBytes: 0,
    rssAfterSerializationBytes: 0,
    memory: [memorySnapshot('before-workbook-load')],
    sheets: [],
  };
}

export function classifyCells(
  cells: CellRaw[],
  isMerged: (address: string) => boolean,
): Pick<SheetPerformanceProfile, 'nonEmptyCells' | 'styledEmptyCells' | 'mergedEmptyCells' | 'formulaCells'> {
  let nonEmptyCells = 0;
  let styledEmptyCells = 0;
  let mergedEmptyCells = 0;
  let formulaCells = 0;

  for (const cell of cells) {
    const empty = cell.rawValue === null && cell.formula === null;
    if (!empty) nonEmptyCells++;
    if (empty && cell.styleId !== null) styledEmptyCells++;
    if (empty && isMerged(cell.address)) mergedEmptyCells++;
    if (cell.type === 'formula') formulaCells++;
  }

  return { nonEmptyCells, styledEmptyCells, mergedEmptyCells, formulaCells };
}
