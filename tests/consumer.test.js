import test from 'node:test';
import assert from 'node:assert/strict';
import { compareShapes, inferShape, LIMITS } from '../src/core.js';
import { CONSUMER_LIMITS, normalizeLens, parseLens, serializeLens, checkLens, relatedChanges, lensMarkdown } from '../src/consumer.js';

const rule = (tokens, types = ['number'], required = true) => ({ tokens, types, required });
const lens = (rules = [rule(['total'])], name = 'Checkout') => ({ kind: 'payload-radar-consumer', schemaVersion: 1, name, rules });

test('normalization copies a canonical value-free lens and deduplicates/sorts types', () => {
  const input = lens([rule(['total'], ['string', 'number', 'string'])], '  Checkout  ');
  const normalized = normalizeLens(input);
  assert.deepEqual(normalized, lens([rule(['total'], ['number', 'string'])]));
  input.rules[0].tokens[0] = 'changed';
  input.rules[0].types.push('null');
  assert.deepEqual(normalized.rules[0], rule(['total'], ['number', 'string']));
  assert.deepEqual(parseLens(serializeLens(normalized)), normalized);
  assert.ok(serializeLens(normalized).endsWith('\n'));
  assert.deepEqual(CONSUMER_LIMITS, { bytes: 262144, rules: 100, nameChars: 80, examples: 5 });
});

test('unrelated additions and type drift do not affect consumer checks', () => {
  const before = [{ total: 42, internal: { code: 3 } }];
  const after = [{ total: 43, internal: { code: 'new' }, telemetry: true }];
  const changes = compareShapes(inferShape(before), inferShape(after));
  const report = checkLens(lens(), after);
  assert.equal(report.status, 'pass');
  assert.equal(report.violations, 0);
  assert.equal(report.results[0].present, 1);
  assert.deepEqual(relatedChanges(changes, lens()), []);
});

test('missing and changed ancestors fail required descendant rules at real concrete pointers', () => {
  const guard = lens([rule(['customer', 'email'], ['string'])]);
  const report = checkLens(guard, [{ customer: { email: 'ok@example.test' } }, {}, { customer: null }, { customer: [] }, { customer: {} }]);
  assert.equal(report.status, 'fail');
  const result = report.results[0];
  assert.equal(result.checked, 5);
  assert.equal(result.present, 1);
  assert.equal(result.missing, 4);
  assert.equal(result.mismatched, 0);
  assert.equal(result.violations, 4);
  assert.deepEqual(result.examples.map(example => [example.sample, example.pointer, example.reason, example.actual]), [
    [2, '/customer', 'missing', 'missing'], [3, '/customer', 'missing', 'missing'],
    [4, '/customer', 'missing', 'missing'], [5, '/customer/email', 'missing', 'missing'],
  ]);
  const changes = compareShapes(inferShape([{ customer: { email: 'old@example.test' } }]), inferShape([{ customer: null }]));
  assert.equal(relatedChanges(changes, guard).length, 1);
  assert.deepEqual(relatedChanges(changes, guard)[0].tokens, ['customer']);
});

test('array rules check every item and preserve real sample numbers, indices, and escaped pointers', () => {
  const guard = lens([rule(['orders', null, 'a/b~c'], ['number'])]);
  const samples = [
    { orders: [{ 'a/b~c': 1 }, { 'a/b~c': 'wrong' }, {}] },
    { orders: [{ 'a/b~c': 4 }, null, { 'a/b~c': true }] },
  ];
  const result = checkLens(guard, samples).results[0];
  assert.equal(result.checked, 6);
  assert.equal(result.present, 4);
  assert.equal(result.missing, 2);
  assert.equal(result.mismatched, 2);
  assert.equal(result.violations, 4);
  assert.equal(result.pointer, '/orders/[]/a~1b~0c');
  assert.deepEqual(result.examples, [
    { sample: 1, pointer: '/orders/1/a~1b~0c', reason: 'type', actual: 'string', expected: ['number'] },
    { sample: 1, pointer: '/orders/2/a~1b~0c', reason: 'missing', actual: 'missing', expected: ['number'] },
    { sample: 2, pointer: '/orders/1', reason: 'missing', actual: 'missing', expected: ['number'] },
    { sample: 2, pointer: '/orders/2/a~1b~0c', reason: 'type', actual: 'boolean', expected: ['number'] },
  ]);
});

test('nested array expansion distinguishes empty arrays and invalid array ancestors', () => {
  const guard = lens([rule(['groups', null, null, 'id'])]);
  const result = checkLens(guard, [{ groups: [[], [{ id: 1 }, { id: 'bad' }], false] }]).results[0];
  assert.equal(result.emptyArrays, 1);
  assert.equal(result.checked, 3);
  assert.equal(result.present, 2);
  assert.equal(result.violations, 2);
  assert.deepEqual(result.examples.map(example => example.pointer), ['/groups/1/1/id', '/groups/2']);
});

