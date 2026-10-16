# Architecture

Payload Radar has a static browser app and a Node.js command-line entry point. Both use the same ES module inference engine. There are no runtime or build dependencies.

## Data flow

1. The browser accepts pasted text or reads a user-selected UTF-8 file into memory. The CLI reads two local regular files.
2. `parseInput` interprets a single JSON document or a set of JSON Lines samples. A top-level JSON array stays a single document. It is not silently converted into independent top-level samples.
3. `inferShape` merges the observed value types, object properties, array items and observation counts into a shape tree. The tree contains no raw sample values.
4. `compareShapes` walks baseline and candidate trees and returns findings with typed paths and before/after observation counts.
5. The browser sorts findings by severity and presents local sample evidence. Markdown, JSON and JSON Schema exports contain structure, names and counts, without raw sample values.

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

The app does not call an API, persist payloads in browser storage, put payloads in URLs, or load third-party scripts and fonts. A hosting provider still receives normal page and asset requests. Selected file names, field names and generated review text can themselves be sensitive; review exports before distributing them.

All payload-derived text is escaped before HTML rendering. Raw values are rendered as text within the local evidence inspector. Static build inputs are explicitly selected; Git metadata, command-line code and local development files are not copied into the deployed application.

## Main modules

| File | Responsibility |
| --- | --- |
| `src/core.js` | Bounded parsing, shape inference, comparison and structural exports |
| `src/evidence.js` | Typed-path observation lookup and field counts |
| `src/demo.js` | Synthetic examples shared with fixture generation |
| `src/app.js` | Browser state, file import, filters, evidence and downloads |
| `bin/payload-radar.js` | Local file I/O, CLI options and requested CI gates |
| `scripts/build.mjs` | Static deployment artifact |
| `scripts/serve.mjs` | Loopback-only development and preview server |
