/** Payload Radar's dependency-free, value-free structural analysis engine. */
export const LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, samples: 1000, depth: 64, nodes: 50000, keyChars: 1024, pathChars: 4096, changePathBytes: 2 * 1024 * 1024 });

function blankNode() {
  return { types: [], seen: 0, objectCount: 0, arrayCount: 0, properties: Object.create(null), items: null };
}

/** Parse one JSON document, or one JSON document per nonempty JSONL line. */
export function parseInput(text, format = 'json') {
  if (typeof text !== 'string') throw new TypeError('Input must be text.');
  if (new TextEncoder().encode(text).byteLength > LIMITS.bytes) throw new RangeError('Input exceeds the 2 MiB limit.');
  if (!['json', 'jsonl'].includes(format)) throw new TypeError('Format must be json or jsonl.');
  if (!text.trim()) throw new SyntaxError('Input is empty. Add a JSON document.');
  let samples;
  if (format === 'json') {
    try { samples = [JSON.parse(text)]; }
    catch (error) { throw new SyntaxError(`Invalid JSON: ${error.message}`); }
  } else {
    samples = [];
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      if (samples.length >= LIMITS.samples) throw new RangeError('Input exceeds the 1000 sample limit.');
      try { samples.push(JSON.parse(line)); }
      catch (error) { throw new SyntaxError(`Invalid JSONL on line ${index + 1}: ${error.message}`); }
    }
  }
  // The same validation protects browser, CLI and programmatic callers.
  inferShape(samples);
  return samples;
}

/** Merge observations. Values are never retained in the resulting shape. */
export function inferShape(samples) {
  if (!Array.isArray(samples)) throw new TypeError('Samples must be an array.');
  if (samples.length > LIMITS.samples) throw new RangeError('Input exceeds the 1000 sample limit.');
  const root = blankNode();
  const ancestors = new WeakSet();
  let visited = 0;
  function visit(value, node, depth, pathChars) {
    if (++visited > LIMITS.nodes) throw new RangeError('Input exceeds the 50000 value limit.');
    if (depth > LIMITS.depth) throw new RangeError('Input exceeds the maximum nesting depth of 64.');
    if (pathChars > LIMITS.pathChars) throw new RangeError('Input exceeds the maximum cumulative path length of 4096 characters.');
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (!['null', 'array', 'object', 'string', 'boolean', 'number'].includes(type)) throw new TypeError('Only JSON-compatible values are supported.');
    if (type === 'number' && !Number.isFinite(value)) throw new TypeError('Non-finite numbers are not supported.');
    node.seen++;
    if (!node.types.includes(type)) node.types.push(type);
    if (type !== 'array' && type !== 'object') return;
    if (ancestors.has(value)) throw new TypeError('Cyclic values are not supported.');
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError('Symbol keys are not JSON-compatible.');
    if (type === 'object' && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('Only plain JSON objects are supported.');
    ancestors.add(value);
    if (type === 'array') {
      node.arrayCount++;
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor)) throw new TypeError('Sparse arrays and accessor values are not supported.');
        if (!node.items) node.items = blankNode();
        visit(descriptor.value, node.items, depth + 1, pathChars + 2);
      }
    } else {
      node.objectCount++;
      for (const key of Object.keys(value)) {
        if (key.length > LIMITS.keyChars) throw new RangeError('A field name exceeds the 1024 character limit.');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!('value' in descriptor)) throw new TypeError('Accessor values are not supported.');
        if (!Object.hasOwn(node.properties, key)) node.properties[key] = blankNode();
        visit(descriptor.value, node.properties[key], depth + 1, pathChars + key.length + 1);
      }
    }
    ancestors.delete(value);
  }
  for (const sample of samples) visit(sample, root, 0, 0);
  function sort(node) {
    node.types.sort();
    for (const child of Object.values(node.properties)) sort(child);
    if (node.items) sort(node.items);
  }
  sort(root);
  return root;
}

function pathLabel(tokens) {
  return '$' + tokens.map(token => token === null ? '[]' : /^[A-Za-z_$][\w$]*$/.test(token) ? `.${token}` : `[${JSON.stringify(token)}]`).join('');
}

