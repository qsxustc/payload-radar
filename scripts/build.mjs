import { mkdir, mkdtemp, readdir, copyFile, lstat, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const temporary = await mkdtemp(path.join(root, '.payload-radar-build-'));
const previous = `${temporary}-previous`;
let movedPrevious = false;

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
  } else throw new Error(`Build inputs must be regular files or directories: ${relative}`);
}

try {
  for (const relative of ['index.html', 'src', 'assets', 'examples']) await copyTree(relative);
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
  console.log('Built static app in dist/');
} catch (error) {
  await rm(temporary, { recursive: true, force: true });
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
}
