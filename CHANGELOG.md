# TIRAI Changelog

All notable changes to the TIRAI specification-to-test engine and CLI.

---

## [1.1.1] - 2026-11-04

### 🚀 Enhancements & Features

- **Professional Multi-Format Exporters:**
  - **Excel (`.xlsx`):** Unified test cases into a primary sheet featuring corporate navy headers (`#1F4E79`), thin borders (`#D9D9D9`), zebra striping (`#F9FAFB`), freeze panes, auto-filters, and visual badges for priority and execution status (`READY`/`MANUAL`). Included companion KPI summary dashboard and traceability matrix sheets.
  - **Word (`.docx`):** Upgraded from plain unstructured text to professional bordered tables with category shading (`#D9E1F2`), step matrix layout, and default `Segoe UI` typography.
  - **Markdown (`.md`):** Designed an intuitive Full Test Matrix presenting step numbers, actions, targets, inputs, and expected outcomes side-by-side with visual badges (`🔴 HIGH`, `🟢 READY`).
  - **PDF (`.pdf`):** Styled as publication-ready technical report cards with top navy banners, executive summary KPI boxes, and card-based test case layouts.

- **True Unicode & Multi-Language Support (Vietnamese & Japanese CJK):**
  - Integrated `@pdf-lib/fontkit` into the CLI bundle.
  - Implemented **Dual-Font Segment Rendering** in the PDF exporter, dynamically routing Vietnamese diacritics to `NotoSans` and Japanese Kanji/Kana to `IPAGothic` to eliminate `WinAnsi cannot encode` crashes and question-mark (`????`) mojibake.
  - Configured `Segoe UI` across document default runs in DOCX export.

- **Playwright Test Code Generator:**
  - Added support for the `'wait'` action verb in `test-code-generator`, materializing steps into deterministic `page.locator(...).waitFor({ state: "visible" })` statements.

---

### 🐛 Bug Fixes & Stability

- **Installer (`install.sh`):**
  - Resolved `SHA256 verification failed` issue caused by duplicate `Accept: application/vnd.github+json` headers returning JSON metadata instead of binary tarball. Direct release browser download URLs are now prioritized.
- **CLI Packaging (`tirai-cli`):**
  - Updated `scripts/prepack.mjs` to automatically filter internal monorepo workspace dependencies (`agentic-test-executor`, `contract-ir`, etc.) from `package.json` before publishing tarballs, preventing `npm 404 Not Found` errors during standalone global installation.
- **Large Excel Ingestion Performance (`cell-layout-extractor`):**
  - Optimized cell traversal to skip empty cells with pattern `'none'` transparent styling, preventing catastrophic loops over 1.5M+ cells in enterprise Japanese design templates (`画面設計書`).
  - Fixed catastrophic regex backtracking in `extractArrayFormulasFromXml`.
  - Reduced ingestion time for 14-sheet 3.9MB Excel workbooks from **>12 minutes to under 52 seconds**.
- **Contract & Plan Builder:**
  - Added null-safety guards and default values for scenario preconditions, confidence scores, and quality coverage metrics in `contract-builder.ts`, eliminating unhandled `TypeError` exceptions.
- **Markdown Summary Metrics:**
  - Added safe fallbacks for test plan quality metrics in `markdown-exporter.ts`, eliminating `undefined` and `NaN%` displays.