test('optional missing fields pass when some values are observed; explicit null is still a type mismatch', () => {
  const guard = lens([rule(['email'], ['string'], false)]);
  const passing = checkLens(guard, [{ email: 'ok' }, {}]);
  assert.equal(passing.status, 'pass');
  assert.equal(passing.results[0].missing, 1);
  assert.equal(passing.results[0].checked, 2);
  assert.equal(passing.results[0].violations, 0);
  const failing = checkLens(guard, [{}, { email: null }]);
  assert.equal(failing.status, 'fail');
  assert.equal(failing.results[0].mismatched, 1);
  assert.deepEqual(failing.results[0].examples[0], { sample: 2, pointer: '/email', reason: 'type', actual: 'null', expected: ['string'] });
  assert.equal(checkLens(lens([rule(['email'], ['string', 'null'], false)]), [{ email: null }]).status, 'pass');
});

test('empty arrays and never-observed optional fields require review, not false passes or invented failures', () => {
  const report = checkLens(lens([rule(['items', null, 'id']), rule(['nickname'], ['string'], false)]), [{ items: [] }, { items: [] }]);
  assert.equal(report.status, 'review');
  assert.equal(report.unobservedRules, 2);
  assert.equal(report.violations, 0);
  assert.deepEqual(report.results.map(result => [result.status, result.checked, result.emptyArrays, result.missing]), [
    ['review', 0, 2, 0], ['review', 2, 0, 2],
  ]);
  assert.ok(report.results.every(result => result.examples.length === 0));
  assert.equal(checkLens(lens(), []).status, 'review');
  assert.equal(checkLens(lens([rule(['items', null, 'id'])]), [{ items: [] }, { items: [{ id: 2 }] }]).status, 'pass');
  assert.equal(checkLens(lens([rule(['items', null, 'id'])]), [{ items: null }]).status, 'fail');
});

test('literal [] keys, empty keys, numeric strings, and prototype keys remain distinct typed paths', () => {
  const guard = lens([rule(['[]']), rule(['items', null, 'id']), rule(['']), rule(['__proto__', 'value'])]);
  const sample = JSON.parse('{"[]":2,"items":[{"id":3}],"":4,"__proto__":{"value":5}}');
  const report = checkLens(guard, [sample]);
  assert.equal(report.status, 'pass');
  assert.equal(report.results[0].id, '["[]"]');
  assert.equal(report.results[0].path, '$["[]"]');
  assert.equal(report.results[2].pointer, '/');
  assert.equal({}.value, undefined);
  const separate = lens([rule(['items', '[]']), rule(['items', null])]);
  const changes = [{ tokens: ['items', '[]'], kind: 'literal' }, { tokens: ['items', null], kind: 'wildcard' }];
  assert.deepEqual(relatedChanges(changes, lens([separate.rules[0]])).map(change => change.kind), ['literal']);
});

test('selecting an object protects its type/presence, not all descendant fields', () => {
  const changes = [{ tokens: ['customer'], kind: 'parent' }, { tokens: ['customer', 'internal'], kind: 'child' }, { tokens: [], kind: 'root' }];
  assert.deepEqual(relatedChanges(changes, lens([rule(['customer'], ['object'])])).map(change => change.kind), ['parent', 'root']);
  assert.equal(checkLens(lens([rule(['customer'], ['object'])]), [{ customer: { anything: 'new' } }]).status, 'pass');
  assert.equal(checkLens(lens([rule([], ['array'])]), [[]]).status, 'pass');
  assert.equal(checkLens(lens([rule([], ['array'])]), [{}]).results[0].examples[0].pointer, '');
});

test('failure examples are capped but counts still include every match', () => {
  const result = checkLens(lens([rule(['items', null])]), [{ items: Array(20).fill('secret-payload') }]).results[0];
  assert.equal(result.violations, 20);
  assert.equal(result.examples.length, 5);
  assert.deepEqual(result.examples.map(example => example.pointer), ['/items/0', '/items/1', '/items/2', '/items/3', '/items/4']);
});

