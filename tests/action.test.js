import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const metadata = await readFile(new URL('../action.yml', import.meta.url), 'utf8');
const runBlocks = [...metadata.matchAll(/^      run: \|\n((?:        .*\n?)+)/gm)];
assert.equal(runBlocks.length, 1, 'Expected one actual composite run block.');
const script = runBlocks[0][1].split('\n').map(line => line.slice(8)).join('\n');
assert.ok(!script.includes('${{'), 'Action inputs must go through environment variables, not shell interpolation.');
const environment = [...metadata.matchAll(/^        (PAYLOAD_RADAR_[A-Z_]+): \$\{\{ inputs\.([a-z-]+) \}\}$/gm)].map(match => [match[1], match[2]]);
const inputSection = metadata.split('\ninputs:\n')[1].split('\nruns:\n')[0];
const defaults = Object.fromEntries([...inputSection.matchAll(/^  ([a-z-]+):\n((?:    .*\n?)+)/gm)].map(match => [match[1], match[2].match(/^    default: '(.*)'$/m)?.[1] ?? '']));

const lens = {
  kind: 'payload-radar-consumer', schemaVersion: 1, name: 'Consumer CI',
  rules: [{ tokens: ['total'], types: ['number'], required: true }],
};
async function workspace(t, candidate = '{"total":84.5}', consumer = lens) {
  const directory = await mkdtemp(path.join(tmpdir(), 'payload-radar-action-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'consumer.lens.json'), JSON.stringify(consumer));
  await writeFile(path.join(directory, 'candidate.json'), candidate);
  return directory;
}
function run(directory, inputs = {}) {
  const values = { ...defaults, lens: 'consumer.lens.json', candidate: 'candidate.json', ...inputs };
  const env = { ...process.env, GITHUB_ACTION_PATH: root };
  for (const [name, input] of environment) env[name] = values[input];
  return spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], { cwd: directory, env, encoding: 'utf8', timeout: 10000 });
}

test('composite action declares required paths, runtime and documented defaults', () => {
  assert.match(metadata, /using: composite/);
  assert.match(metadata, /uses: actions\/setup-node@v4\n      with:\n        node-version: '22'/);
  assert.match(inputSection, /  lens:\n    description: .*\n    required: true/);
  assert.match(inputSection, /  candidate:\n    description: .*\n    required: true/);
  assert.deepEqual(defaults, { lens: '', candidate: '', format: 'json', 'fail-on': 'risk', report: 'markdown', output: '' });
  assert.equal(environment.length, 6);
});

test('actual composite script checks files in the caller workspace and passes valid samples', async t => {
  const directory = await workspace(t);
  const result = run(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^# Payload Radar consumer check/);
  assert.match(result.stdout, /pass/);
});

test('actual composite script propagates a candidate failure and supports disabling its gate', async t => {
  const directory = await workspace(t, '{"total":"not-a-number"}');
  const result = run(directory, { report: 'json' });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).violations, 1);
  assert.equal(run(directory, { 'fail-on': 'none' }).status, 0);
});

test('actual composite script passes JSONL and report options and preserves a failing report', async t => {
  const directory = await workspace(t, '{"total":84.5}\n{"total":null}\n');
  const options = { format: 'jsonl', report: 'json', output: 'consumer report.json' };
  const result = run(directory, options);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  const report = JSON.parse(await readFile(path.join(directory, options.output), 'utf8'));
  assert.equal(report.sampleCount, 2);
  assert.equal(report.violations, 1);
  assert.equal(run(directory, options).status, 2, 'Existing reports must not be overwritten.');
});

test('actual composite script supports review gates for unobserved array rules', async t => {
  const consumer = { ...lens, rules: [{ tokens: ['items', null, 'id'], types: ['string'], required: true }] };
  const directory = await workspace(t, '{"items":[]}', consumer);
  assert.equal(run(directory).status, 0);
  const result = run(directory, { 'fail-on': 'review', report: 'json' });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'review');
});

test('actual composite script treats spaces and shell syntax in paths as literal data', async t => {
  const directory = await workspace(t);
  const inputs = { lens: 'lens $(touch lens-marker).json', candidate: 'candidate $(touch candidate-marker).json', output: 'report $(touch output-marker).json', report: 'json' };
  await writeFile(path.join(directory, inputs.lens), JSON.stringify(lens));
  await writeFile(path.join(directory, inputs.candidate), '{"total":42}');
  const result = run(directory, inputs);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(await readFile(path.join(directory, inputs.output), 'utf8')).status, 'pass');
  for (const marker of ['lens-marker', 'candidate-marker', 'output-marker']) await assert.rejects(access(path.join(directory, marker)), { code: 'ENOENT' });
  await writeFile(path.join(directory, '-lens.json'), JSON.stringify(lens));
  await writeFile(path.join(directory, '-candidate.json'), '{"total":42}');
  assert.equal(run(directory, { lens: '-lens.json', candidate: '-candidate.json' }).status, 0);
  const invalid = run(directory, { format: 'json; touch option-marker' });
  assert.equal(invalid.status, 2);
  await assert.rejects(access(path.join(directory, 'option-marker')), { code: 'ENOENT' });
});

test('actual composite script rejects missing required inputs before running the check', async t => {
  const directory = await workspace(t);
  for (const inputs of [{ lens: '' }, { candidate: '' }]) {
    const result = run(directory, inputs);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /lens and candidate inputs are required/);
    assert.equal(result.stdout, '');
  }
});
