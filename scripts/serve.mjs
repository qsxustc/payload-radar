import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let serveDist = false;
let portValue = process.env.PORT || '5190';
let validArgs = true;
const seen = new Set();
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (seen.has(argument)) { validArgs = false; break; }
  seen.add(argument);
  if (argument === '--dist') serveDist = true;
  else if (argument === '--port' && /^\d+$/.test(args[index + 1] || '')) portValue = args[++index];
  else { validArgs = false; break; }
}
if (!validArgs) {
  console.error('Usage: node scripts/serve.mjs [--dist] [--port 5190]');
  process.exit(2);
}
const port = Number(portValue);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Port must be an integer from 1 to 65535.');
  process.exit(2);
}
const root = path.join(project, serveDist ? 'dist' : '.');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jsonl': 'application/x-ndjson; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const server = http.createServer(async (request, response) => {
  const reply = (status, message) => { response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end(message); };
  if (!['GET', 'HEAD'].includes(request.method)) { reply(405, 'Method not allowed'); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    if (relative.includes('\0') || relative.split(/[\\/]/).some(part => part.startsWith('.')) || !/^(index\.html|(?:src|assets|examples)\/[^\\]+)$/.test(relative)) {
      reply(404, 'Not found'); return;
    }
    const filename = path.resolve(root, relative);
    const canonicalRoot = await realpath(root);
    const canonicalFile = await realpath(filename);
    if (!canonicalFile.startsWith(`${canonicalRoot}${path.sep}`) || !(await stat(canonicalFile)).isFile()) {
      reply(404, 'Not found'); return;
    }
    const contentType = types[path.extname(canonicalFile)];
    if (!contentType) { reply(404, 'Not found'); return; }
    const content = request.method === 'HEAD' ? undefined : await readFile(canonicalFile);
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(content);
  } catch (error) {
    reply(error instanceof URIError ? 400 : 404, error instanceof URIError ? 'Bad request' : 'Not found');
  }
});
server.on('error', error => { console.error(`Preview failed: ${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => { console.log(`Payload Radar: http://127.0.0.1:${port}${serveDist ? ' (dist)' : ''}`); });
