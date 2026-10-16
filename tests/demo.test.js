import test from 'node:test';
import assert from 'node:assert/strict';
import { demos, demoText } from '../src/demo.js';
import { parseInput, inferShape, compareShapes, toMarkdown, toJSONSchema } from '../src/core.js';

function analyze(key) {
  const demo = demos[key];
  const before = inferShape(parseInput(demoText(demo.before), 'jsonl'));
  const after = inferShape(parseInput(demoText(demo.after), 'jsonl'));
  return { demo, before, after, changes: compareShapes(before, after) };
}
test('checkout demo exposes the release risks it teaches', () => {
  const { changes } = analyze('checkout');
  assert.ok(changes.some(change => change.tokens.join('.') === 'total' && change.severity === 'risk'));
  assert.ok(changes.some(change => change.tokens.join('.') === 'customer.name' && change.kind === 'removed'));
  const email = changes.find(change => change.tokens.join('.') === 'customer.email');
  assert.equal(email.beforePresence.seen, 4);
  assert.equal(email.afterPresence.seen, 2);
  assert.ok(changes.some(change => change.kind === 'insufficient-evidence'));
});
test('webhook demo catches a boolean becoming a string in part of the sample set', () => {
  const { changes } = analyze('webhook');
  const change = changes.find(change => change.tokens.join('.') === 'data.refunded');
  assert.equal(change.severity, 'risk');
  assert.ok(change.afterTypes.includes('boolean'));
  assert.ok(change.afterTypes.includes('string'));
});
test('healthy release ignores changes to names, IDs and boolean values', () => {
  assert.deepEqual(analyze('stable').changes, []);
});
test('exported review context contains structure and counts, not sample values', () => {
  const { demo, changes, after } = analyze('checkout');
  const report = { changes, beforeName: demo.beforeName, afterName: demo.afterName, beforeSamples: demo.before.length, afterSamples: demo.after.length };
  const exports = [toMarkdown(report), JSON.stringify(report), JSON.stringify(toJSONSchema(after))].join('\n');
  for (const value of ['ada@example.test', 'Ada Chen', 'ord_1041', 'TRK-2041']) assert.equal(exports.includes(value), false);
  assert.ok(exports.includes('customer'));
});
