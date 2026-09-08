export { buildExcelContext, buildExcelContextFromLoaded, writeContextPackage } from './builder.js';
export type { LoadedInputs } from './loader.js';

export type {
  ExcelContextPackage,
  SourceInfo,
  PackageStats,
  SheetChunkIndex,
  ContextType,
  ContextChunk,
  SheetReference,
  ChunkProvenance,
  ChunkRelations,
  CrossReference,
  LayoutHints,
  ChunkStats,
  ContextWarning,
  ContextBuilderOptions,
  WorkbookMetadataInput,
  WorkbookLayoutInput,
  SheetLayoutInput,
  CellInput,
} from './models.js';
