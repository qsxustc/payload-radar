import { createHash } from 'node:crypto';

/** Stable across traversal order and rebuilds; paths and lengths separate inputs. */
export function contentBuildID(version, files) {
  const hash = createHash('sha256');
  const add = value => {
    const content = Buffer.from(value);
    hash.update(`${content.length}:`);
    hash.update(content);
  };
  add(version);
  for (const [name, content] of [...files].sort(([left], [right]) => left.localeCompare(right, 'en'))) {
    add(name.replaceAll('\\', '/'));
    add(content);
  }
  return hash.digest('hex').slice(0, 16);
}

function skipQuoted(source, start) {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') index += 2;
    else if (source[index++] === quote) break;
  }
  return index;
}

function skipComment(source, start) {
  if (source[start + 1] === '/') {
    const end = source.indexOf('\n', start + 2);
    return end < 0 ? source.length : end;
  }
  const end = source.indexOf('*/', start + 2);
  return end < 0 ? source.length : end + 2;
}

function startsRegex(source, index) {
  const prefix = source.slice(0, index).trimEnd();
  return !prefix || /[=(:,\[!&|?{};]$/.test(prefix) || /\b(?:return|throw|case|yield)\s*$/.test(prefix);
}

function skipRegex(source, start) {
  let index = start + 1;
  let inClass = false;
  while (index < source.length && !['\n', '\r'].includes(source[index])) {
    const character = source[index++];
    if (character === '\\') index++;
    else if (character === '[') inClass = true;
    else if (character === ']') inClass = false;
    else if (character === '/' && !inClass) return index;
  }
  return index;
}

function skipTemplate(source, start) {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') index += 2;
    else if (source[index] === '`') return index + 1;
    else if (source[index] === '$' && source[index + 1] === '{') {
      index += 2;
      let depth = 1;
      while (index < source.length && depth) {
        const character = source[index];
        if (character === '"' || character === "'") index = skipQuoted(source, index);
        else if (character === '`') index = skipTemplate(source, index);
        else if (character === '/' && ['/', '*'].includes(source[index + 1])) index = skipComment(source, index);
        else if (character === '/' && startsRegex(source, index)) index = skipRegex(source, index);
        else { if (character === '{') depth++; if (character === '}') depth--; index++; }
      }
    } else index++;
  }
  return index;
}

// This project's static ESM declarations use quoted, relative .js specifiers.
// Match complete import/from or re-export prefixes in code, never arbitrary
// strings containing a filename. Dynamic imports and import.meta stay intact.
const staticReference = /^(?:import\s+(?:[^'";()]+?\s+from\s+)?|export\s+(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)\s+from\s+)(['"])(\.{1,2}\/[^'"\r\n?#]+\.js)\1/;

export function versionModuleReferences(source, buildID) {
  let result = '';
  let copied = 0;
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '"' || character === "'") { index = skipQuoted(source, index); continue; }
    if (character === '`') { index = skipTemplate(source, index); continue; }
    if (character === '/' && ['/', '*'].includes(source[index + 1])) { index = skipComment(source, index); continue; }
    if (character === '/' && startsRegex(source, index)) { index = skipRegex(source, index); continue; }
    if ((character === 'i' || character === 'e') && (index === 0 || /[;\s}]/.test(source[index - 1]))) {
      const declaration = source.slice(index).match(staticReference);
      if (declaration) {
        const end = index + declaration[0].length - 1;
        result += source.slice(copied, end) + `?v=${buildID}`;
        copied = end;
        index = end + 1;
        continue;
      }
    }
    index++;
  }
  return result + source.slice(copied);
}

export function versionEntrypoints(html, buildID) {
  return html.replace(/(<(?:script|link)\b[^>]*\b(?:src|href)=["'])(\.\/src\/(?:app\.js|styles\.css))(["'])/g, `$1$2?v=${buildID}$3`);
}
