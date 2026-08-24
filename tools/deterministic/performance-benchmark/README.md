# Performance Benchmark & Regression Toolkit v1

`performance-benchmark` measures TIRAI tools as black-box subprocesses. It does not add timing code to production modules and does not call an AI provider or the network.

## CLI

```bash
npm run build --workspace=tools/deterministic/performance-benchmark
node tools/deterministic/performance-benchmark/dist/cli.js generate-fixture --output output/performance/fixtures --fixture small
node tools/deterministic/performance-benchmark/dist/cli.js run --id smoke --input output/performance/fixtures/small.xlsx --output output/performance/runs/smoke
```

Create a real Excel extractor baseline. `--sheet` is useful for a fast cover-sheet baseline; omit it for a full workbook run.

```bash
node tools/deterministic/performance-benchmark/dist/cli.js baseline \
  --name excel-extractor-pre-optimization \
  --input /path/FAC.xlsx --input /path/FAD.xlsx --sheet 表紙 \
  --warmup-runs 0 --measurement-runs 1 \
  --output output/performance/baselines/excel-extractor-pre-optimization
```

Named baseline output is immutable by default. Use `--force` only when intentionally replacing it. Compare two result files with `tirai-bench compare --baseline <json> --candidate <json> --output <dir>`.

Each sample preserves wall time, target-process RSS (Linux `/proc` sampler), target CPU where available, input/output/stdout/stderr bytes, output SHA-256, exit state, timeout state and domain metrics. Warmup samples are persisted separately and excluded from statistics. Statistics include min, max, mean, median/p50, p90, p95, standard deviation and coefficient of variation.

The sampler has first-class Linux support. Other operating systems retain nullable CPU/RSS capability rather than fabricating values. Filesystem cache flushing and child-process-tree accounting are not claimed as controlled by v1.

Excel parsing reports sheets, emitted cells, merged ranges, styles, objects and warnings. Synthetic fixtures are generated from a deterministic seed; generation time is not part of target timing.
