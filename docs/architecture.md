# Architecture

Payload Radar has a static browser app and a Node.js command-line entry point. Both use the same ES module inference and consumer-check engines. There are no runtime or build dependencies.

## Data flow

1. The browser accepts pasted text or reads a user-selected UTF-8 file into memory. The CLI reads local regular files for a diff or a lens/candidate check.
2. Browser-only `parsePayload` detects each input independently through `parseInput`: it tries one complete JSON document first, then attempts JSON Lines only after a syntax error. Explicit `json` or `jsonl` choices bypass detection. Empty input retains its clear empty-input error; type, finite-number and safety-bound failures are never treated as format guesses. CLI `--format json|jsonl` and core `parseInput` retain their existing explicit semantics. A top-level JSON array stays a single document, rather than silently becoming independent top-level samples.
3. `inferShape` merges the observed value types, object properties, array items and observation counts into a shape tree. The tree contains no raw sample values.
4. `compareShapes` walks baseline and candidate trees and returns findings with typed paths and before/after observation counts.
5. The browser sorts findings by severity and presents local sample evidence. Markdown, JSON, JSON Schema and compact copied review summaries contain structure, names and counts, without raw sample values.

Consumer Lens adds a second flow. The user explicitly selects paths and edits allowed types and required presence in the browser, or imports a versioned lens JSON file. `checkLens` validates the candidate samples and evaluates those rules directly. The lens does not retain an inferred baseline shape. An imported lens can check a browser candidate with an empty baseline; comparison findings are only computed when both inputs are present. Clearing inputs keeps explicitly edited or imported rules, while untouched example presets are dropped on the transition to custom data. Browser Markdown/JSON review exports and copied summaries include the current consumer check. The CLI `check` command shares that implementation and defaults to failing on observed violations.

## First-run and sharing flow

The initial checkout is visibly synthetic and already compared; its editors start collapsed so users can inspect the nine-to-two consumer focus before reading sample text. **See example results** navigates to that result. **Use my own JSON** clears example inputs, opens the editors, and removes untouched example assumptions. Editing or importing sample data also leaves the demo context. Consumer rules have explicit provenance: changing a rule or importing a lens promotes those choices to user-owned rules, which survive a fresh-input transition.

Each side stores its own format preference and, after successful parsing, detected format. A baseline JSON document and a candidate JSONL stream can therefore be compared directly. Explicit format overrides remain authoritative. Browser format detection is implemented as a separate helper and does not extend the public CLI format options or reinterpret arrays as multiple samples.

**Copy review summary** prepares bounded Markdown from structural findings and consumer-check reports. It contains no original scalar sample values. A clipboard write is performed only after the user requests it; when it is unavailable or rejected, a dialog presents selected text for manual copying. The application does not post a GitHub comment, create a remote paste or upload the generated summary. **Copy demo link** uses only the built-in example selection and section anchor. It never serializes payloads or lens contents into a URL.

## Consumer Lens

A lens has a strict wire representation:

```json
{
  "kind": "payload-radar-consumer",
  "schemaVersion": 1,
  "name": "Checkout UI",
  "rules": [
    { "tokens": ["total"], "types": ["number"], "required": true },
    { "tokens": ["items", null, "quantity"], "types": ["number"], "required": true }
  ]
}
```

The six allowed JSON types are `array`, `boolean`, `null`, `number`, `object`, and `string`. A rule checks each reachable value at its typed path; `null` in `tokens` expands across array items. An empty token list checks the document root. Object property names remain literal, so the string `"[]"` is distinct from the array-item token `null`.

`normalizeLens` rejects unknown or missing fields, unsupported versions, duplicate paths, invalid types, custom prototypes, accessors, symbols and malformed arrays. It copies validated data and sorts/deduplicates allowed types. `parseLens` validates imported JSON; `serializeLens` writes the stable representation. Lens files contain only the name and rules, without sample values or the full inferred baseline shape.

For each rule, `checkLens` reports `checked`, `present`, `missing`, `mismatched`, `violations`, and `emptyArrays`. A required missing field, missing ancestor, or wrong container at an ancestor increments a missing violation. Optional missing fields do not violate a rule. A present value whose type is absent from `types` is a mismatch, including `null` unless explicitly allowed. A rule selecting an object or array checks that container's type and presence, without implicitly checking all children.

Every matched array item is checked; items are not paired with baseline items or selected by an ID. An empty array increments `emptyArrays` and provides no item checks. It does not fabricate a missing child. A rule fails when it has violations, passes when it has at least one observed value and no violations, and otherwise requires review. Thus an entirely unobserved optional field requires review, and a mix of empty arrays and valid observed items can pass. The report status is `fail` if any rule fails, otherwise `review` if any rule requires review, otherwise `pass`.

Diagnostic examples include sample numbers, concrete JSON Pointers, `missing`/`type` reasons and actual/expected type names, without raw values. Missing pointers stop at the actual missing key or blocking ancestor. Examples are capped at five per rule and a combined 2 MiB diagnostic-pointer budget; counts remain complete. `lensMarkdown` uses the same value-free report, escaping derived text for Markdown tables.

The browser's focus option uses `relatedChanges`: findings at a selected field or one of its ancestors remain visible. Selecting a container does not pull in all descendant changes. Focus is a view over the original diff, whereas the consumer report checks only candidate samples against explicit rules.

