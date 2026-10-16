# Contributing

Thanks for helping make payload changes easier to review. Good contributions include reproducible inference bugs, clearer evidence, accessibility improvements, realistic synthetic examples and documentation corrections.

## Run locally

Use Node.js 20 or newer. No dependencies need installing.

```sh
npm run dev
npm test
npm run build
npm run preview
```

The browser app is at `http://127.0.0.1:5190`. Both the browser and CLI must use `src/core.js` for inference and report semantics. See [architecture](docs/architecture.md) before changing field presence, array handling or paths.

## Submit a change

1. Open an issue for a substantial feature or behavior change, describing the user problem and expected result.
2. Create a focused branch and make the change. Keep runtime and build tooling dependency-free unless a clearly justified design discussion establishes otherwise.
3. Add meaningful regression coverage for changed inference, CLI I/O or security boundaries. Use Node's built-in test runner and synthetic fixtures.
4. Run `npm test` and `npm run build`. For UI changes, also inspect the browser at desktop and narrow widths, test keyboard navigation and confirm imports and exports still work.
5. Open a pull request with the problem, resulting behavior and validation. Add a screenshot for visible UI changes. Do not include real customer payloads or credentials.

## Useful bug reports

Include your Node/browser version, selected format, a minimal synthetic before/after pair, what happened, and what you expected. A JSON document and a JSONL sample set have different meaning; specify which was used. If a sample cannot be made public, describe the structure using invented values.

Severity labels describe review priority, not a verified API guarantee. Preserve that distinction in the UI, exports and docs. Do not add language that claims samples prove compatibility or an externally required field.

The repository includes GitHub Actions checks for Node 20, 22 and 24. Contributions are covered by the [MIT license](LICENSE).
