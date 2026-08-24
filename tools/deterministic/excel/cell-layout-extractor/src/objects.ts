// ---------------------------------------------------------------------------
// Drawing Objects extraction – images, shapes, charts via raw OOXML (JSZip)
// ---------------------------------------------------------------------------

import type JSZip from 'jszip';
import type {
  ObjectRaw,
  AnchorRaw,
  AnchorType,
  AnchorPosition,
  AssetReference,
  SheetSourceReference,
  Warning,
  ExtractOptions,
} from './models.js';
import { WarningCode, createWarning } from './warnings.js';
import { WorkbookOOXMLContext } from './ooxml-context.js';

/**
 * Extract drawing objects from a worksheet by parsing raw OOXML.
 *
 * Flow: sheet.xml → sheet rels → drawing.xml → drawing rels → media/
 */
export async function extractObjects(
  filePath: string,
  sheetIndex: number,
  sheetName: string,
  warnings: Warning[],
  options: ExtractOptions,
  ooxmlContext?: WorkbookOOXMLContext,
): Promise<ObjectRaw[]> {
  const objects: ObjectRaw[] = [];

  try {
    const context = ooxmlContext ?? await WorkbookOOXMLContext.fromFile(filePath);
    const zip = context.zip;

    // 1. Find drawing reference in sheet XML
    const sheetPath = `xl/worksheets/sheet${sheetIndex + 1}.xml`;
    const sheetContent = await context.text(sheetPath);
    if (sheetContent === null) {
      return objects;
    }
    const drawingRef = extractDrawingReference(sheetContent);
    if (!drawingRef) {
      return objects;
    }

    // 2. Resolve drawing path from sheet rels
    const sheetRelsPath = `xl/worksheets/_rels/sheet${sheetIndex + 1}.xml.rels`;
    const sheetRels = zip.file(sheetRelsPath);
    if (!sheetRels) {
      warnings.push(
        createWarning(
          WarningCode.DRAWING_RELATIONSHIP_UNRESOLVED,
          `Sheet rels not found for sheet ${sheetIndex + 1}.`,
          sheetName,
        ),
      );
      return objects;
    }

    const sheetRelsContent = await sheetRels.async('string');
    const drawingPath = resolveRelationshipTarget(sheetRelsContent, drawingRef);
    if (!drawingPath) {
      warnings.push(
        createWarning(
          WarningCode.DRAWING_RELATIONSHIP_UNRESOLVED,
          `Drawing relationship "${drawingRef}" not resolved.`,
          sheetName,
        ),
      );
      return objects;
    }

    // Normalize path (drawing ref is relative like ../drawings/drawing1.xml)
    const fullDrawingPath = normalizePath(`xl/worksheets/${drawingPath}`);

    // 3. Parse drawing.xml
    const drawingFile = zip.file(fullDrawingPath);
    if (!drawingFile) {
      warnings.push(
        createWarning(
          WarningCode.DRAWING_XML_PARSE_PARTIAL,
          `Drawing file not found: ${fullDrawingPath}`,
          sheetName,
        ),
      );
      return objects;
    }

    const drawingContent = await drawingFile.async('string');

    // 4. Parse drawing rels for image/chart targets
    const drawingRelsPath = getRelsPath(fullDrawingPath);
    const drawingRels = zip.file(drawingRelsPath);
    let relsMap: Record<string, string> = {};
    if (drawingRels) {
      const drawingRelsContent = await drawingRels.async('string');
      relsMap = parseRelationships(drawingRelsContent);
    }

    // 5. Extract objects from drawing XML
    const source: SheetSourceReference = { sheet: sheetName };

    // Parse anchors and objects
    extractAnchorsFromDrawing(
      drawingContent,
      relsMap,
      zip,
      fullDrawingPath,
      source,
      warnings,
      objects,
      options,
      filePath,
    );
  } catch (err) {
    warnings.push(
      createWarning(
        WarningCode.DRAWING_XML_PARSE_PARTIAL,
        `Failed to parse drawing objects: ${err instanceof Error ? err.message : String(err)}`,
        sheetName,
      ),
    );
  }

  // Sort deterministically by type, then anchor position
  objects.sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    const ar = a.anchor?.from?.row ?? 0;
    const br = b.anchor?.from?.row ?? 0;
    const ac = a.anchor?.from?.column ?? 0;
    const bc = b.anchor?.from?.column ?? 0;
    return ar - br || ac - bc;
  });

  return objects;
}

// ---- Drawing reference from sheet XML ------------------------------------

function extractDrawingReference(sheetXml: string): string | null {
  // Match <drawing r:id="rIdX"/>
  const match = /<drawing\s[^>]*r:id="([^"]+)"/.exec(sheetXml);
  return match ? match[1] : null;
}

// ---- Relationship parsing ------------------------------------------------

