import fs from 'node:fs';
import JSZip from 'jszip';

/**
 * Workbook-scoped read-only OOXML access. The archive is decompressed once per
 * extraction and is never retained across workbooks.
 */
export class WorkbookOOXMLContext {
  readonly zip: JSZip;
  private readonly textCache = new Map<string, string>();

  private constructor(zip: JSZip) {
    this.zip = zip;
  }

  static async fromFile(filePath: string): Promise<WorkbookOOXMLContext> {
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
    return new WorkbookOOXMLContext(zip);
  }

  async text(entryPath: string): Promise<string | null> {
    const cached = this.textCache.get(entryPath);
    if (cached !== undefined) return cached;
    const entry = this.zip.file(entryPath);
    if (!entry) return null;
    const text = await entry.async('string');
    this.textCache.set(entryPath, text);
    return text;
  }
}
