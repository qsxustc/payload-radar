import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/payload-radar.js', import.meta.url));
const basicLens = {
  kind: 'payload-radar-consumer', schemaVersion: 1, name: 'Checkout',
  rules: [{ tokens: ['total'], types: ['number'], required: true }],
};
function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000, ...options });
}
async function fixture(t, candidate = '{"total":84.5}', lens = basicLens) {
  const directory = await mkdtemp(path.join(tmpdir(), 'payload-radar-lens-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lensFile = path.join(directory, 'checkout.lens.json');
  const candidateFile = path.join(directory, 'candidate.json');
  await writeFile(lensFile, JSON.stringify(lens));
  await writeFile(candidateFile, candidate);
  return { directory, lensFile, candidateFile, args: ['check', lensFile, candidateFile] };
}

test('CLI check help explains explicit rules, JSON lens input and default gates', () => {
  const result = run(['check', '--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /check <consumer\.lens\.json>/);
  assert.match(result.stdout, /check default: risk/);
  assert.match(result.stdout, /256 KiB/);
  assert.match(result.stdout, /optional fields do not violate/);
});

test('CLI executable checks only selected fields and emits a passing JSON report', async t => {
  const f = await fixture(t, '{"total":84.5,"unselected":"arbitrary-new-shape"}');
  const result = spawnSync(cli, [...f.args, '--report', 'json'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.name, 'Checkout');
  assert.equal(report.status, 'pass');
  assert.equal(report.ruleCount, 1);
  assert.equal(report.sampleCount, 1);
  assert.equal(report.violations, 0);
  assert.equal(report.results[0].path, '$.total');
  assert.equal(result.stderr, '');
});

test('CLI check gates observed violations by default and permits an explicit none gate', async t => {
  const f = await fixture(t, '{"total":"secret-value-not-for-report"}');
  const result = run([...f.args, '--report', 'json']);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'fail');
  assert.equal(report.violations, 1);
  assert.equal(report.results[0].mismatched, 1);
  assert.doesNotMatch(result.stdout, /secret-value-not-for-report/);
  for (const gate of ['risk', 'review', 'any']) assert.equal(run([...f.args, '--fail-on', gate]).status, 1, gate);
  const disabled = run([...f.args, '--fail-on', 'none']);
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.match(disabled.stdout, /^#/);
});

test('CLI check distinguishes absent optional fields from disallowed nulls', async t => {
  const lens = { ...basicLens, rules: [{ tokens: ['total'], types: ['number'], required: false }] };
  const f = await fixture(t, '{}', lens);
  const missing = run([...f.args, '--report', 'json']);
  assert.equal(missing.status, 0, missing.stderr);
  assert.equal(JSON.parse(missing.stdout).status, 'review');
  assert.equal(JSON.parse(missing.stdout).violations, 0);
  await writeFile(f.candidateFile, '{"total":null}');
  const result = run([...f.args, '--report', 'json']);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).results[0].mismatched, 1);
});

test('CLI check reports empty-array item rules for review and strict gates catch them', async t => {
  const lens = { ...basicLens, rules: [{ tokens: ['items', null, 'sku'], types: ['string'], required: true }] };
  const f = await fixture(t, '{"items":[]}', lens);
  const result = run([...f.args, '--report', 'json']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'review');
  assert.equal(report.violations, 0);
  assert.equal(report.unobservedRules, 1);
  for (const gate of ['review', 'any']) assert.equal(run([...f.args, '--fail-on', gate]).status, 1, gate);
  assert.equal(run([...f.args, '--fail-on', 'none']).status, 0);
});

test('CLI check applies JSONL format to candidate samples, not the lens file', async t => {
  const f = await fixture(t, '{"total":84.5}\n\n{"total":null}\n');
  await writeFile(f.lensFile, JSON.stringify(basicLens, null, 2));
  const result = run([...f.args, '--format', 'jsonl', '--report', 'json']);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.sampleCount, 2);
  assert.equal(report.results[0].checked, 2);
  assert.equal(report.results[0].mismatched, 1);
});

test('CLI check retains a value-free report when the default gate fails', async t => {
  const f = await fixture(t, '{"total":"private-amount"}');
  const output = path.join(f.directory, 'report.md');
  const result = run([...f.args, '--output', output]);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  const report = await readFile(output, 'utf8');
  assert.match(report, /^#/);
  assert.match(report, /Checkout/);
  assert.match(report, /total/);
  assert.doesNotMatch(report, /private-amount/);
});

test('CLI check rejects invalid lenses and incompatible options with exit 2', async t => {
  const f = await fixture(t);
  for (const args of [f.args.slice(0, 2), [...f.args, '--schema'], [...f.args, '--schema', '--report', 'json'], [...f.args, '--report', 'yaml'], [...f.args, '--fail-on', 'later']]) {
    const result = run(args);
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(result.stdout, '');
  }
  for (const lens of ['not-json', '{}', JSON.stringify({ ...basicLens, schemaVersion: 2 }), JSON.stringify({ ...basicLens, rules: [{ tokens: ['total'], types: ['integer'], required: true }] })]) {
    await writeFile(f.lensFile, lens);
    const result = run(f.args);
    assert.equal(result.status, 2, lens);
    assert.match(result.stderr, /^payload-radar:/);
    assert.equal(result.stdout, '');
  }
});

test('CLI check rejects lens symlinks, directories, invalid UTF-8 and oversized lenses', async t => {
  const f = await fixture(t);
  const linkedLens = path.join(f.directory, 'linked.lens.json');
  await symlink(f.lensFile, linkedLens);
  assert.equal(run(['check', linkedLens, f.candidateFile]).status, 2);
  assert.equal(run(['check', f.directory, f.candidateFile]).status, 2);
  await writeFile(f.lensFile, Buffer.from([0xff]));
  assert.equal(run(f.args).status, 2);
  await writeFile(f.lensFile, ' '.repeat(256 * 1024 + 1));
  const oversized = run(f.args);
  assert.equal(oversized.status, 2);
  assert.match(oversized.stderr, /256 KiB/);
});

test('CLI check applies candidate input safety before writing a report', async t => {
  const f = await fixture(t);
  const output = path.join(f.directory, 'unwritten.json');
  for (const candidate of ['{"total":', ' '.repeat(2 * 1024 * 1024 + 1), Buffer.from([0xff])]) {
    await writeFile(f.candidateFile, candidate);
    const result = run([...f.args, '--output', output]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  }
});

test('CLI check never overwrites either input, existing output or output symlinks', async t => {
  const f = await fixture(t);
  const lensBefore = await readFile(f.lensFile, 'utf8');
  const candidateBefore = await readFile(f.candidateFile, 'utf8');
  const output = path.join(f.directory, 'report.json');
  assert.equal(run([...f.args, '--report', 'json', '--output', output]).status, 0);
  for (const filename of [f.lensFile, f.candidateFile, output]) assert.equal(run([...f.args, '--output', filename]).status, 2);
  const linkedOutput = path.join(f.directory, 'linked-output.json');
  await symlink(f.candidateFile, linkedOutput);
  assert.equal(run([...f.args, '--output', linkedOutput]).status, 2);
  const linkedDirectory = path.join(f.directory, 'alias');
  await symlink(f.directory, linkedDirectory, 'dir');
  assert.equal(run([...f.args, '--output', path.join(linkedDirectory, path.basename(f.lensFile))]).status, 2);
  assert.equal(await readFile(f.lensFile, 'utf8'), lensBefore);
  assert.equal(await readFile(f.candidateFile, 'utf8'), candidateBefore);
});

test('CLI preserves diff mode for a literal baseline filename check after --', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, 'check'), '{"total":84.5}');
  const result = run(['--', 'check', path.basename(f.candidateFile)], { cwd: f.directory });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^#/);
  assert.match(result.stdout, /check/);
});