function resolveRelationshipTarget(relsXml: string, relId: string): string | null {
  const rels = parseRelationships(relsXml);
  return rels[relId] ?? null;
}

function parseRelationships(relsXml: string): Record<string, string> {
  const map: Record<string, string> = {};
  const regex = /<Relationship\s+([^>]+)\/>/g;
  let match;
  while ((match = regex.exec(relsXml)) !== null) {
    const attrs = match[1];
    const idMatch = /Id="([^"]+)"/.exec(attrs);
    const targetMatch = /Target="([^"]+)"/.exec(attrs);
    if (idMatch && targetMatch) {
      map[idMatch[1]] = targetMatch[1];
    }
  }
  return map;
}

// ---- Anchor + Object extraction ------------------------------------------

function extractAnchorsFromDrawing(
  drawingXml: string,
  relsMap: Record<string, string>,
  zip: JSZip,
  drawingPath: string,
  source: SheetSourceReference,
  warnings: Warning[],
  objects: ObjectRaw[],
  options: ExtractOptions,
  filePath: string,
): void {
  // Match all anchor types
  const anchorPatterns = [
    { tag: 'twoCellAnchor', type: 'twoCellAnchor' as AnchorType },
    { tag: 'oneCellAnchor', type: 'oneCellAnchor' as AnchorType },
    { tag: 'absoluteAnchor', type: 'absoluteAnchor' as AnchorType },
  ];

  for (const { tag, type } of anchorPatterns) {
    const regex = new RegExp(`<xdr:${tag}[^>]*>([\\s\\S]*?)</xdr:${tag}>`, 'g');
    let anchorMatch;
    while ((anchorMatch = regex.exec(drawingXml)) !== null) {
      const anchorContent = anchorMatch[1];

      // Parse anchor position
      const anchor = parseAnchor(type, anchorContent);

      // Determine object type and extract details
      const obj = parseObjectFromAnchor(
        anchorContent,
        anchor,
        relsMap,
        zip,
        drawingPath,
        source,
        warnings,
        options,
        filePath,
      );

      if (obj) {
        objects.push(obj);
      }
    }
  }
}

function parseAnchor(type: AnchorType, content: string): AnchorRaw {
  const anchor: AnchorRaw = { type, from: null, to: null };

  if (type === 'twoCellAnchor') {
    anchor.from = parsePosition(content, 'from');
    anchor.to = parsePosition(content, 'to');
  } else if (type === 'oneCellAnchor') {
    anchor.from = parsePosition(content, 'from');
    anchor.to = null;
  } else {
    // absoluteAnchor – no cell position
    anchor.from = null;
    anchor.to = null;
  }

  return anchor;
}

function parsePosition(content: string, tag: 'from' | 'to'): AnchorPosition | null {
  const regex = new RegExp(`<xdr:${tag}>([\\s\\S]*?)</xdr:${tag}>`);
  const match = regex.exec(content);
  if (!match) return null;

  const posContent = match[1];
  const col = extractInt(posContent, 'col');
  const colOff = extractInt(posContent, 'colOff');
  const row = extractInt(posContent, 'row');
  const rowOff = extractInt(posContent, 'rowOff');

  if (col === null || row === null) return null;

  return {
    column: col,
    columnOffset: colOff ?? 0,
    row,
    rowOffset: rowOff ?? 0,
  };
}

function extractInt(content: string, tag: string): number | null {
  const regex = new RegExp(`<xdr:${tag}>(\\d+)</xdr:${tag}>`);
  const match = regex.exec(content);
  return match ? parseInt(match[1], 10) : null;
}

// ---- Object type detection -----------------------------------------------

function parseObjectFromAnchor(
  anchorContent: string,
  anchor: AnchorRaw,
  relsMap: Record<string, string>,
  zip: JSZip,
  drawingPath: string,
  source: SheetSourceReference,
  warnings: Warning[],
  options: ExtractOptions,
  filePath: string,
): ObjectRaw | null {
  // Detect image (pic) – may have attributes
  const picMatch = /<xdr:pic[^>]*>([\s\S]*?)<\/xdr:pic>/.exec(anchorContent);
  if (picMatch) {
    return parseImageObject(
      picMatch[1],
      anchor,
      relsMap,
      zip,
      drawingPath,
      source,
      warnings,
      options,
      filePath,
    );
  }

  // Detect chart (graphicFrame) – may have attributes like macro=""
  const chartMatch = /<xdr:graphicFrame[^>]*>([\s\S]*?)<\/xdr:graphicFrame>/.exec(anchorContent);
  if (chartMatch) {
    return parseChartObject(
      chartMatch[1],
      anchor,
      relsMap,
      source,
      warnings,
    );
  }

  // Detect shape (sp) – may have attributes like macro="" textlink=""
  const spMatch = /<xdr:sp[^>]*>([\s\S]*?)<\/xdr:sp>/.exec(anchorContent);
  if (spMatch) {
    return parseShapeObject(
      spMatch[1],
      anchor,
      source,
      warnings,
    );
  }

  // Detect group (grpSp) – treat as unknown
  const grpMatch = /<xdr:grpSp[^>]*>/.exec(anchorContent);
  if (grpMatch) {
    warnings.push(
      createWarning(
        WarningCode.UNSUPPORTED_DRAWING_TYPE,
        'Group shape (grpSp) detected but not fully parsed.',
        source.sheet,
      ),
    );
    return {
      type: 'unknown',
      relationshipId: null,
      anchor,
      asset: null,
      text: null,
      source,
    };
  }

  return null;
}

