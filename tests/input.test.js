import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, compareShapes, inferShape, parseInput } from '../src/core.js';
import { parsePayload } from '../src/input.js';

test('auto reads pretty JSON as one document and detects each side independently', () => {
  const before = parsePayload('{\n  "total": 42,\n  "customer": { "id": 1 }\n}');
  const after = parsePayload('{"total":"42","customer":{"id":1}}\n{"total":43,"customer":{"id":2}}');
  assert.equal(before.format, 'json');
  assert.equal(after.format, 'jsonl');
  assert.equal(before.samples.length, 1);
  assert.equal(after.samples.length, 2);
  const changes = compareShapes(inferShape(before.samples), inferShape(after.samples));
  assert.ok(changes.some(change => change.path === '$.total' && change.kind === 'type-changed'));
});

test('auto preserves a top-level array and one-line primitive as single JSON documents', () => {
  assert.deepEqual(parsePayload('[\n {"id":1},\n {"id":2}\n]'), {
    samples: [[{ id: 1 }, { id: 2 }]], format: 'json',
  });
  for (const value of [null, true, 123, 'hello', []]) {
    assert.deepEqual(parsePayload(JSON.stringify(value)), { samples: [value], format: 'json' });
  }
  assert.deepEqual(parsePayload(' {"id":1} \n'), { samples: [{ id: 1 }], format: 'json' });
});

test('JSON Lines detection accepts blank lines, CRLF and array-valued samples', () => {
  assert.deepEqual(parsePayload('\r\n {"id":1}\r\n\r\n {"id":2}\r\n'), {
    samples: [{ id: 1 }, { id: 2 }], format: 'jsonl',
  });
  assert.deepEqual(parsePayload('[1,2]\n[3,4]'), { samples: [[1, 2], [3, 4]], format: 'jsonl' });
});

test('explicit formats retain engine behavior without silently falling back', () => {
  assert.deepEqual(parsePayload('{"id":1}', 'jsonl'), { samples: [{ id: 1 }], format: 'jsonl' });
  assert.deepEqual(parsePayload('[1,2]', 'json'), { samples: [[1, 2]], format: 'json' });
  assert.throws(() => parsePayload('{}\n{}', 'json'), { name: 'SyntaxError', message: /^Invalid JSON:/ });
  assert.throws(() => parsePayload('{\n "id":1\n}', 'jsonl'), /Invalid JSONL on line 1/);
  assert.throws(() => parsePayload('{}', 'yaml'), { name: 'TypeError', message: /Format/ });
});

test('invalid auto input explains both formats and preserves malformed JSONL line numbers', () => {
  for (const text of ['{', 'not-json', '{}\n\n{"broken": }']) {
    assert.throws(() => parsePayload(text), error => {
      assert.ok(error instanceof SyntaxError);
      assert.match(error.message, /neither valid JSON nor JSON Lines/);
      assert.match(error.message, /Invalid JSON:/);
      assert.match(error.message, /Invalid JSONL on line /);
      return true;
    });
  }
  assert.throws(() => parsePayload('{}\r\n\r\n{"broken": }'), /line 3/);
  assert.throws(() => parsePayload(`{}\n${'bad'.repeat(10000)}`), error => {
    assert.ok(error.message.length <= 415);
    assert.match(error.message, /line 2/);
    return true;
  });
});

test('empty and non-text inputs preserve the clear engine errors', () => {
  for (const text of ['', ' \t\r\n']) {
    assert.throws(() => parsePayload(text), { name: 'SyntaxError', message: 'Input is empty. Add a JSON document.' });
  }
  for (const text of [undefined, null, 123, {}, []]) {
    assert.throws(() => parsePayload(text), { name: 'TypeError', message: 'Input must be text.' });
  }
});

test('auto retains UTF-8 byte limits before choosing a format', () => {
  const overLimit = JSON.stringify('😀'.repeat(LIMITS.bytes / 4));
  assert.ok(overLimit.length < LIMITS.bytes);
  for (const text of [overLimit, '{}\n' + overLimit]) {
    assert.throws(() => parsePayload(text), { name: 'RangeError', message: 'Input exceeds the 2 MiB limit.' });
  }
});

test('auto enforces sample count while JSON arrays remain one sample', () => {
  assert.equal(parsePayload(Array(LIMITS.samples).fill('{}').join('\n')).samples.length, LIMITS.samples);
  assert.throws(() => parsePayload(Array(LIMITS.samples + 1).fill('{}').join('\n')), {
    name: 'RangeError', message: 'Input exceeds the 1000 sample limit.',
  });
  assert.equal(parsePayload(JSON.stringify(Array(LIMITS.samples + 1).fill(null))).samples.length, 1);
});

test('valid JSON validation failures preserve original errors and never become format errors', () => {
  let deep = null;
  for (let depth = 0; depth < LIMITS.depth + 1; depth++) deep = { child: deep };
  const excessiveNodes = Array(LIMITS.nodes).fill(0);
  const longKey = { ['k'.repeat(LIMITS.keyChars + 1)]: true };
  let longPath = true;
  for (let index = 0; index < 5; index++) longPath = { ['k'.repeat(900)]: longPath };
  for (const text of [JSON.stringify(deep), JSON.stringify(excessiveNodes), JSON.stringify(longKey), JSON.stringify(longPath), '1e999']) {
    let expected;
    try { parseInput(text, 'json'); } catch (error) { expected = error; }
    assert.ok(expected);
    assert.throws(() => parsePayload(text), { name: expected.name, message: expected.message });
  }
});

test('auto does not bypass JSONL depth, nodes or finite-number validation', () => {
  let deep = null;
  for (let depth = 0; depth < LIMITS.depth + 1; depth++) deep = [deep];
  assert.throws(() => parsePayload(`{}\n${JSON.stringify(deep)}`), { name: 'RangeError', message: /nesting depth/ });
  assert.throws(() => parsePayload(`{}\n${JSON.stringify(Array(LIMITS.nodes).fill(0))}`), { name: 'RangeError', message: /50000 value/ });
  assert.throws(() => parsePayload('{}\n1e999'), { name: 'TypeError', message: 'Non-finite numbers are not supported.' });
});
