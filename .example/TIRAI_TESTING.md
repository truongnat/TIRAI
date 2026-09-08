# TIRAI end-to-end example

This cloned app includes two layers of browser coverage:

- `tests/tirai-smoke.spec.ts` tests the app flow directly with Playwright and
  mocks JSONPlaceholder for deterministic data.
- `specs/example-react-detail-design.xlsx` is the detailed-design input with
  business flow, UI, DB, FE, and API sheets.
- TIRAI compiles that workbook into a source-independent contract: semantic
  IR, requirements, test plan, and `testcases.json`, preserving sheet/range
  provenance.
- The implementation source is scanned for explicit `data-testid` markers to
  create a conservative trusted E2E mapping. Dynamic row/API cases stay
  `manual-only` until a fixture binding is supplied.

## Run the direct Playwright example

```bash
npm run test:e2e
```

## Run through TIRAI

Run these commands from this directory after building TIRAI once:

```bash
cd ..
npm run build --workspace=tools/intelligent/tirai-cli
cd .example
npm run tirai:example
```

The command runs the complete pipeline:

1. `tirai ingest specs/example-react-detail-design.xlsx --source-code .`
2. `tirai generate --target playwright`
3. `tirai run`
4. `tirai export --format xlsx`

Generated tests are written to `.tirai/generated/e2e/`, canonical JSON is in
`.tirai/artifacts/`, the run result is in `.tirai/results/`, and the Excel
output is `.tirai/outputs/excel/test-cases.xlsx`.