test('lens schema rejects missing fields, unknown fields, versions, duplicate paths, and invalid types', () => {
  const invalid = [
    null, [], {}, { ...lens(), schemaVersion: 2 }, { ...lens(), kind: 'other' }, { ...lens(), name: '  ' },
    { ...lens(), name: 'x'.repeat(81) }, { ...lens(), extra: true }, { ...lens(), rules: [] },
    lens([rule(['total']), rule(['total'])]), lens([rule(['total'], [])]), lens([rule(['total'], ['integer'])]),
    lens([rule(['total'], ['number'], 'true')]), lens([{ ...rule(['total']), extra: true }]),
    lens([rule([1])]), lens([rule([undefined])]), lens([rule(['total'], [null])]), lens([rule(['total'], Array(7).fill('number'))]),
  ];
  for (const value of invalid) assert.throws(() => normalizeLens(value));
  assert.throws(() => parseLens('{"kind":"payload-radar-consumer","schemaVersion":1,"name":"a","rules":[{"tokens":[],"types":["object"],"required":true}],"__proto__":{}}'), /unknown/);
  assert.throws(() => parseLens('{'), /Invalid consumer lens JSON/);
  assert.throws(() => parseLens(null), /must be text/);
});

test('normalization never invokes getters and rejects custom prototypes, symbols, nonenumerable fields, and array extras', () => {
  let reads = 0;
  const accessor = lens();
  Object.defineProperty(accessor, 'name', { enumerable: true, get() { reads++; throw new Error('getter ran'); } });
  assert.throws(() => normalizeLens(accessor), /accessors/);
  assert.equal(reads, 0);
  const inherited = Object.assign(Object.create({ inherited: true }), lens());
  assert.throws(() => normalizeLens(inherited), /plain JSON object/);
  const symbol = lens(); symbol[Symbol('unsafe')] = true;
  assert.throws(() => normalizeLens(symbol), /unknown/);
  const hidden = lens(); Object.defineProperty(hidden, 'name', { value: 'hidden', enumerable: false });
  assert.throws(() => normalizeLens(hidden), /enumerable/);
  const sparse = lens(); sparse.rules = Array(1);
  assert.throws(() => normalizeLens(sparse), /sparse/);
  const extra = lens(); extra.rules[0].tokens.metadata = 'extra';
  assert.throws(() => normalizeLens(extra), /extra properties/);
  const tokenAccessor = lens(); Object.defineProperty(tokenAccessor.rules[0].tokens, '0', { enumerable: true, get() { reads++; return 'total'; } });
  assert.throws(() => normalizeLens(tokenAccessor), /accessor/);
  assert.equal(reads, 0);
});

test('lens and payload limits apply to programmatic callers and UTF-8 imports', () => {
  assert.throws(() => normalizeLens(lens(Array.from({ length: 101 }, (_, index) => rule([String(index)])))), /100 rules/);
  assert.throws(() => normalizeLens(lens([rule(Array(65).fill(null))])), /depth/);
  assert.throws(() => normalizeLens(lens([rule(['x'.repeat(1025)])])), /1024/);
  assert.throws(() => normalizeLens(lens([rule(Array(4).fill('x'.repeat(1024)))])), /4096/);
  assert.doesNotThrow(() => normalizeLens(lens([rule(Array(64).fill(null))])));
  assert.throws(() => parseLens(`${' '.repeat(CONSUMER_LIMITS.bytes)}{}`), /256 KiB/);
  assert.throws(() => parseLens(`"${'界'.repeat(CONSUMER_LIMITS.bytes / 2)}"`), /256 KiB/);
  const large = lens(Array.from({ length: 100 }, (_, index) => rule([String(index), 'x'.repeat(1024), 'y'.repeat(1024), 'z'.repeat(1024)])));
  assert.throws(() => serializeLens(large), /256 KiB/);
  assert.throws(() => checkLens(lens(), Array(LIMITS.samples + 1).fill({})), /1000/);
  assert.throws(() => checkLens(lens(), [NaN]), /Non-finite/);
  assert.throws(() => checkLens(lens(), [{ value: new Date() }]), /plain JSON/);
});

test('reports and serialized lenses omit values and resist Markdown field/name injection', () => {
  const unsafeName = 'Checkout | ![image](https://bad.test) <script>\n# heading';
  const unsafeKey = 'x|`<img src=x onerror=alert(1)>\\|[click](https://bad.test)';
  const guard = lens([rule([unsafeKey])], unsafeName);
  const report = checkLens(guard, [{ [unsafeKey]: 'VERY_PRIVATE_PAYLOAD_7a9' }]);
  const json = JSON.stringify(report);
  const md = lensMarkdown(report);
  assert.ok(!json.includes('VERY_PRIVATE_PAYLOAD_7a9'));
  assert.ok(!md.includes('VERY_PRIVATE_PAYLOAD_7a9'));
  assert.ok(!serializeLens(guard).includes('VERY_PRIVATE_PAYLOAD_7a9'));
  assert.ok(md.includes('&#124;'));
  assert.ok(!md.includes('\n# heading'));
  assert.ok(md.includes('Failure examples'));
  assert.ok(md.includes('No raw payload values are included.'));
  assert.ok(!Object.hasOwn(report, 'samples'));
  assert.ok(!Object.hasOwn(guard, 'baseline'));
});
