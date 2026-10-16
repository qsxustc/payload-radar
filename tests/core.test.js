import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, parseInput, inferShape, compareShapes, toJSONSchema, toMarkdown } from '../src/core.js';

const compare = (before, after) => compareShapes(inferShape(before), inferShape(after));
const finding = (changes, kind, tokens) => changes.find(change => change.kind === kind && JSON.stringify(change.tokens) === JSON.stringify(tokens));

test('JSON preserves an array as one document; JSONL treats each line as a sample', () => {
  assert.deepEqual(parseInput('[{"id":1},{"id":2}]'), [[{ id: 1 }, { id: 2 }]]);
  assert.deepEqual(parseInput(' \n{"id":1}\r\n\n{"id":2}\n', 'jsonl'), [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(parseInput('null'), [null]);
  assert.throws(() => parseInput(''), /empty/);
  assert.throws(() => parseInput(' \n', 'jsonl'), /empty/);
  assert.throws(() => parseInput('1\nno', 'jsonl'), /line 2/);
  assert.throws(() => parseInput('{'), /Invalid JSON/);
  assert.throws(() => parseInput('{}', 'yaml'), /Format/);
});

test('inputs are bounded by UTF-8 bytes, sample count, nesting and total visited values', () => {
  assert.throws(() => parseInput(JSON.stringify('😀'.repeat(LIMITS.bytes / 4))), /2 MiB/);
  assert.equal(parseInput(Array(1000).fill('{}').join('\n'), 'jsonl').length, 1000);
  assert.throws(() => parseInput(Array(1001).fill('{}').join('\n'), 'jsonl'), /1000/);
  assert.throws(() => inferShape(Array(1001).fill(null)), /1000/);
  let atLimit = null;
  for (let depth = 0; depth < 64; depth++) atLimit = { child: atLimit };
  assert.doesNotThrow(() => inferShape([atLimit]));
  assert.throws(() => inferShape([{ child: atLimit }]), /nesting depth/);
  assert.doesNotThrow(() => inferShape([Array(49999).fill(0)]));
  assert.throws(() => parseInput(JSON.stringify(Array(50000).fill(0))), /50000/);
});

test('pathological keys and wide diffs cannot amplify a small input into an unbounded report', () => {
  assert.throws(() => inferShape([{ ['x'.repeat(LIMITS.keyChars + 1)]: 1 }]), /field name.*1024/);
  let nested = true;
  for (let index = 0; index < 5; index++) nested = { ['x'.repeat(900)]: nested };
  assert.throws(() => inferShape([nested]), /path length.*4096/);
  const before = {}, after = {};
  for (let index = 0; index < 1100; index++) {
    const key = 'x'.repeat(1000) + index;
    before[key] = 1;
    after[key] = 'new type';
  }
  // Each valid input fits below 2 MiB; repeating their paths in every finding
  // would still multiply their size. The report budget stops that amplification.
  assert.ok(new TextEncoder().encode(JSON.stringify(before)).byteLength < LIMITS.bytes);
  assert.throws(() => compare(parseInput(JSON.stringify(before)), parseInput(JSON.stringify(after))), /encoded path budget/);
});

test('reject non-JSON values, cycles and accessors while allowing repeated references', () => {
  assert.throws(() => parseInput('1e999'), /Non-finite/);
  for (const value of [Infinity, NaN, undefined, 1n, () => {}, Symbol('x'), new Date(), new Map(), Array(2)]) {
    assert.throws(() => inferShape([value]));
  }
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => inferShape([cycle]), /Cyclic/);
  const shared = { id: 1 };
  assert.equal(inferShape([{ a: shared, b: shared }]).properties.b.seen, 1);
  let invoked = false;
  const accessor = Object.defineProperty({}, 'x', { enumerable: true, get() { invoked = true; return 1; } });
  assert.throws(() => inferShape([accessor]), /Accessor/);
  assert.equal(invoked, false);
});

test('shape aggregates types and nested presence within actual parent objects', () => {
  const shape = inferShape([{ customer: { email: 'a', score: 1 } }, { customer: {} }, { customer: null }, {}, { customer: { score: 1.2 } }]);
  const customer = shape.properties.customer;
  assert.deepEqual(customer.types, ['null', 'object']);
  assert.equal(customer.seen, 4);
  assert.equal(customer.objectCount, 3);
  assert.equal(customer.properties.email.seen, 1);
  assert.deepEqual(customer.properties.score.types, ['number']);
  assert.equal(Object.getPrototypeOf(shape.properties), null);
  assert.deepEqual(inferShape([]).types, []);
});

test('arrays pool all values, skip empty arrays as evidence, and ignore changed raw values', () => {
  const shape = inferShape([{ rows: [{ id: 1 }, {}, { id: '2' }] }, { rows: [] }]);
  assert.equal(shape.properties.rows.arrayCount, 2);
  assert.equal(shape.properties.rows.items.seen, 3);
  assert.equal(shape.properties.rows.items.objectCount, 3);
  assert.equal(shape.properties.rows.items.properties.id.seen, 2);
  assert.deepEqual(shape.properties.rows.items.properties.id.types, ['number', 'string']);
  assert.equal(inferShape([[]]).items, null);
  assert.deepEqual(compare([{ id: 1, active: true }], [{ id: 99, active: false }]), []);
  assert.deepEqual(compare([[{ id: 1 }, { name: 'Ada' }]], [[{ name: 'Jo' }, { id: 99 }]]), []);
});

test('new non-null types are risk, null is review, and lost observed types are informational', () => {
  assert.equal(finding(compare([{ n: 1 }], [{ n: '1' }]), 'type-changed', ['n']).severity, 'risk');
  assert.equal(finding(compare([{ n: 1 }], [{ n: 1 }, { n: null }]), 'nullable', ['n']).severity, 'review');
  assert.equal(finding(compare([{ n: 1 }, { n: '1' }], [{ n: 2 }]), 'type-changed', ['n']).severity, 'info');
  assert.equal(finding(compare([{ n: null }], [{ n: 2 }]), 'type-changed', ['n']).severity, 'risk');
});

test('presence uses exact parent-object fractions across differently sized sample sets', () => {
  const changes = compare([{ c: { email: 'a' } }, { c: { email: 'b' } }, { c: null }], [{ c: { email: 'x' } }, { c: {} }, {}]);
  const email = finding(changes, 'presence-dropped', ['c', 'email']);
  assert.deepEqual(email.beforePresence, { seen: 2, total: 2 });
  assert.deepEqual(email.afterPresence, { seen: 1, total: 2 });
  assert.equal(email.severity, 'review');
  assert.deepEqual(compare([{ v: 1 }, {}], [{ v: 2 }, {}, { v: 3 }, {}]), []);
  assert.equal(finding(compare([{ v: 1 }, {}], [{ v: 2 }]), 'presence-increased', ['v']).severity, 'info');
});

test('parent removals and vanished type branches do not produce descendant noise', () => {
  const removed = compare([{ customer: { name: 'a', nested: { id: 1 } } }], [{}]);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].kind, 'removed');
  assert.deepEqual(removed[0].tokens, ['customer']);
  assert.equal(removed[0].severity, 'risk');
  const changed = compare([{ customer: { name: 'a' } }], [{ customer: null }]);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].kind, 'nullable');
  assert.equal(compare([{ a: [1] }], [{ a: { b: true } }]).length, 1);
  assert.equal(compare([{}], [{ a: { b: true } }]).length, 1);
});

