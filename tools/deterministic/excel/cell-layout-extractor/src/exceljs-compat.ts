import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import JSZip from 'jszip';

/**
 * ExcelJS 4.x parses OOXML tags literally and does not understand otherwise
 * valid namespace-prefixed tags such as <x:workbook>. Some spreadsheet
 * producers (including the artifact spreadsheet runtime) emit that form.
 *
 * Keep the source workbook untouched, but normalize the in-memory ZIP buffer
 * that is handed to ExcelJS and to the raw XML readers. Relationship targets
 * are normalized as well because ExcelJS expects worksheet-local targets such
 * as ../tables/table1.xml rather than package-absolute /xl/tables/table1.xml.
 */
export async function loadExcelJsCompatibleBuffer(filePath: string): Promise<Buffer> {
  const original = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(original);
  const workbookEntry = zip.file('xl/workbook.xml');
  const workbookXml = workbookEntry ? await workbookEntry.async('string') : '';
  const needsSpreadsheetTagNormalization = /<x:workbook\b/.test(workbookXml);
  let changed = false;

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;

    const isXml = entry.name.endsWith('.xml');
    const isRelationships = entry.name.endsWith('.rels');
    if (!isXml && !isRelationships) continue;

    const source = await entry.async('string');
    let normalized = source;

    // ExcelJS' spreadsheet parsers need the worksheet package normalized, but
    // its core-properties parser intentionally expects prefixes such as
    // `dc:creator`. Do not strip prefixes from unrelated package parts.
    if (isXml && needsSpreadsheetTagNormalization && entry.name.startsWith('xl/')) {
      normalized = normalized.replace(/(<\/?)[A-Za-z_][\w.-]*:/g, '$1');
    }

    if (isRelationships) {
      const sourcePart = relationshipSourcePart(entry.name);
      if (sourcePart) {
        const baseDir = path.posix.dirname(sourcePart);
        normalized = normalized.replace(/Target="(\/xl\/[^\"]+)"/g, (_match, target: string) => {
          const relativeTarget = path.posix.relative(baseDir, target.slice(1));
          return `Target="${relativeTarget}"`;
        });
      }
    }

    if (normalized !== source) {
      changed = true;
      zip.file(entry.name, normalized);
    }
  }

  return changed ? Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })) : original;
}

function relationshipSourcePart(relationshipsPath: string): string | null {
  const match = /^(.*\/)?_rels\/([^/]+)\.rels$/.exec(relationshipsPath);
  if (!match) return null;
  return `${match[1] ?? ''}${match[2]}`;
}
