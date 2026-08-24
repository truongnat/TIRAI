export type OfficeCliAgreement = 'EXACT' | 'COMPATIBLE' | 'NATIVE_ONLY' | 'OFFICECLI_ONLY' | 'CONFLICT' | 'UNKNOWN';
export type CapabilityStatus = 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED' | 'NOT_PRESENT_IN_FIXTURE' | 'UNKNOWN';

export interface OfficeCliCommandResult {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
}

export interface OfficeCliCell {
  address: string;
  text: string;
  type: string | null;
  empty: boolean;
  formula: string | null;
  merge: string | null;
  mergeAnchor: boolean;
  format: Record<string, string | boolean | number>;
  source: { backend: 'officecli'; workbook: string; sheet: string; address: string };
}

export interface OfficeCliSheet {
  name: string;
  rowCount: number | null;
  columnCount: number | null;
  visibility: string | null;
  cells: OfficeCliCell[];
  mergedRanges: string[];
  metadata: Record<string, unknown>;
  warnings: string[];
}

export interface OfficeCliWorkbookSnapshot {
  schemaVersion: 'officecli-evaluation-1.0';
  backend: 'officecli';
  officeCliVersion: string;
  file: { path: string; name: string; sizeBytes: number; sha256Before: string; sha256After: string; unchanged: boolean };
  sheets: OfficeCliSheet[];
  capabilities: Record<string, CapabilityStatus>;
  rawOoxml?: Record<string, string>;
  warnings: string[];
}

export interface ParityConflict {
  feature: string;
  sheet?: string;
  address?: string;
  nativeValue: unknown;
  officeCliValue: unknown;
  classification: 'CONFLICT';
  severity: 'critical' | 'major' | 'minor';
  reason: string;
}

export interface ParityReport {
  schemaVersion: 'officecli-parity-1.0';
  workbook: string;
  scope: string;
  metrics: Record<string, { native: unknown; officecli: unknown; agreement: OfficeCliAgreement }>;
  capabilities: Record<string, { native: CapabilityStatus; officecli: CapabilityStatus; agreement: OfficeCliAgreement; recommendedOwner: 'native' | 'officecli' | 'both' | 'unknown' }>;
  conflicts: ParityConflict[];
  counts: Record<OfficeCliAgreement, number>;
  warnings: string[];
}
