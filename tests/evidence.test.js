import test from 'node:test';
import assert from 'node:assert/strict';
import { collectEvidence, countFields } from '../src/evidence.js';

test('nested property evidence counts only actual parent objects', () => {
  const result = collectEvidence([{ customer: { email: 'a' } }, { customer: {} }, {}, { customer: null }], ['customer', 'email']);
  assert.equal(result.total, 2);
  assert.equal(result.entries[1].present, false);
});
test('array evidence pools items and preserves actual JSON pointers', () => {
  const result = collectEvidence([{ items: [{ 'a/b': 1 }, {}] }, { items: [] }], ['items', null, 'a/b']);
  assert.equal(result.total, 2);
  assert.equal(result.entries[0].location, '/items/0/a~1b');
  assert.equal(result.entries[1].present, false);
});
test('literal bracket field is distinct from the array wildcard', () => {
  assert.equal(collectEvidence([{ '[]': 3 }], ['[]']).entries[0].value, 3);
  assert.equal(collectEvidence([[3]], [null]).entries[0].value, 3);
});
test('evidence limits previews but counts all observations', () => {
  const result = collectEvidence(Array.from({ length: 12 }, (_, value) => ({ value })), ['value'], 3);
  assert.equal(result.total, 12);
  assert.equal(result.entries.length, 3);
});
test('field counts include object fields inside array items', () => {
  assert.equal(countFields({ properties: { a: { properties: {}, items: { properties: { b: { properties: {} } } } } } }), 2);
});
