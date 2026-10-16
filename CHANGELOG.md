# Changelog

## 0.3.0 — 2026-10-17

Make the first review immediate, bringing your own data predictable, and sharing the result a single local action.

- Open the synthetic checkout review with already-calculated results and collapsed payload editors; a clear **See example results** route shows the consumer-focused findings first.
- Add **Use my own JSON** to leave the demo and open a fresh comparison. Untouched demo lens rules are removed when working with custom data; explicitly edited or imported rules are retained.
- Detect JSON or JSON Lines independently on each browser input. Pretty-printed documents and mixed-format pairs work without selecting a shared mode; each side still has an explicit override and shows its detected format.
- Preserve top-level JSON arrays as one sample, detailed malformed-JSONL line numbers, and every existing parser safety bound. Valid JSON that exceeds a limit never falls back to another format.
- Add **Copy review summary** for compact Markdown containing structural facts and consumer-check results without raw sample values. Clipboard failures provide selected text for manual copying; nothing is posted or uploaded automatically.
- Add **Copy demo link** for built-in synthetic examples without encoding user payloads or lens contents in the URL.
- Add a deterministic content build ID to deployed CSS/JavaScript entrypoints and relative static module imports, avoiding stale browser modules after a refreshed deployment. Source inputs remain unchanged and failed builds preserve the previous output.
- Update the first-run screenshot, bilingual quick start, sharing guidance, architecture and launch notes. The reusable Action example now targets `v0.3.0`.

Browser Auto detection is a browser helper; CLI `--format json|jsonl`, engine parsing, consumer rules and existing CI gates remain compatible. Copied names and paths can still be sensitive even when raw values are omitted.

## 0.2.0 — 2026-10-17

Consumer Lens adds a consumer's view of API drift: select only the fields your code depends on, state the types and presence it requires, and check candidate samples against those explicit rules.

- Create and edit named lenses in the browser using observed baseline paths. Required presence and allowed JSON types remain explicit user choices.
- Focus structural drift on selected fields and their ancestors; inspect rule results with concrete sample numbers and JSON Pointers.
- Import an existing lens and check a candidate in the browser without loading a baseline; clearing inputs keeps the current lens.
- Export and import portable, versioned `.lens.json` files containing no raw sample values or complete inferred baseline shape.
- Add a reusable composite GitHub Action: `uses: qsxustc/payload-radar@v0.2.0` checks a caller-provided lens and candidate directly, without an extra tool clone or dependency installation.
- Run `payload-radar check <consumer.lens.json> <candidate-file>` in CI without a baseline payload. The default gate fails on observed rule violations; `--fail-on review` also fails on rules with no observed values.
- Export consumer checks as value-free Markdown or JSON reports. Report files are retained even when a check returns exit code 1.
- Distinguish optional missing fields from disallowed nulls, and flag unobserved array-item rules for review when arrays provide no item evidence.
- Share the same zero-dependency check engine through `src/consumer.js` and the `payload-radar/consumer` package export.
- Include checkout and order-email lenses, a direct Consumer Lens demo link, CLI integration tests, and updated bilingual documentation.

The original diff CLI remains compatible. Lenses are in-memory in the browser and need explicit export/import to survive a refresh. A passing check only describes the supplied samples against user-selected type/presence rules; it does not prove future payload or full API compatibility.

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
