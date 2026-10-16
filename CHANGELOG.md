# Changelog

## 0.1.0 — 2026-10-16

First public release of Payload Radar, a browser workbench and CLI for comparing the shapes observed in JSON payload samples.

- Compare single JSON documents or multiple JSON Lines samples without an API key or backend.
- Review missing and new fields, new value types, first-observed nulls, field presence changes, and missing array item evidence.
- Inspect local sample evidence with original sample numbers and JSON Pointer locations.
- Filter findings by severity or field path; swap baseline and candidate inputs.
- Export a Markdown report, JSON report, or JSON Schema inferred from candidate samples. Exports omit raw sample values.
- Use the same inference engine in a dependency-free Node.js CLI, with optional CI exit-code gates.
- Explore three synthetic examples: checkout release drift, webhook edge cases, and a structurally stable release.
- Run the static app locally or deploy it with the included GitHub Pages workflow.

This release analyzes sample structure. It does not prove compatibility with a complete API contract, detect changed enum or string-format constraints, or pair array items by identity.