// ---- Image ---------------------------------------------------------------

function parseImageObject(
  picContent: string,
  anchor: AnchorRaw,
  relsMap: Record<string, string>,
  zip: JSZip,
  drawingPath: string,
  source: SheetSourceReference,
  warnings: Warning[],
  options: ExtractOptions,
  _filePath: string,
): ObjectRaw {
  // Find blip with r:embed
  const blipMatch = /r:embed="([^"]+)"/.exec(picContent);
  const rId = blipMatch ? blipMatch[1] : null;

  const target = rId ? relsMap[rId] ?? null : null;

  // Resolve asset info
  let asset: AssetReference | null = null;
  if (target) {
    const mediaPath = normalizePath(`${getDirPath(drawingPath)}/${target}`);
    const mediaFile = zip.file(mediaPath);

    if (mediaFile) {
      const sizeBytes = (mediaFile as unknown as { _data: { uncompressedSize: number } })._data?.uncompressedSize ?? null;
      const mimeType = guessMimeType(mediaPath);

      asset = {
        target: mediaPath,
        mimeType,
        sizeBytes,
        extractedPath: null,
      };

      // Extract binary if --assets
      if (options.assets) {
        // TODO: extract binary to output directory
        // For now, just note it could be extracted
      }
    } else {
      warnings.push(
        createWarning(
          WarningCode.IMAGE_ASSET_MISSING,
          `Image asset not found: ${mediaPath}`,
          source.sheet,
        ),
      );
      asset = {
        target,
        mimeType: guessMimeType(target),
        sizeBytes: null,
        extractedPath: null,
      };
    }
  }

  return {
    type: 'image',
    relationshipId: rId,
    anchor,
    asset,
    text: null,
    source,
  };
}

// ---- Chart ---------------------------------------------------------------

function parseChartObject(
  frameContent: string,
  anchor: AnchorRaw,
  relsMap: Record<string, string>,
  source: SheetSourceReference,
  warnings: Warning[],
): ObjectRaw {
  // Find chart reference (r:id in <c:chart>)
  const chartRIdMatch = /r:id="([^"]+)"/.exec(frameContent);
  const rId = chartRIdMatch ? chartRIdMatch[1] : null;

  warnings.push(
    createWarning(
      WarningCode.CHART_CONTENT_NOT_EXTRACTED,
      'Chart detected but content is not extracted in Phase 4.',
      source.sheet,
    ),
  );

  return {
    type: 'chart',
    relationshipId: rId,
    anchor,
    asset: null,
    text: null,
    source,
  };
}

// ---- Shape / TextBox -----------------------------------------------------

function parseShapeObject(
  spContent: string,
  anchor: AnchorRaw,
  source: SheetSourceReference,
  _warnings: Warning[],
): ObjectRaw {
  // Extract text from <a:t> elements within <xdr:txBody>
  const textParts: string[] = [];
  const textRegex = /<a:t>([\s\S]*?)<\/a:t>/g;
  let textMatch;
  while ((textMatch = textRegex.exec(spContent)) !== null) {
    textParts.push(textMatch[1]);
  }

  const text = textParts.length > 0 ? textParts.join('') : null;

  return {
    type: 'shape',
    relationshipId: null,
    anchor,
    asset: null,
    text,
    source,
  };
}

// ---- Helpers -------------------------------------------------------------

function normalizePath(p: string): string {
  // Resolve ../ segments
  const parts = p.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      resolved.pop();
    } else if (part !== '.' && part !== '') {
      resolved.push(part);
    }
  }
  return resolved.join('/');
}

function getDirPath(filePath: string): string {
  const parts = filePath.split('/');
  parts.pop();
  return parts.join('/');
}

function getRelsPath(filePath: string): string {
  const dir = getDirPath(filePath);
  const base = filePath.split('/').pop() ?? '';
  return `${dir}/_rels/${base}.rels`;
}

function guessMimeType(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'bmp': return 'image/bmp';
    case 'svg': return 'image/svg+xml';
    case 'emf': return 'image/x-emf';
    case 'wmf': return 'image/x-wmf';
    case 'tiff': case 'tif': return 'image/tiff';
    case 'webp': return 'image/webp';
    default: return null;
  }
}