test('empty arrays yield insufficient evidence, never claim that array items were removed', () => {
  for (const [before, after] of [[[1], []], [[], [1]]]) {
    const changes = compare([before], [after]);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].kind, 'insufficient-evidence');
    assert.deepEqual(changes[0].tokens, [null]);
  }
  assert.deepEqual(compare([[]], [[]]), []);
  assert.equal(compare([], [{}])[0].kind, 'insufficient-evidence');
});

test('hostile object keys stay own properties; paths escape JSON pointers and IDs distinguish wildcards', () => {
  const before = parseInput('{"__proto__":{"polluted":1},"constructor":1,"a/b~c":1,"[]":1,"rows":[1],"你好":1}');
  const after = parseInput('{"__proto__":{"polluted":"x"},"constructor":"x","a/b~c":"x","[]":"x","rows":["x"],"你好":"x"}');
  const changes = compare(before, after);
  assert.equal({}.polluted, undefined);
  assert.ok(finding(changes, 'type-changed', ['__proto__', 'polluted']));
  assert.equal(finding(changes, 'type-changed', ['a/b~c']).pointer, '/a~1b~0c');
  assert.equal(finding(changes, 'type-changed', ['你好']).path, '$["你好"]');
  const collision = compare([{ '[]': 1 }, [1]], [{ '[]': 'x' }, ['x']]);
  const literal = finding(collision, 'type-changed', ['[]']);
  const wildcard = finding(collision, 'type-changed', [null]);
  assert.equal(literal.pointer, wildcard.pointer);
  assert.notEqual(literal.id, wildcard.id);
});

