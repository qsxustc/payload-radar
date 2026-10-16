#!/usr/bin/env node
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseInput, inferShape, compareShapes, toJSONSchema, toMarkdown } from '../src/core.js';
import { parseLens, checkLens, lensMarkdown } from '../src/consumer.js';

const MAX_BYTES = 2 * 1024 * 1024;
const LENS_MAX_BYTES = 256 * 1024;
const HELP = `Payload Radar — inspect JSON drift and check the fields your code consumes

Usage: payload-radar <before-file> <after-file> [options]
       payload-radar check <consumer.lens.json> <candidate-file> [options]

Options:
  --format json|jsonl             Input format for both files (default: json)
  --report markdown|json          Report format (default: markdown)
  --fail-on risk|review|any|none   CI gate (diff default: none; check default: risk)
  --schema                       Emit candidate JSON Schema (diff mode only)
  --output <path>                Write a new file instead of stdout; never overwrite
  --help, -h                     Show this help

--schema and an explicit --report cannot be combined.
In diff mode, review gates risk and review changes; any gates every change.
In check mode, risk gates rule violations; review and any also gate unobserved
rules (for example, item rules with only empty arrays); none disables the gate.
Check reads an explicit Consumer Lens, not an inferred API contract. Missing
optional fields do not violate rules; present nulls require an allowed null type.
--format applies only to the candidate file in check mode. Lens files are JSON.
JSON is one sample per file. JSONL is one sample per nonempty line.
Input files must be regular files, at most 2 MiB each; file symlinks are rejected.
Consumer Lens files must be at most 256 KiB. Outputs never replace either input.
Use -- check <after-file> to compare a baseline file literally named check.
Exit codes: 0 success, 1 requested gate detected, 2 invalid input or I/O error.
`;

function parseArguments(args) {
  const mode = args[0] === 'check' ? 'check' : 'diff';
  if (mode === 'check') args = args.slice(1);
  const options = { mode, format: 'json', report: 'markdown', failOn: mode === 'check' ? 'risk' : 'none', schema: false, output: null, files: [] };
  let explicitReport = false;
  let positionalOnly = false;
  const seen = new Set();
  for (let i = 0; i < args.length; i += 1) {
    const argument = args[i];
    if (!positionalOnly && argument === '--') { positionalOnly = true; continue; }
    if (!positionalOnly && (argument === '--help' || argument === '-h')) return { help: true };
    if (!positionalOnly && argument.startsWith('-')) {
      if (!['--format', '--report', '--fail-on', '--schema', '--output'].includes(argument)) throw new Error(`Unknown option: ${argument}`);
      if (seen.has(argument)) throw new Error(`Option provided more than once: ${argument}`);
      seen.add(argument);
      if (argument === '--schema') { options.schema = true; continue; }
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
      if (argument === '--format') options.format = value;
      if (argument === '--report') { options.report = value; explicitReport = true; }
      if (argument === '--fail-on') options.failOn = value;
      if (argument === '--output') options.output = value;
    } else options.files.push(argument);
  }
  if (options.files.length !== 2) throw new Error('Provide exactly two input files. Run --help for usage.');
  if (!['json', 'jsonl'].includes(options.format)) throw new Error('--format must be json or jsonl.');
  if (!['markdown', 'json'].includes(options.report)) throw new Error('--report must be markdown or json.');
  if (!['risk', 'review', 'any', 'none'].includes(options.failOn)) throw new Error('--fail-on must be risk, review, any, or none.');
  if (options.mode === 'check' && options.schema) throw new Error('--schema is not available in check mode.');
  if (options.schema && explicitReport) throw new Error('--schema cannot be combined with --report.');
  return options;
}

async function inputPath(filename) {
  const absolute = path.resolve(filename);
  const stat = await lstat(absolute);
  if (stat.isSymbolicLink()) throw new Error(`Input files cannot be symlinks: ${filename}`);
  if (!stat.isFile()) throw new Error(`Input must be a regular file: ${filename}`);
  const parent = await realpath(path.dirname(absolute));
  return path.join(parent, path.basename(absolute));
}

async function readInput(filename, maxBytes = MAX_BYTES, limitLabel = '2 MiB') {
  const absolute = await inputPath(filename);
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`Input must be a regular file: ${filename}`);
    if (stat.size > maxBytes) throw new Error(`Input exceeds ${limitLabel}: ${filename}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length;
      if (size > maxBytes) throw new Error(`Input exceeds ${limitLabel}: ${filename}`);
      chunks.push(chunk);
    }
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)), absolute };
  } finally {
    await handle.close();
  }
}

async function writeOutput(filename, output, inputPaths) {
  const absolute = path.resolve(filename);
  const parent = await realpath(path.dirname(absolute));
  const canonical = path.join(parent, path.basename(absolute));
  if (inputPaths.includes(absolute) || inputPaths.includes(canonical)) throw new Error('Output must not replace an input file.');
  const handle = await open(absolute, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try { await handle.writeFile(output, 'utf8'); }
  finally { await handle.close(); }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { process.stdout.write(HELP); return; }
  if (options.mode === 'check') {
    const lensInput = await readInput(options.files[0], LENS_MAX_BYTES, '256 KiB');
    const candidateInput = await readInput(options.files[1]);
    const lens = parseLens(lensInput.text);
    const report = checkLens(lens, parseInput(candidateInput.text, options.format));
    const output = options.report === 'json' ? `${JSON.stringify(report, null, 2)}\n` : `${lensMarkdown(report).trimEnd()}\n`;
    if (options.output) await writeOutput(options.output, output, [lensInput.absolute, candidateInput.absolute]);
    else process.stdout.write(output);
    const gated = options.failOn === 'none' ? false
      : options.failOn === 'risk' ? report.violations > 0
        : report.violations > 0 || report.unobservedRules > 0;
    if (gated) process.exitCode = 1;
    return;
  }
  const beforeInput = await readInput(options.files[0]);
  const afterInput = await readInput(options.files[1]);
  const beforeSamples = parseInput(beforeInput.text, options.format);
  const afterSamples = parseInput(afterInput.text, options.format);
  const before = inferShape(beforeSamples);
  const after = inferShape(afterSamples);
  const changes = compareShapes(before, after);
  const report = {
    beforeName: path.basename(options.files[0]),
    afterName: path.basename(options.files[1]),
    beforeSamples: beforeSamples.length,
    afterSamples: afterSamples.length,
    changes,
  };
  const output = options.schema ? `${JSON.stringify(toJSONSchema(after), null, 2)}\n`
    : options.report === 'json' ? `${JSON.stringify(report, null, 2)}\n`
      : `${toMarkdown(report).trimEnd()}\n`;
  if (options.output) await writeOutput(options.output, output, [beforeInput.absolute, afterInput.absolute]);
  else process.stdout.write(output);
  const gated = options.failOn === 'any' ? changes.length > 0
    : options.failOn === 'review' ? changes.some(change => ['risk', 'review'].includes(change.severity))
      : options.failOn === 'risk' ? changes.some(change => change.severity === 'risk') : false;
  if (gated) process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`payload-radar: ${error.message}\n`);
  process.exitCode = 2;
});
