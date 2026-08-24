export interface NativeCell {
  address: string;
  rawValue: unknown;
  displayValue: string | null;
  styleId: string | null;
  formula: string | null;
  hyperlink: string | null;
}

export interface NativeSheet {
  name: string;
  cells: NativeCell[];
  mergedRanges: Array<{ range: string }>;
  annotations: unknown[];
  validations: unknown[];
  tables: unknown[];
  conditionalFormatting: unknown[];
  pageSetup: unknown;
  objects: unknown[];
}

export interface NativeWorkbook {
  file: { name: string };
  sheets: NativeSheet[];
}