test('inferred JSON Schema preserves mixed-type branches and only requires always-seen object keys', () => {
  const shape = inferShape([{ mixed: { id: 1, optional: true }, empty: [] }, { mixed: 'legacy', empty: [] }, { mixed: { id: 2 }, empty: [] }]);
  const schema = toJSONSchema(shape);
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.deepEqual(schema.required, ['empty', 'mixed']);
  assert.deepEqual(schema.properties.mixed.type, ['object', 'string']);
  assert.deepEqual(schema.properties.mixed.required, ['id']);
  assert.equal(schema.properties.mixed.properties.optional.type, 'boolean');
  assert.deepEqual(schema.properties.empty.items, {});
  const union = toJSONSchema(inferShape([[1], 'x']));
  assert.deepEqual(union.type, ['array', 'string']);
  assert.equal(union.items.type, 'number');
  const hostile = toJSONSchema(inferShape(parseInput('{"__proto__":1,"constructor":2}')));
  assert.equal(hostile.properties.__proto__.type, 'number');
  assert.equal(JSON.parse(JSON.stringify(hostile)).properties.__proto__.type, 'number');
});

test('shape and exports contain structural facts, never original scalar values', () => {
  const before = [{ user: { email: 'SECRET_BEFORE_1', id: 987654321 } }];
  const after = [{ user: { email: null, id: 'SECRET_AFTER_2' } }];
  const shape = inferShape(after);
  const report = { changes: compare(before, after), beforeName: 'before.json', afterName: 'after.json', beforeSamples: 1, afterSamples: 1 };
  const all = JSON.stringify({ shape, schema: toJSONSchema(shape), report }) + toMarkdown(report);
  for (const secret of ['SECRET_BEFORE_1', 'SECRET_AFTER_2', '987654321']) assert.equal(all.includes(secret), false);
  assert.match(toMarkdown(report), /observed samples/);
  assert.match(toMarkdown(report), /IEEE 754/);
});

test('Markdown safely contains adversarial field names and filenames as inline code', () => {
  const key = '![remote](https://tracker.test) \\| <img src=x>\n```break`';
  const changes = compare([{ [key]: 1 }], [{ [key]: 'x' }]);
  const report = toMarkdown({ changes, beforeName: key, afterName: '\r\n# injected', beforeSamples: 1, afterSamples: 1 });
  assert.ok(report.includes('` ![remote](https://tracker.test) \\ `&#124;````  <img src=x> ```break` ````'));
  assert.equal(report.split('\n').find(line => line.includes('type-changed')).split('|').length, 9);
  assert.equal(report.split('\n').filter(line => line.startsWith('|')).length, 3);
  assert.ok(report.includes('Current: `   # injected `'));
  assert.equal(report.includes('\n# injected'), false);
});
