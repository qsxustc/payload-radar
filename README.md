<p align="center"><img src="assets/logo.svg" alt="Payload Radar" width="80"></p>
<h1 align="center">Payload Radar</h1>
<p align="center"><strong>Your JSON changed. See what your code might trip over.</strong></p>
<p align="center">A local-first payload shape inspector · Browser + CLI · Zero dependencies · MIT</p>
<p align="center">English · <a href="README.zh-CN.md">简体中文</a></p>
<p align="center"><a href="https://qsxustc.github.io/payload-radar/"><strong>Try the live demo</strong></a> · <a href="https://github.com/qsxustc/payload-radar">GitHub</a> · <a href="https://github.com/qsxustc/payload-radar/actions/workflows/ci.yml">CI</a></p>

Compare JSON or JSON Lines samples before and after an API change. Payload Radar highlights new value types, fields no longer observed, nullability and field-presence changes, then shows the local evidence behind each finding.

An order total changing from `84.5` to `"84.50"` can break a calculation. A different order ID usually does not. Payload Radar focuses on that distinction so you can review structural drift without reading a wall of value diffs.

![Payload Radar showing checkout API changes and sample evidence](assets/demo.jpg)

## Try it in a minute

Open the [live demo](https://qsxustc.github.io/payload-radar/) to explore immediately. Or run it locally:

```sh
git clone https://github.com/qsxustc/payload-radar.git
cd payload-radar
npm run dev
```

Open **http://127.0.0.1:5190**. Requires **Node.js 20 or newer**; there is no dependency installation step. The app opens with a synthetic checkout example ready to inspect. Use **Examples** for a webhook edge case or a release whose values change while its shape stays the same.

You can also run the CLI immediately:

```sh
node bin/payload-radar.js \
  examples/checkout-before.jsonl examples/checkout-after.jsonl \
  --format jsonl
```

## What you get

- **Structural findings:** missing observed fields, new fields, new value types, first-observed nulls, presence shifts and empty-array evidence gaps.
- **Evidence you can inspect:** select a finding to see observed values and absence locations, with sample numbers and paths. The inspector displays up to six observations per side.
- **A focused review:** severity filters, path search, before/after presence counts, and coverage notes.
- **Portable exports:** Markdown review, machine-readable JSON findings, and a JSON Schema draft inferred from the candidate samples.
- **One shared engine:** the browser, CLI and programmatic API use the same dependency-free ES module.
- **Local processing:** no payload upload, analytics, API keys, third-party scripts or browser persistence.

## Understand the input format

Choose one format for both sides. Files must contain UTF-8 text.

| Format | Meaning | Example |
| --- | --- | --- |
| JSON | One complete document is one sample, even if it is an array | `[{"id":1},{"id":2}]` is one array sample |
| JSONL / JSON Lines | Each nonempty line is one complete JSON sample | Two lines containing `{"id":1}` and `{"id":2}` are two object samples |

Blank JSONL lines are ignored. Pretty-printed multiline objects belong in JSON mode. Input limits are **2 MiB per side**, **1,000 top-level samples**, **64 nesting levels**, and **50,000 visited values per side**. Large inputs should be reduced to a representative subset.

Field names are limited to **1,024 UTF-16 code units** each. A cumulative structural path is limited to **4,096 UTF-16 code units**, counting each property name plus one separator and each array-item step as two units. Across all findings, the combined UTF-8 size of the individually JSON-encoded `{ id, path, pointer, tokens }` objects must not exceed **2 MiB**. This is a budget for finding locations, not a limit on the entire exported report. Shorten field names or compare smaller sample groups when a limit is reached.

Object property presence is counted within observed objects at its immediate parent. Array items are pooled across all samples; they are not matched by ID or position. For example, three objects in one array contribute three object observations to the fields inside that array.

## CLI

```text
payload-radar <before-file> <after-file> [options]

--format json|jsonl             default: json
--report markdown|json          default: markdown
--fail-on risk|review|any|none   default: none
--schema                       export the candidate JSON Schema draft
--output <path>                write a new file; existing files are never overwritten
--help, -h
```

Use `node bin/payload-radar.js` from a clone. `npm link` optionally makes the `payload-radar` command available locally; this project does not require a published npm package.

```sh
# A machine-readable report
node bin/payload-radar.js before.json after.json --report json

# A CI gate: exit 1 when a potential risk was observed
node bin/payload-radar.js before.json after.json --fail-on risk

# Save the candidate schema draft to a new file
node bin/payload-radar.js before.json after.json --schema --output candidate.schema.json

# Save a Markdown report and gate risk or review findings
node bin/payload-radar.js before.json after.json --fail-on review --output review.md
```

`--fail-on review` includes both `risk` and `review`; `any` includes informational findings too. Reports are written before evaluating the gate, so a failing gate still leaves its report available. `--schema` cannot be combined with an explicit `--report`. Schema mode still takes both input files and applies the requested comparison gate.

Exit codes: **0** for success or a passing gate, **1** for a requested gate with matching findings, **2** for invalid arguments, invalid inputs or I/O errors. Input files must be regular files; final file symlinks are rejected. Parent directory symlinks such as macOS `/tmp` are supported. Output files are created exclusively and cannot overwrite either input or an existing output.

## Use the engine

```js
import {
  parseInput, inferShape, compareShapes, toJSONSchema, toMarkdown,
} from './src/core.js';

const beforeSamples = parseInput('{"total":84.5}', 'json');
const afterSamples = parseInput('{"total":"84.50"}', 'json');
const before = inferShape(beforeSamples);
const after = inferShape(afterSamples);
const changes = compareShapes(before, after);

console.log(changes);
console.log(toJSONSchema(after));
console.log(toMarkdown({
  beforeName: 'before.json', afterName: 'after.json',
  beforeSamples: beforeSamples.length, afterSamples: afterSamples.length,
  changes,
}));
```

Findings include a human-readable `path`, a pointer-like `pointer`, typed `tokens`, a severity, a kind, observed types and presence counts. A `null` token represents an array item; string tokens are literal property names. For traversing data, prefer `tokens`: display paths and array wildcard pointers are not concrete JSON Pointers. See [architecture](docs/architecture.md) for details.

## Know the limits

**This is sample inference, not a verified API contract.** A missing field may simply be absent from your chosen examples. An unchanged result does not prove compatibility. Severity labels prioritize human review; they are not a guarantee that a consumer will break or remain safe.

- Empty arrays establish the `array` type but provide no evidence about their items. Reduced item evidence is surfaced for review instead of pretending it proves a field removal.
- Value-only changes, enums, formats, number ranges, tuple positions, discriminators and cross-field rules are outside this release's analysis.
- Numbers use JavaScript number precision, and all finite numbers share the `number` type. Large integer identifiers should be encoded as strings when exact precision matters. The tool does not infer `integer` separately.
- Generated JSON Schema describes observed candidate samples. Fields seen in every parent object are marked `required`; that is an observation, not proof they are required by the API. Additional properties remain allowed. Review the draft before using it as a contract.
- The page and assets are fetched from the hosting provider, but payload content stays in the current tab. Refreshing closes that in-memory workspace. Exports omit raw sample values, but field names, file names and structural findings can still be sensitive.

## Develop and deploy

```sh
npm test            # Node's built-in test runner
npm run build       # writes a static app to dist/
npm run preview     # serves dist/ on http://127.0.0.1:5190
```

Use `npm run dev -- --port 5191` or `npm run preview -- --port 5191` to select another port. The development server binds to loopback and serves only app assets. Builds copy `index.html`, `src/`, `assets/` and `examples/`; local metadata and CLI code are not deployed.

The included [Pages workflow](.github/workflows/pages.yml) tests and builds on `main` pushes or manual dispatch, then deploys `dist/`. Enable **GitHub Actions** as the Pages source in repository settings. All asset paths are relative, so the static app can also be hosted under a subdirectory or on another static host.

See [CONTRIBUTING](CONTRIBUTING.md), [security reporting](SECURITY.md), [architecture](docs/architecture.md), [changelog](CHANGELOG.md), and [launch notes](docs/launch.md). Licensed under [MIT](LICENSE).

If Payload Radar makes a release review easier, a star helps other developers discover it. Bug reports with small synthetic examples are especially welcome.
