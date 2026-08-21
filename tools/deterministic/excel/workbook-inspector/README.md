# Workbook Inspector

Deterministic CLI tool that reads **workbook/sheet-level metadata** from `.xlsx` and `.xlsm` Excel files.

- **No AI** — purely deterministic, no LLM or external API calls.
- **Read-only** — never modifies the source file.
- **Reusable** — core `inspectWorkbook()` function can be imported independently of the CLI.

## Quick Start

```bash
# Install dependencies
npm install

# Run via CLI
npx tsx src/cli.ts ./spec/FAD00001.xlsx --pretty

# Build (optional – produces dist/)
npm run build
```

## CLI Usage

```
workbook-inspector <input-file> [--pretty]
```

| Argument       | Description                                |
| -------------- | ------------------------------------------ |
| `<input-file>` | Path to `.xlsx` or `.xlsm` workbook file.  |
| `--pretty`     | Format JSON output with indentation.        |

- JSON output → **stdout**
- Errors / debug → **stderr**
- Exit code `0` on success, non-zero on fatal error.

### Examples

```bash
# Basic inspection
npx tsx src/cli.ts ./spec/FAD00001.xlsx

# Pretty-printed output
npx tsx src/cli.ts ./spec/FAD00001.xlsx --pretty

# Error handling (stderr)
npx tsx src/cli.ts ./missing.xlsx 2>&1
# → ERROR [FILE_NOT_FOUND]: FILE_NOT_FOUND: /path/to/missing.xlsx
```

## Programmatic Usage

```typescript
import { inspectWorkbook } from './src/inspector.js';

const metadata = await inspectWorkbook('./spec/FAD00001.xlsx');
console.log(JSON.stringify(metadata, null, 2));
```

## Output Contract

```jsonc
{
  "schemaVersion": "1.0",
  "file": {
    "path": "/absolute/path/FAD00001.xlsx",
    "name": "FAD00001.xlsx",
    "extension": ".xlsx",
    "sizeBytes": 183920
  },
  "workbook": {
    "properties": { /* title, creator, dates, … */ },
    "sheets": [ /* ordered sheet inventory */ ],
    "definedNames": [ /* workbook & sheet-scoped names */ ],
    "externalLinks": [ /* detected external references */ ],
    "calculation": { /* calc mode, calcId, … */ }
  },
  "warnings": [ /* non-fatal issues */ ]
}
```

### What is extracted

| Feature               | Support |
| --------------------- | ------- |
| File metadata         | Full    |
| Workbook properties   | Full    |
| Sheet inventory       | Full (order preserved) |
| Sheet state (visible/hidden/veryHidden) | Full |
| Sheet dimensions      | Full (with reliability warnings) |
| Freeze panes          | Full    |
| Auto filters          | Range only (no filter criteria) |
| Defined names         | Full (workbook & sheet scope, hidden flag) |
| Calculation properties | Best-effort (raw XML fallback) |
| External links        | Detection only (targets may be incomplete) |

### What is NOT done

- Cell content is **not** read or serialized.
- No business logic inference.
- No VBA/macro analysis (`.xlsm` triggers a warning).
- No formula recalculation.
- No file modification.
- No Japanese/Unicode label translation.

## Supported Formats

| Format  | Support |
| ------- | ------- |
| `.xlsx` | Full    |
| `.xlsm` | Full (VBA not inspected) |
| `.xls`  | Not supported (fatal error) |

## Warning Codes

| Code | Meaning |
| ---- | ------- |
| `SHEET_DIMENSION_UNRELIABLE` | Sheet dimension could not be determined |
| `UNKNOWN_SHEET_STATE` | Unrecognised sheet visibility state |
| `EXTERNAL_LINKS_NOT_FULLY_SUPPORTED` | External link detection is best-effort |
| `CALCULATION_PROPERTIES_NOT_SUPPORTED` | Calculation properties not readable |
| `MACRO_CONTENT_NOT_INSPECTED` | `.xlsm` file may contain VBA |
| `UNSUPPORTED_FILE_EXTENSION` | File extension not recognised |
| `CORRUPTED_WORKBOOK_METADATA` | Metadata parsing encountered issues |

## Error Codes (fatal, exit ≠ 0)

| Code | Meaning |
| ---- | ------- |
| `FILE_NOT_FOUND` | Input file does not exist |
| `FILE_NOT_READABLE` | Path is not a regular file |
| `UNSUPPORTED_FILE_FORMAT` | `.xls` or unknown extension |
| `CORRUPTED_WORKBOOK` | File cannot be opened |
| `ENCRYPTED_FILE` | Password-protected workbook |

## Architecture

```
CLI (cli.ts)
 ↓
WorkbookInspector (inspector.ts)
 ↓
WorkbookMetadata Model (models.ts)
 ↓
JSON Serializer (stdout)
```

```
src/
├── cli.ts          # CLI entry point
├── inspector.ts    # Core inspection logic (reusable)
├── models.ts       # TypeScript interfaces
└── warnings.ts     # Warning codes & helpers
```

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

### Test coverage

- Single / multiple sheets
- Hidden & very hidden sheets
- Freeze panes & auto filters
- Named ranges (workbook & sheet scope)
- Empty workbook / empty sheet
- Unicode / Japanese sheet names
- `.xlsm` macro-enabled workbook
- Invalid extension / missing file / corrupted file
- Workbook with metadata properties
- Deterministic output verification
- JSON property ordering
- Golden / snapshot test

## Deterministic Output

The same workbook + same tool version always produces semantically identical output. No timestamps, UUIDs, or execution-time values are included.

## Limitations

- External link target resolution is best-effort (file paths may not be fully resolved).
- Calculation properties rely on raw XML parsing when ExcelJS doesn't expose them.
- Very hidden sheet detection depends on ExcelJS correctly mapping the `veryHidden` state.
- The tool does not attempt to recover from corrupted workbooks — it reports a fatal error.
