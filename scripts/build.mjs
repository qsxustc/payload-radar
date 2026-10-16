import { mkdir, mkdtemp, readdir, copyFile, lstat, rm, rename, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentBuildID, versionEntrypoints, versionModuleReferences } from './assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const temporary = await mkdtemp(path.join(root, '.payload-radar-build-'));
const previous = `${temporary}-previous`;
let movedPrevious = false;
const files = [];

async function copyTree(relative) {
  const source = path.join(root, relative);
  const target = path.join(temporary, relative);
  const stat = await lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`Build inputs cannot be symlinks: ${relative}`);
  if (stat.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const name of await readdir(source)) {
      if (name.startsWith('.')) continue;
      await copyTree(path.join(relative, name));
    }
  } else if (stat.isFile()) {
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    files.push([relative, await readFile(target)]);
  } else throw new Error(`Build inputs must be regular files or directories: ${relative}`);
}

try {
  for (const relative of ['index.html', 'src', 'assets', 'examples']) await copyTree(relative);
  const packageFile = path.join(root, 'package.json');
  if (!(await lstat(packageFile)).isFile()) throw new Error('Build package.json must be a regular file.');
  const { version } = JSON.parse(await readFile(packageFile, 'utf8'));
  if (typeof version !== 'string' || !version) throw new Error('Build package.json must contain a version.');
  const buildID = contentBuildID(version, files);
  for (const [relative, content] of files) {
    if (relative === 'index.html') await writeFile(path.join(temporary, relative), versionEntrypoints(content.toString('utf8'), buildID));
    else if (relative.startsWith(`src${path.sep}`) && relative.endsWith('.js')) {
      await writeFile(path.join(temporary, relative), versionModuleReferences(content.toString('utf8'), buildID));
    }
  }
  try {
    await rename(output, previous);
    movedPrevious = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try { await rename(temporary, output); }
  catch (error) {
    if (movedPrevious) await rename(previous, output);
    throw error;
  }
  if (movedPrevious) await rm(previous, { recursive: true, force: true });
  console.log(`Built static app in dist/ (build ${buildID})`);
} catch (error) {
  await rm(temporary, { recursive: true, force: true });
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
}
