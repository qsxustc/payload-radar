import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, symlink, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInput, inferShape, compareShapes, toJSONSchema } from '../src/core.js';

const cli = fileURLToPath(new URL('../bin/payload-radar.js', import.meta.url));
function run(args) { return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000 }); }
async function fixture(t, before = '{"id":1,"name":"Ada"}', after = '{"id":"1"}') {
  const directory = await mkdtemp(path.join(tmpdir(), 'payload-radar-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const beforeFile = path.join(directory, 'before.json');
  const afterFile = path.join(directory, 'after.json');
  await writeFile(beforeFile, before);
  await writeFile(afterFile, after);
  return { directory, beforeFile, afterFile, files: [beforeFile, afterFile], before, after };
}

test('CLI help explains formats and exit codes', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /JSONL is one sample per nonempty line/);
  assert.match(result.stdout, /Exit codes: 0 success, 1 requested gate detected, 2/);
  assert.equal(result.stderr, '');
});

test('CLI JSON report uses the shared engine and preserves input files', async t => {
  const f = await fixture(t);
  const result = run([...f.files, '--report', 'json']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.beforeName, 'before.json');
  assert.equal(report.afterName, 'after.json');
  assert.equal(report.beforeSamples, 1);
  assert.equal(report.afterSamples, 1);
  assert.deepEqual(report.changes, compareShapes(inferShape(parseInput(f.before)), inferShape(parseInput(f.after))));
  assert.equal(await readFile(f.beforeFile, 'utf8'), f.before);
  assert.equal(await readFile(f.afterFile, 'utf8'), f.after);
});

test('CLI defaults to a Markdown report without failing on changes', async t => {
  const f = await fixture(t);
  const result = run(f.files);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^#/);
  assert.match(result.stdout, /before\.json/);
});

test('CLI JSONL blank lines are not independent samples', async t => {
  const f = await fixture(t, '{"id":1}\n\n{"id":2}\n', '{"id":"1"}\n{"id":"2"}\n');
  const result = run([...f.files, '--format', 'jsonl', '--report', 'json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).beforeSamples, 2);
  assert.equal(JSON.parse(result.stdout).afterSamples, 2);
});

test('CLI schema is inferred from candidate samples using shared engine', async t => {
  const f = await fixture(t);
  const result = run([...f.files, '--schema']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), JSON.parse(JSON.stringify(toJSONSchema(inferShape(parseInput(f.after))))));
});

test('CLI gates risk, review and any; none and unchanged data pass', async t => {
  const f = await fixture(t);
  for (const gate of ['risk', 'review', 'any']) {
    const result = run([...f.files, '--fail-on', gate]);
    assert.equal(result.status, 1, `${gate}: ${result.stderr}`);
    assert.ok(result.stdout.length > 0);
  }
  assert.equal(run([...f.files, '--fail-on', 'none']).status, 0);
  assert.equal(run([f.beforeFile, f.beforeFile, '--fail-on', 'any']).status, 0);
});

test('CLI rejects invalid and ambiguous arguments', async t => {
  const f = await fixture(t);
  const cases = [[], [f.beforeFile], [...f.files, f.afterFile], [...f.files, '--unknown'], [...f.files, '--format'], [...f.files, '--format', 'csv'], [...f.files, '--report', 'xml'], [...f.files, '--fail-on', 'maybe'], [...f.files, '--schema', '--report', 'json'], [...f.files, '--format', 'json', '--format', 'jsonl']];
  for (const args of cases) {
    const result = run(args);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, /^payload-radar:/);
    assert.equal(result.stdout, '');
  }
});

test('CLI rejects malformed JSON and reports malformed JSONL input', async t => {
  const f = await fixture(t, '{"id":', '{"id":1}');
  assert.equal(run(f.files).status, 2);
  await writeFile(f.beforeFile, '{"id":1}\nnot json');
  const result = run([...f.files, '--format', 'jsonl']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /2|line/i);
});

test('CLI rejects invalid UTF-8, oversized files and directories', async t => {
  const f = await fixture(t);
  await writeFile(f.beforeFile, Buffer.from([0xff]));
  assert.equal(run(f.files).status, 2);
  await writeFile(f.beforeFile, ' '.repeat(2 * 1024 * 1024 + 1));
  const oversized = run(f.files);
  assert.equal(oversized.status, 2);
  assert.match(oversized.stderr, /2 MiB/);
  assert.equal(run([f.directory, f.afterFile]).status, 2);
});

test('CLI rejects input symlinks but permits symlinked parent directories', async t => {
  const f = await fixture(t);
  const linkedFile = path.join(f.directory, 'linked.json');
  await symlink(f.beforeFile, linkedFile);
  const rejected = run([linkedFile, f.afterFile]);
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /symlinks/);
  const linkedDirectory = path.join(f.directory, 'linked-directory');
  const actualDirectory = path.join(f.directory, 'actual-directory');
  await mkdir(actualDirectory);
  await writeFile(path.join(actualDirectory, 'input.json'), '{}');
  await symlink(actualDirectory, linkedDirectory, 'dir');
  assert.equal(run([path.join(linkedDirectory, 'input.json'), f.afterFile]).status, 0);
});

test('CLI writes a new output and never overwrites existing files or inputs', async t => {
  const f = await fixture(t);
  const output = path.join(f.directory, 'report.json');
  const result = run([...f.files, '--report', 'json', '--output', output]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(JSON.parse(await readFile(output, 'utf8')).changes.length > 0);
  assert.equal(run([...f.files, '--output', output]).status, 2);
  assert.equal(run([...f.files, '--output', f.beforeFile]).status, 2);
  const linkedOutput = path.join(f.directory, 'linked-output.json');
  await symlink(f.afterFile, linkedOutput);
  assert.equal(run([...f.files, '--output', linkedOutput]).status, 2);
  assert.equal(await readFile(f.beforeFile, 'utf8'), f.before);
  assert.equal(await readFile(f.afterFile, 'utf8'), f.after);
});

test('CLI retains report output when a requested gate fails', async t => {
  const f = await fixture(t);
  const output = path.join(f.directory, 'gate.md');
  const result = run([...f.files, '--fail-on', 'risk', '--output', output]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(await readFile(output, 'utf8'), /^#/);
});
