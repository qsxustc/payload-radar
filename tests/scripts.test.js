import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, symlink, rm, access } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

async function site(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'payload-radar-scripts-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const folder of ['scripts', 'src', 'assets', 'examples', '.git']) await mkdir(path.join(directory, folder));
  for (const name of ['build.mjs', 'serve.mjs']) await copyFile(new URL(`../scripts/${name}`, import.meta.url), path.join(directory, 'scripts', name));
  await writeFile(path.join(directory, 'index.html'), '<h1>Payload Radar fixture</h1>');
  await writeFile(path.join(directory, 'src', 'app.js'), 'export const value = 1;');
  await writeFile(path.join(directory, 'assets', 'logo.svg'), '<svg/>');
  await writeFile(path.join(directory, 'assets', 'demo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await writeFile(path.join(directory, 'examples', 'sample.json'), '{}');
  await writeFile(path.join(directory, '.git', 'config'), 'private git config');
  await writeFile(path.join(directory, '.env'), 'PRIVATE_TOKEN=secret');
  await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
  return directory;
}

function build(directory) { return spawnSync(process.execPath, [path.join(directory, 'scripts', 'build.mjs')], { encoding: 'utf8', timeout: 10000 }); }

test('build copies selected static files, excludes local metadata and replaces stale output', async t => {
  const directory = await site(t);
  let result = build(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(path.join(directory, 'dist', 'index.html'), 'utf8'), /fixture/);
  assert.equal(await readFile(path.join(directory, 'dist', 'src', 'app.js'), 'utf8'), 'export const value = 1;');
  for (const excluded of ['.git', '.env', 'package.json', 'scripts']) await assert.rejects(access(path.join(directory, 'dist', excluded)));
  await writeFile(path.join(directory, 'dist', 'obsolete.txt'), 'old');
  result = build(directory);
  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(access(path.join(directory, 'dist', 'obsolete.txt')));
});

test('build rejects symlink inputs and preserves the last successful build', async t => {
  const directory = await site(t);
  assert.equal(build(directory).status, 0);
  await symlink(path.join(directory, '.env'), path.join(directory, 'assets', 'secret.txt'));
  const result = build(directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /symlinks/);
  assert.match(await readFile(path.join(directory, 'dist', 'index.html'), 'utf8'), /fixture/);
  await assert.rejects(access(path.join(directory, 'dist', 'assets', 'secret.txt')));
});

function request(port, requestPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: requestPath, method }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString(), headers: response.headers }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('loopback server serves app files and denies metadata, traversal and symlink escapes', async t => {
  const directory = await site(t);
  await symlink(path.join(directory, '.env'), path.join(directory, 'assets', 'secret.json'));
  const outside = `${directory}-outside.json`;
  await writeFile(outside, '{"private":"outside app directory"}');
  t.after(() => rm(outside, { force: true }));
  await symlink(outside, path.join(directory, 'assets', 'outside.json'));
  // Select an available port, then immediately hand it to the server under test.
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, [path.join(directory, 'scripts', 'serve.mjs'), '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start')), 5000);
    child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited: ${code}`)); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
  });
  const index = await request(port, '/');
  assert.equal(index.status, 200);
  assert.match(index.body, /Payload Radar fixture/);
  assert.match(index.headers['content-type'], /text\/html/);
  assert.equal((await request(port, '/src/app.js')).status, 200);
  const screenshot = await request(port, '/assets/demo.jpg');
  assert.equal(screenshot.status, 200);
  assert.equal(screenshot.headers['content-type'], 'image/jpeg');
  const head = await request(port, '/src/app.js', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  for (const forbidden of ['/.git/config', '/.env', '/package.json', '/src/../../.env', '/src/%2e%2e/%2e%2e/.env', '/assets/secret.json', '/assets/outside.json']) {
    assert.equal((await request(port, forbidden)).status, 404, forbidden);
  }
  assert.equal((await request(port, '/%E0%A4%A')).status, 400);
  assert.equal((await request(port, '/', 'POST')).status, 405);
});

test('server rejects invalid options and port values', async t => {
  const directory = await site(t);
  for (const args of [['--port'], ['--port', '0'], ['--port', '65536'], ['--wat'], ['5190'], ['--dist', '--dist']]) {
    const result = spawnSync(process.execPath, [path.join(directory, 'scripts', 'serve.mjs'), ...args], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 2, args.join(' '));
  }
});