function pointerLabel(tokens) {
  return tokens.map(token => '/' + (token === null ? '[]' : token.replace(/~/g, '~0').replace(/\//g, '~1'))).join('');
}

/** Compare observed shapes; a risk is evidence for review, not proof of a broken contract. */
export function compareShapes(before, after) {
  const changes = [];
  let pathBytes = 0;
  const encoder = new TextEncoder();
  function emit(kind, severity, tokens, message, left, right, leftTotal, rightTotal) {
    const location = { id: `${kind}:${JSON.stringify(tokens)}`, path: pathLabel(tokens), pointer: pointerLabel(tokens), tokens: [...tokens] };
    pathBytes += encoder.encode(JSON.stringify(location)).byteLength;
    if (pathBytes > LIMITS.changePathBytes) throw new RangeError('Findings exceed the 2 MiB encoded path budget. Compare smaller sample groups or shorten field names.');
    changes.push({
      ...location,
      severity, kind, message, beforeTypes: left ? [...left.types] : [], afterTypes: right ? [...right.types] : [],
      beforePresence: { seen: left?.seen ?? 0, total: leftTotal }, afterPresence: { seen: right?.seen ?? 0, total: rightTotal },
    });
  }
  function walk(left, right, tokens, leftTotal, rightTotal) {
    if (!left) {
      emit('added', 'info', tokens, 'Field newly observed in the current samples. Confirm consumers accept it.', left, right, leftTotal, rightTotal);
      return;
    }
    if (!right) {
      emit('removed', 'risk', tokens, 'Field was not observed in current samples. Check consumers that depend on it; samples do not prove removal.', left, right, leftTotal, rightTotal);
      return;
    }
    if (!left.seen || !right.seen) {
      if (left.seen !== right.seen) emit('insufficient-evidence', 'review', tokens, 'One side has no observations. Structure cannot be compared.', left, right, leftTotal, rightTotal);
      return;
    }
    const added = right.types.filter(type => !left.types.includes(type));
    const removed = left.types.filter(type => !right.types.includes(type));
    if (added.some(type => type !== 'null')) {
      emit('type-changed', 'risk', tokens, `New value type observed: ${added.join(', ')}. Check consumer type assumptions.`, left, right, leftTotal, rightTotal);
    } else if (added.includes('null')) {
      emit('nullable', 'review', tokens, 'Null was newly observed. Check consumers that assume a non-null value.', left, right, leftTotal, rightTotal);
    } else if (removed.length) {
      emit('type-changed', 'info', tokens, `Previously observed type no longer seen: ${removed.join(', ')}. A sample absence does not prove the type is impossible.`, left, right, leftTotal, rightTotal);
    }
    // Compare exact fractions so differently sized sample sets remain meaningful.
    if (leftTotal && rightTotal) {
      const direction = right.seen * leftTotal - left.seen * rightTotal;
      if (direction < 0) emit('presence-dropped', 'review', tokens, 'The field appeared in a smaller share of observed parent objects. Check assumptions about field presence.', left, right, leftTotal, rightTotal);
      if (direction > 0) emit('presence-increased', 'info', tokens, 'The field appeared in a larger share of observed parent objects. This does not establish a required field.', left, right, leftTotal, rightTotal);
    }
    // A vanished object/array branch is explained by the parent type change.
    if (left.objectCount && right.objectCount) {
      const keys = [...new Set([...Object.keys(left.properties), ...Object.keys(right.properties)])].sort();
      for (const key of keys) walk(left.properties[key], right.properties[key], [...tokens, key], left.objectCount, right.objectCount);
    }
    if (left.arrayCount && right.arrayCount) {
      if (Boolean(left.items) !== Boolean(right.items)) {
        emit('insufficient-evidence', 'review', [...tokens, null], 'One side contains only empty arrays. No item structure was observed there, so item changes cannot be determined.', left.items, right.items, left.items?.seen ?? 0, right.items?.seen ?? 0);
      } else if (left.items && right.items) {
        walk(left.items, right.items, [...tokens, null], left.items.seen, right.items.seen);
      }
    }
  }
  walk(before, after, [], before.seen, after.seen);
  return changes;
}

/** An observed schema, never a guarantee that future payloads have this shape. */
export function toJSONSchema(shape) {
  function convert(node) {
    if (!node.types.length) return {};
    const schema = { type: node.types.length === 1 ? node.types[0] : [...node.types] };
    if (node.objectCount) {
      schema.properties = {};
      const required = [];
      for (const key of Object.keys(node.properties).sort()) {
        Object.defineProperty(schema.properties, key, { value: convert(node.properties[key]), enumerable: true, configurable: true, writable: true });
        if (node.properties[key].seen === node.objectCount) required.push(key);
      }
      if (required.length) schema.required = required;
    }
    if (node.arrayCount) schema.items = node.items ? convert(node.items) : {};
    return schema;
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $comment: 'Inferred from observed samples only. Required means present in every observed parent object; unobserved values may still be valid. JavaScript numbers use IEEE 754 precision.',
    ...convert(shape),
  };
}

// Inline code prevents field names / filenames from becoming images, links or HTML.
// Put table pipes between code spans as entities. This remains safe even when an
// original key has arbitrary runs of backslashes before its pipe character.
function markdownCode(value) {
  const text = String(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ');
  return text.split('|').map(part => {
    let longest = 0;
    for (const run of part.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
    const delimiter = '`'.repeat(longest + 1);
    return `${delimiter} ${part} ${delimiter}`;
  }).join('&#124;');
}
function typeText(types) { return types.length ? types.join(', ') : '—'; }
function presenceText(presence) { return `${presence.seen}/${presence.total}`; }

/** Export only structural metadata; original payload values are never included. */
export function toMarkdown(report) {
  const lines = [
    '# Payload Radar report', '',
    `Baseline: ${markdownCode(report.beforeName ?? 'Baseline')} (${markdownCode(report.beforeSamples ?? 0)} samples)`,
    `Current: ${markdownCode(report.afterName ?? 'Current')} (${markdownCode(report.afterSamples ?? 0)} samples)`, '',
    'This report compares observed samples. Findings indicate review risk, not proven contract breaks. Presence is counted within observed parent objects; array items aggregate all observed elements.', '',
    '| Severity | Path | Change | Before types | After types | Before presence | After presence |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const change of report.changes) {
    lines.push(`| ${markdownCode(change.severity)} | ${markdownCode(change.path)} | ${markdownCode(change.kind)} | ${markdownCode(typeText(change.beforeTypes))} | ${markdownCode(typeText(change.afterTypes))} | ${markdownCode(presenceText(change.beforePresence))} | ${markdownCode(presenceText(change.afterPresence))} |`);
  }
  if (!report.changes.length) lines.push('| — | $ | No structural changes observed | — | — | — | — |');
  lines.push('', 'Limits: 2 MiB per text input, 1000 samples per side, nesting depth 64, 50000 visited values per side, field names up to 1024 characters, cumulative paths up to 4096 characters, and 2 MiB of encoded finding paths. Character limits count UTF-16 code units. Numbers follow JavaScript IEEE 754 precision; large integer values may lose precision. No raw payload values are included.', '');
  return lines.join('\n');
}
