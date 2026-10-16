import { inferShape, LIMITS } from './core.js';

/** Consumer lenses contain explicit type/presence assumptions, never payload values. */
export const CONSUMER_LIMITS = Object.freeze({ bytes: 262144, rules: 100, nameChars: 80, examples: 5 });
const TYPES = new Set(['null', 'array', 'object', 'string', 'boolean', 'number']);
const encoder = new TextEncoder();

function record(value, fields, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be a plain JSON object.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) {
    throw new TypeError(`${label} contains missing or unknown fields; expected ${fields.join(', ')}.`);
  }
  const output = Object.create(null);
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new TypeError(`${label} must contain enumerable data fields, not accessors.`);
    output[key] = descriptor.value;
  }
  return output;
}

function list(value, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`${label} must be a JSON array.`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some(key => typeof key !== 'string' || (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key)))) {
    throw new TypeError(`${label} cannot have sparse items, symbols, or extra properties.`);
  }
  const output = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new TypeError(`${label} cannot have sparse or accessor items.`);
    output.push(descriptor.value);
  }
  return output;
}

function lensText(lens) {
  const text = `${JSON.stringify(lens, null, 2)}\n`;
  if (encoder.encode(text).byteLength > CONSUMER_LIMITS.bytes) throw new RangeError('Consumer lens exceeds the 256 KiB limit.');
  return text;
}

/** Validate and copy a lens into its stable, JSON-safe wire representation. */
export function normalizeLens(value) {
  const input = record(value, ['kind', 'schemaVersion', 'name', 'rules'], 'Consumer lens');
  if (input.kind !== 'payload-radar-consumer') throw new TypeError('Consumer lens kind must be payload-radar-consumer.');
  if (input.schemaVersion !== 1) throw new TypeError('Unsupported consumer lens schemaVersion; expected 1.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > CONSUMER_LIMITS.nameChars) {
    throw new TypeError('Consumer lens name must contain 1 to 80 characters after trimming.');
  }
  // Check lengths before copying so programmatic callers cannot create huge lists.
  if (!Array.isArray(input.rules) || input.rules.length < 1 || input.rules.length > CONSUMER_LIMITS.rules) {
    throw new RangeError('Consumer lens must contain between 1 and 100 rules.');
  }
  const ids = new Set();
  const rules = list(input.rules, 'Consumer rules').map((value, index) => {
    const rule = record(value, ['tokens', 'types', 'required'], `Consumer rule ${index + 1}`);
    if (!Array.isArray(rule.tokens) || rule.tokens.length > LIMITS.depth) throw new RangeError('Consumer paths exceed the maximum depth of 64.');
    const tokens = list(rule.tokens, 'Consumer path');
    let pathChars = 0;
    for (const token of tokens) {
      if (token !== null && typeof token !== 'string') throw new TypeError('Consumer path tokens must be strings or null (array items).');
      if (typeof token === 'string' && token.length > LIMITS.keyChars) throw new RangeError('Consumer field names exceed the 1024 character limit.');
      pathChars += token === null ? 2 : token.length + 1;
      if (pathChars > LIMITS.pathChars) throw new RangeError('Consumer paths exceed the 4096 character cumulative path limit.');
    }
    const id = JSON.stringify(tokens);
    if (ids.has(id)) throw new TypeError('Consumer lens contains duplicate paths.');
    ids.add(id);
    if (!Array.isArray(rule.types) || !rule.types.length || rule.types.length > TYPES.size) throw new TypeError('Consumer rules require between one and six JSON type entries.');
    const types = list(rule.types, 'Consumer types');
    if (types.some(type => typeof type !== 'string' || !TYPES.has(type))) throw new TypeError('Consumer types must be null, array, object, string, boolean, or number.');
    if (typeof rule.required !== 'boolean') throw new TypeError('Consumer rule required must be a boolean.');
    return { tokens, types: [...new Set(types)].sort(), required: rule.required };
  });
  const lens = { kind: 'payload-radar-consumer', schemaVersion: 1, name: input.name.trim(), rules };
  lensText(lens);
  return lens;
}

export function parseLens(text) {
  if (typeof text !== 'string') throw new TypeError('Consumer lens input must be text.');
  if (encoder.encode(text).byteLength > CONSUMER_LIMITS.bytes) throw new RangeError('Consumer lens exceeds the 256 KiB limit.');
  let value;
  try { value = JSON.parse(text); }
  catch (error) { throw new SyntaxError(`Invalid consumer lens JSON: ${error.message}`); }
  return normalizeLens(value);
}

export function serializeLens(lens) { return lensText(normalizeLens(lens)); }