Lens input and serialized output are bounded to 256 KiB, one to 100 rules, and a trimmed name of one to 80 UTF-16 code units. Paths use the core's 64-step depth, 1,024-unit property-name and 4,096-unit cumulative-path limits. Imported or edited lenses must be explicitly exported to survive a refresh; the app does not persist them in browser storage.

The CLI `check` gate defaults to `risk`: observed violations produce exit code 1. `review` and `any` also gate rules with no observed values; `none` disables the gate. Reports are produced before gating. Argument/input/I/O errors return 2, including attempts to use `--schema` in check mode. The original two-file diff mode retains its default `none` gate; `-- check after.json` treats a file literally named `check` as the baseline.

## Field presence

A property's denominator is the number of observed object values at its immediate parent node. Missing ancestors and `null` parents are not invented as additional parent objects. For example, comparing `{"user":{"name":"Ada"}}` with `{"user":null}` concerns the type observed at `user`, rather than independently claiming that every child field was removed.

Array items are pooled across samples. An array with three object items contributes three object observations to those items' property denominators. Presence percentages therefore describe observations, rather than the probability that a future request will contain a field. Empty arrays provide evidence that an array exists and no evidence about its items.

## Paths and evidence

Each finding carries `tokens`: string property names and a `null` marker for an array item. This separates a literal field name from a wildcard, even for unusual keys such as `[]`, `/` and `~`. Display paths are for humans. Evidence locations use concrete JSON Pointer indices, and retain the original top-level sample number.

The evidence inspector renders the first six observations per side and truncates each displayed value preview to 600 characters. It still reports the complete observation count for the selected path. Evidence is not included in exports.

## Boundaries

Inputs are bounded to 2 MiB each, 1,000 top-level samples, a nesting depth of 64, and 50,000 visited values per side. There is no statistical confidence model. A single sample can reveal a new observed type; many samples still cannot prove that a field is required by an external specification.

Individual property names are bounded to 1,024 UTF-16 code units (`key.length`). Each root-to-node structural path has a 4,096-unit cumulative budget: a property step adds its key length plus one, and an array-item step adds two. These are structural counters, rather than the length of an escaped display path.

Comparison also bounds repeated location metadata. For each finding, the engine JSON-encodes its `{ id, path, pointer, tokens }` object, measures the UTF-8 bytes, and adds that length to an aggregate budget of 2 MiB. Exceeding it rejects the comparison with a request to compare smaller sample groups or shorten field names. This prevents long repeated paths from expanding the findings without bound; it is not a cap on the complete report size.

JSON numbers use JavaScript number precision. Large integer IDs should be represented as strings when precision matters. Numbers are grouped as `number`; this release does not infer integer, enum, format, numeric range, tuple, discriminator or cross-field constraints.

The generated JSON Schema uses types and properties observed in candidate samples. Properties observed in every object at their parent node are listed in `required`. This is a draft based on these inputs, and needs review before becoming an API specification. Additional properties remain allowed.

## Privacy and rendering

The app does not call an API, persist payloads or lenses in browser storage, put payloads in URLs, or load third-party scripts and fonts. A query such as `?lens=checkout#consumer-panel` selects a synthetic demonstration, without encoding user payloads or lens contents. A hosting provider still receives normal page and asset requests. Selected file names, lens names, field names and generated review text can themselves be sensitive; review copied summaries and exports before distributing them.

All payload-derived text is escaped before HTML rendering. Raw values are rendered as text within the local evidence inspector. Static build inputs are explicitly selected; Git metadata, command-line code and local development files are not copied into the deployed application.

## Deployment consistency

The build stages selected static files in a temporary directory and computes a SHA-256 content ID from their sorted paths and bytes plus the package version. Rebuilding identical inputs produces the same ID. The built `index.html` references `app.js` and `styles.css` with `?v=<buildID>`, and built browser modules use that same query for relative static JavaScript imports and re-exports. Thus a fresh HTML response after deployment requests one version of the complete module graph instead of reusing cached dependencies from the prior release.

Only the staged artifact is rewritten. Source files are preserved, relative paths continue to work beneath a repository subpath, and an unsuccessful build leaves the previous successful `dist/` in place. The dependency-free rewriter handles this project's quoted static ESM references while leaving dynamic imports, nonrelative package names and quoted/commented examples intact.

## Main modules

| File | Responsibility |
| --- | --- |
| `src/core.js` | Bounded parsing, shape inference, comparison and structural exports |
| `src/input.js` | Browser-only independent JSON/JSONL detection through the bounded core parser |
| `src/consumer.js` | Lens validation/serialization, explicit candidate checks, related drift and value-free Markdown |
| `src/evidence.js` | Typed-path observation lookup and field counts |
| `src/demo.js` | Synthetic examples shared with fixture generation |
| `src/app.js` | Browser state, file import, filters, evidence and downloads |
| `bin/payload-radar.js` | Local file I/O, CLI options and requested CI gates |
| `action.yml` | Composite GitHub Action with Node.js 22 setup, environment-bound inputs and the shared check CLI |
| `scripts/build.mjs` | Static deployment artifact |
| `scripts/assets.mjs` | Stable content build IDs and versioned entry/module URLs in the staged artifact |
| `scripts/serve.mjs` | Loopback-only development and preview server |
