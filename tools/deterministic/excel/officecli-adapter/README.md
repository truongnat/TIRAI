# OfficeCLI Evaluation Adapter

This package is an experimental, read-only evaluation backend. It is not part
of the production Excel extraction path and does not replace
`cell-layout-extractor`.

```bash
npm run build --workspace=tools/deterministic/excel/officecli-adapter
node tools/deterministic/excel/officecli-adapter/dist/cli.js inspect \
  --input /path/workbook.xlsx \
  --output output/officecli-evaluation/officecli/workbook.json \
  --expected-version 1.0.144
```

The adapter invokes OfficeCLI with an argument array and `shell: false`, pins
the expected version when requested, hashes the source workbook before and
after inspection, and closes the OfficeCLI resident after each extraction.
`probe-cell` is intentionally separate because sheet enumeration does not
include every styled-empty or empty merged cell.