function pathLabel(tokens) {
  return '$' + tokens.map(token => token === null ? '[]' : /^[A-Za-z_$][\w$]*$/.test(token) ? `.${token}` : `[${JSON.stringify(token)}]`).join('');
}
function escapePointer(token) { return token.replace(/~/g, '~0').replace(/\//g, '~1'); }
function pointerLabel(tokens) { return tokens.map(token => '/' + (token === null ? '[]' : escapePointer(token))).join(''); }
function typeOf(value) { return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value; }

/** Check explicit assumptions against every matching observed field and array item. */
export function checkLens(value, samples) {
  const lens = normalizeLens(value);
  inferShape(samples);
  let exampleBytes = 0;
  const results = lens.rules.map(rule => {
    const result = {
      id: JSON.stringify(rule.tokens), path: pathLabel(rule.tokens), pointer: pointerLabel(rule.tokens),
      tokens: [...rule.tokens], types: [...rule.types], required: rule.required,
      status: 'pass', checked: 0, present: 0, missing: 0, mismatched: 0, violations: 0, emptyArrays: 0, examples: [],
    };
    function example(sample, pointer, reason, actual) {
      if (result.examples.length >= CONSUMER_LIMITS.examples) return;
      const bytes = encoder.encode(pointer).byteLength;
      // Bound diagnostic paths as well as source paths; counts remain complete.
      if (exampleBytes + bytes > LIMITS.changePathBytes) return;
      exampleBytes += bytes;
      result.examples.push({ sample, pointer, reason, actual, expected: [...rule.types] });
    }
    function missing(sample, pointer) {
      result.checked++;
      result.missing++;
      if (rule.required) { result.violations++; example(sample, pointer, 'missing', 'missing'); }
    }
    function visit(current, depth, pointer, sample) {
      if (depth === rule.tokens.length) {
        result.checked++;
        result.present++;
        const actual = typeOf(current);
        if (!rule.types.includes(actual)) {
          result.mismatched++;
          result.violations++;
          example(sample, pointer, 'type', actual);
        }
        return;
      }
      const token = rule.tokens[depth];
      if (token === null) {
        if (!Array.isArray(current)) { missing(sample, pointer); return; }
        if (!current.length) result.emptyArrays++;
        for (let index = 0; index < current.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          visit(descriptor.value, depth + 1, `${pointer}/${index}`, sample);
        }
      } else {
        if (current === null || typeof current !== 'object' || Array.isArray(current)) { missing(sample, pointer); return; }
        const next = `${pointer}/${escapePointer(token)}`;
        const descriptor = Object.getOwnPropertyDescriptor(current, token);
        if (!descriptor || !descriptor.enumerable) { missing(sample, next); return; }
        if (!('value' in descriptor)) throw new TypeError('Accessor values are not supported.');
        visit(descriptor.value, depth + 1, next, sample);
      }
    }
    samples.forEach((sample, index) => visit(sample, 0, '', index + 1));
    result.status = result.violations ? 'fail' : result.present ? 'pass' : 'review';
    return result;
  });
  return {
    name: lens.name, sampleCount: samples.length, ruleCount: results.length,
    status: results.some(result => result.status === 'fail') ? 'fail' : results.some(result => result.status === 'review') ? 'review' : 'pass',
    violations: results.reduce((sum, result) => sum + result.violations, 0),
    unobservedRules: results.filter(result => result.present === 0).length, results,
  };
}

/** Ancestor changes affect a selected field; selecting an object does not select its children. */
export function relatedChanges(changes, value) {
  const lens = normalizeLens(value);
  if (!Array.isArray(changes)) throw new TypeError('Changes must be an array.');
  return changes.filter(change => Array.isArray(change.tokens) && lens.rules.some(rule =>
    change.tokens.length <= rule.tokens.length && change.tokens.every((token, index) => token === rule.tokens[index])));
}

function markdownCode(value) {
  const text = String(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ');
  return text.split('|').map(part => {
    let longest = 0;
    for (const run of part.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
    const delimiter = '`'.repeat(longest + 1);
    return `${delimiter} ${part} ${delimiter}`;
  }).join('&#124;');
}

/** Export only the check result: no baseline shape, sample data, or payload values. */
export function lensMarkdown(report) {
  const lines = [
    '# Payload Radar consumer check', '',
    `Consumer: ${markdownCode(report.name)}`, '',
    `Status: ${markdownCode(report.status)} · Samples: ${markdownCode(report.sampleCount)} · Rules: ${markdownCode(report.ruleCount)} · Violations: ${markdownCode(report.violations)} · Unobserved rules: ${markdownCode(report.unobservedRules)}`, '',
    'Checks cover explicit type and presence assumptions in these samples. A pass does not prove future payload compatibility. Empty arrays provide no item evidence; rules with no observed values require review.', '',
    '| Status | Field | Allowed types | Required | Checked | Present | Missing | Type mismatches | Violations | Empty arrays |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const result of report.results) {
    lines.push(`| ${markdownCode(result.status)} | ${markdownCode(result.path)} | ${markdownCode(result.types.join(', '))} | ${markdownCode(result.required ? 'yes' : 'no')} | ${markdownCode(result.checked)} | ${markdownCode(result.present)} | ${markdownCode(result.missing)} | ${markdownCode(result.mismatched)} | ${markdownCode(result.violations)} | ${markdownCode(result.emptyArrays)} |`);
  }
  const failures = report.results.flatMap(result => result.examples.map(example => ({ result, example })));
  if (failures.length) {
    lines.push('', '## Failure examples', '', '| Field | Sample | JSON Pointer | Reason | Actual | Expected types |', '| --- | --- | --- | --- | --- | --- |');
    for (const { result, example } of failures) {
      lines.push(`| ${markdownCode(result.path)} | ${markdownCode(example.sample)} | ${markdownCode(example.pointer)} | ${markdownCode(example.reason)} | ${markdownCode(example.actual)} | ${markdownCode(example.expected.join(', '))} |`);
    }
  }
  lines.push('', 'Failure examples are capped at five per rule and a 2 MiB combined diagnostic pointer budget. Counts include all checked matches. Missing pointers stop at the real missing key or blocking ancestor; [] in rule labels denotes array items. No raw payload values are included.', '');
  return lines.join('\n');
}
