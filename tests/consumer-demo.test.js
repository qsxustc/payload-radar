import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inferShape, compareShapes } from '../src/core.js';
import { parseLens, serializeLens, checkLens, relatedChanges } from '../src/consumer.js';
import { demos } from '../src/demo.js';

const checkout = parseLens(await readFile(new URL('../examples/checkout.lens.json', import.meta.url), 'utf8'));
const email = parseLens(await readFile(new URL('../examples/order-email.lens.json', import.meta.url), 'utf8'));
const changes = compareShapes(inferShape(demos.checkout.before), inferShape(demos.checkout.after));

test('the shipped checkout lens turns nine shape changes into two related fields', () => {
  assert.equal(changes.length, 9);
  const related = relatedChanges(changes, checkout);
  assert.deepEqual(related.map(change => change.path).sort(), ['$.items[].quantity', '$.total']);
  assert.equal(checkLens(checkout, demos.checkout.before).status, 'pass');
  const result = checkLens(checkout, demos.checkout.after);
  assert.equal(result.violations, 5);
  assert.equal(result.results.filter(rule => rule.status === 'fail').length, 2);
});
test('a different consumer sees different affected fields in the same release', () => {
  assert.deepEqual(relatedChanges(changes, email).map(change => change.path).sort(), ['$.customer.email', '$.customer.name']);
  assert.equal(checkLens(email, demos.checkout.before).status, 'pass');
  assert.equal(checkLens(email, demos.checkout.after).violations, 6);
});
test('portable lens checks new samples without a baseline or original scalar values', () => {
  const portable = serializeLens(checkout);
  for (const value of ['84.5', 'Ada Chen', 'ada@example.test', 'ord_1041', 'beforeShape']) assert.equal(portable.includes(value), false);
  const reloaded = parseLens(portable);
  assert.deepEqual(checkLens(reloaded, demos.checkout.after), checkLens(checkout, demos.checkout.after));
});
test('consumer requirements can evolve explicitly without ignoring remaining violations', () => {
  const evolved = parseLens(serializeLens(checkout));
  evolved.rules[0].types = ['number', 'string'];
  const result = checkLens(evolved, demos.checkout.after);
  assert.equal(result.results[0].status, 'pass');
  assert.equal(result.results[1].status, 'fail');
  assert.equal(result.violations, 1);
});
