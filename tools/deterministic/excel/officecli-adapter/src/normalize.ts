import type { NativeCell, NativeWorkbook } from './native-types.js';
import type { OfficeCliAgreement, OfficeCliCell, OfficeCliWorkbookSnapshot, ParityConflict, ParityReport, CapabilityStatus } from './models.js';

export function compareSnapshots(native: NativeWorkbook, office: OfficeCliWorkbookSnapshot, scope: string): ParityReport {
  const conflicts: ParityConflict[] = [];
  const metrics: ParityReport['metrics'] = {};
  const nativeSheets = native.sheets.map((sheet) => sheet.name);
  const officeSheets = office.sheets.map((sheet) => sheet.name);
  metrics.sheetNames = metric(nativeSheets, officeSheets);
  metrics.sheetCount = metric(native.sheets.length, office.sheets.length);
  for (const nativeSheet of native.sheets) {
    const officeSheet = office.sheets.find((sheet) => sheet.name === nativeSheet.name);
    if (!officeSheet) continue;
    metrics[`${nativeSheet.name}.mergedRanges`] = metric(nativeSheet.mergedRanges.map((merge) => merge.range).sort(), officeSheet.mergedRanges.sort());
    metrics[`${nativeSheet.name}.cellCount`] = metric(nativeSheet.cells.length, officeSheet.cells.length);
    const nativeStyledEmpty = nativeSheet.cells.filter((cell) => cell.rawValue === null && cell.styleId !== null).length;
    const officeStyledEmpty = officeSheet.cells.filter((cell) => cell.empty && Object.keys(cell.format).length > 1).length;
    metrics[`${nativeSheet.name}.styledEmptyCells`] = metric(nativeStyledEmpty, officeStyledEmpty);
    compareCells(nativeSheet.cells, officeSheet.cells, nativeSheet.name, conflicts);
  }
  const capabilities = buildCapabilities(native, office);
  const counts: ParityReport['counts'] = { EXACT: 0, COMPATIBLE: 0, NATIVE_ONLY: 0, OFFICECLI_ONLY: 0, CONFLICT: conflicts.length, UNKNOWN: 0 };
  for (const value of Object.values(metrics)) counts[value.agreement]++;
  return { schemaVersion: 'officecli-parity-1.0', workbook: native.file.name, scope, metrics, capabilities, conflicts, counts, warnings: office.file.unchanged ? [] : ['SOURCE_WORKBOOK_MUTATED'] };
}

function compareCells(nativeCells: NativeCell[], officeCells: OfficeCliCell[], sheet: string, conflicts: ParityConflict[]): void {
  const nativeByAddress = new Map(nativeCells.map((cell) => [cell.address, cell]));
  const officeByAddress = new Map(officeCells.map((cell) => [cell.address, cell]));
  for (const [address, native] of nativeByAddress) {
    const office = officeByAddress.get(address);
    if (!office || native.displayValue === null || office.text === '') continue;
    if (native.displayValue !== office.text) conflicts.push({ feature: 'displayValue', sheet, address, nativeValue: native.displayValue, officeCliValue: office.text, classification: 'CONFLICT', severity: 'major', reason: 'Non-empty display values differ after normalization' });
  }
}

function metric(native: unknown, officecli: unknown): { native: unknown; officecli: unknown; agreement: OfficeCliAgreement } {
  return { native, officecli, agreement: JSON.stringify(native) === JSON.stringify(officecli) ? 'EXACT' : 'CONFLICT' };
}

function buildCapabilities(native: NativeWorkbook, office: OfficeCliWorkbookSnapshot): ParityReport['capabilities'] {
  const nativeCapabilities: Record<string, CapabilityStatus> = { workbookMetadata: 'SUPPORTED', sheets: 'SUPPORTED', cells: 'SUPPORTED', formulas: native.sheets.some((sheet) => sheet.cells.some((cell) => cell.formula)) ? 'SUPPORTED' : 'NOT_PRESENT_IN_FIXTURE', mergedRanges: native.sheets.some((sheet) => sheet.mergedRanges.length > 0) ? 'SUPPORTED' : 'NOT_PRESENT_IN_FIXTURE', styledEmptyCells: 'SUPPORTED', comments: native.sheets.some((sheet) => sheet.annotations.length > 0) ? 'SUPPORTED' : 'NOT_PRESENT_IN_FIXTURE', validations: native.sheets.some((sheet) => sheet.validations.length > 0) ? 'SUPPORTED' : 'NOT_PRESENT_IN_FIXTURE', tables: native.sheets.some((sheet) => sheet.tables.length > 0) ? 'SUPPORTED' : 'NOT_PRESENT_IN_FIXTURE', conditionalFormatting: native.sheets.some((sheet) => sheet.conditionalFormatting.length > 0) ? 'SUPPORTED' : 'NOT_PRESENT_IN_FIXTURE', pageSetup: native.sheets.some((sheet) => !!sheet.pageSetup) ? 'SUPPORTED' : 'NOT_PRESENT_IN_FIXTURE', pictures: native.sheets.some((sheet) => sheet.objects.length > 0) ? 'PARTIAL' : 'NOT_PRESENT_IN_FIXTURE', shapes: 'UNKNOWN', charts: 'UNKNOWN', pivots: 'UNKNOWN', slicers: 'UNKNOWN', oleObjects: 'UNKNOWN', hyperlinks: native.sheets.some((sheet) => sheet.cells.some((cell) => !!cell.hyperlink)) ? 'SUPPORTED' : 'NOT_PRESENT_IN_FIXTURE', namedRanges: 'UNKNOWN' };
  const output: ParityReport['capabilities'] = {};
  for (const feature of new Set([...Object.keys(nativeCapabilities), ...Object.keys(office.capabilities)])) {
    const n = nativeCapabilities[feature] ?? 'UNKNOWN'; const o = office.capabilities[feature] ?? 'UNKNOWN';
    const agreement = n === o ? (n === 'SUPPORTED' ? 'COMPATIBLE' : 'UNKNOWN') : n === 'SUPPORTED' && o !== 'SUPPORTED' ? 'NATIVE_ONLY' : o === 'SUPPORTED' && n !== 'SUPPORTED' ? 'OFFICECLI_ONLY' : 'UNKNOWN';
    output[feature] = { native: n, officecli: o, agreement, recommendedOwner: agreement === 'OFFICECLI_ONLY' ? 'officecli' : agreement === 'NATIVE_ONLY' ? 'native' : agreement === 'UNKNOWN' ? 'unknown' : 'both' };
  }
  return output;
}
