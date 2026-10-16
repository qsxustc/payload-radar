import test from 'node:test';
import assert from 'node:assert/strict';
import { createConsumerUI } from '../src/consumer-ui.js';
import { CONSUMER_LIMITS, serializeLens } from '../src/consumer.js';
import { compareShapes, inferShape } from '../src/core.js';

// A small DOM surface exercises the real event handlers without adding a runtime
// dependency or duplicating their lens validation/state management.
class Element {
  constructor() { this.value = ''; this.checked = false; this.listeners = new Map(); this.children = []; this.dataset = {}; }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  fire(type, event = { target: this }) { return this.listeners.get(type)?.(event); }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
  click() { return this.fire('click'); }
  set innerHTML(html) {
    this.html = html;
    this.children = [];
    for (const match of html.matchAll(/<input\b[^>]*>/g)) {
      const input = new Element();
      for (const attribute of match[0].matchAll(/data-([a-z-]+)="([^"]*)"/g)) {
        input.dataset[attribute[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = attribute[2];
      }
      input.checked = /\bchecked\b/.test(match[0]);
      this.children.push(input);
    }
  }
  get innerHTML() { return this.html || ''; }
  querySelectorAll(selector) {
    const key = { '[data-remove-rule]': 'removeRule', '[data-rule-type]': 'ruleType', '[data-required-rule]': 'requiredRule' }[selector];
    return key ? this.children.filter(child => key in child.dataset) : [];
  }
  querySelector() { return null; }
}

function fixture(t) {
  const nodes = new Map();
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); };
  node('#lens-name').value = 'My consumer';
  const previous = globalThis.document;
  globalThis.document = { querySelector: node };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  let dirty = false;
  let result = null;
  let updates = 0;
  let ui;
  ui = createConsumerUI({ getResult: () => result, isDirty: () => dirty, onUpdate: () => { updates++; ui.render(); }, onDemo() {}, download() {} });
  return { ui, node, getUpdates: () => updates, setDirty(value) { dirty = value; }, setResult(value) { result = value; }, import(lens) { node('#lens-json-input').value = serializeLens(lens); node('#lens-apply-import').click(); } };
}

function comparison(before, after, afterFormat = 'json') {
  const beforeShape = inferShape(before);
  const afterShape = inferShape(after);
  return { before, after, beforeShape, afterShape, afterFormat, changes: compareShapes(beforeShape, afterShape) };
}

function limitLens() {
  const make = padding => ({ kind: 'payload-radar-consumer', schemaVersion: 1, name: 'A', rules: Array.from({ length: 100 }, (_, index) => ({ tokens: [String(index), 'x'.repeat(1024), 'y'.repeat(1024), 'z'.repeat(padding)], types: ['number'], required: true })) });
  const size = lens => Buffer.byteLength(`${JSON.stringify(lens, null, 2)}\n`);
  let padding = 0;
  while (size(make(padding + 1)) <= CONSUMER_LIMITS.bytes) padding++;
  const lens = make(padding);
  lens.rules.at(-1).tokens[3] += 'z'.repeat(CONSUMER_LIMITS.bytes - size(lens));
  assert.equal(Buffer.byteLength(serializeLens(lens)), CONSUMER_LIMITS.bytes);
  return lens;
}

test('near-limit imported lenses retain their last valid state after name, type, and required edits fail', t => {
  const { ui, node, import: apply } = fixture(t);
  const lens = limitLens();
  apply(lens);
  assert.deepEqual(ui.value(), lens);

  node('#lens-name').value = 'BB';
  assert.doesNotThrow(() => node('#lens-name').fire('input'));
  assert.equal(ui.value().name, 'A');
  assert.equal(node('#lens-name').value, 'A');
  assert.match(node('#lens-status').textContent, /256 KiB/);

  let input = node('#lens-rule-list').querySelectorAll('[data-rule-type]').find(input => input.dataset.rule === '0' && input.dataset.ruleType === 'string');
  input.checked = true;
  assert.doesNotThrow(() => input.fire('change'));
  assert.deepEqual(ui.value().rules[0].types, ['number']);
  assert.match(node('#lens-status').textContent, /256 KiB/);
  assert.equal(node('#lens-rule-list').querySelectorAll('[data-rule-type]').find(input => input.dataset.rule === '0' && input.dataset.ruleType === 'string').checked, false);

  input = node('#lens-rule-list').querySelectorAll('[data-required-rule]').find(input => input.dataset.requiredRule === '0');
  input.checked = false;
  assert.doesNotThrow(() => input.fire('change'));
  assert.equal(ui.value().rules[0].required, true);
  assert.match(node('#lens-status').textContent, /256 KiB/);

  node('#lens-name').value = 'B';
  node('#lens-name').fire('input');
  assert.equal(ui.value().name, 'B');
  assert.equal(Buffer.byteLength(serializeLens(ui.value())), CONSUMER_LIMITS.bytes);
});

test('manual lens text edits and closing import supersede pending file reads', async t => {
  const { ui, node } = fixture(t);
  const lens = { kind: 'payload-radar-consumer', schemaVersion: 1, name: 'File lens', rules: [{ tokens: ['id'], types: ['number'], required: true }] };
  let resolve;
  node('#lens-file').files = [{ size: 100, arrayBuffer: () => new Promise(done => { resolve = done; }) }];
  const pending = node('#lens-file').fire('change');
  node('#lens-json-input').value = 'manual edit';
  node('#lens-json-input').fire('input');
  resolve(new TextEncoder().encode(serializeLens(lens)).buffer);
  await pending;
  assert.equal(node('#lens-json-input').value, 'manual edit');
  assert.equal(ui.value(), null);

  const second = node('#lens-file').fire('change');
  node('#lens-import-dialog').close();
  resolve(new TextEncoder().encode(serializeLens(lens)).buffer);
  await second;
  assert.equal(node('#lens-json-input').value, 'manual edit');
});

test('protect refuses to create assumptions from stale baseline results', t => {
  const { ui, node, setDirty } = fixture(t);
  setDirty(true);
  ui.protect(['total']);
  assert.equal(ui.value(), null);
  assert.equal(node('#lens-status').textContent, 'Compare current payloads before protecting a field.');
});

test('switching from the demo drops its rules and focus without hiding the user’s own changes', t => {
  const { ui, node, setResult, getUpdates } = fixture(t);
  assert.equal(ui.isDemo(), false);
  ui.preset('checkout', false);
  assert.equal(ui.isDemo(), true);
  assert.equal(node('#lens-focus').checked, true);
  const result = comparison([{ id: 1 }], [{ id: '1' }]);
  setResult(result);
  assert.equal(ui.focus(result.changes).length, 0);
  const beforeUpdates = getUpdates();

  assert.equal(ui.dropDemo(), true);
  assert.equal(getUpdates(), beforeUpdates, 'the caller renders after marking its inputs dirty');
  assert.equal(ui.value(), null);
  assert.equal(ui.isDemo(), false);
  assert.equal(node('#lens-name').value, 'My consumer');
  assert.equal(node('#lens-focus').checked, false);
  assert.deepEqual(ui.focus(result.changes), result.changes);
  assert.equal(ui.dropDemo(), false);
});

test('imported rules and user-created rules survive dropping demo assumptions', t => {
  const { ui, node, setResult, import: apply } = fixture(t);
  const lens = { kind: 'payload-radar-consumer', schemaVersion: 1, name: 'My API', rules: [{ tokens: ['id'], types: ['number'], required: true }] };
  ui.preset('checkout', false);
  apply(lens);
  assert.equal(ui.isDemo(), false);
  assert.equal(ui.dropDemo(), false);
  assert.deepEqual(ui.value(), lens);
  assert.equal(node('#lens-focus').checked, true);

  ui.reset(false);
  setResult(comparison([{ id: 1 }], [{ id: '1' }]));
  ui.protect(['id']);
  assert.equal(ui.dropDemo(), false);
  assert.deepEqual(ui.value().rules, lens.rules);
});

test('explicit edits confirm demo rules as the user’s own assumptions', t => {
  const { ui, node } = fixture(t);
  const confirm = edit => {
    ui.preset('checkout');
    edit();
    assert.equal(ui.isDemo(), false);
    assert.equal(ui.dropDemo(), false);
    assert.ok(ui.hasRules());
  };
  confirm(() => {
    node('#lens-name').value = 'My checkout';
    node('#lens-name').fire('input');
  });
  confirm(() => {
    const input = node('#lens-rule-list').querySelectorAll('[data-rule-type]').find(input => input.dataset.rule === '0' && input.dataset.ruleType === 'string');
    input.checked = true;
    input.fire('change');
  });
  confirm(() => {
    const input = node('#lens-rule-list').querySelectorAll('[data-required-rule]').find(input => input.dataset.requiredRule === '0');
    input.checked = false;
    input.fire('change');
  });
});

test('reset creates a clean consumer workspace and invalidates pending imports', async t => {
  const { ui, node, getUpdates, setResult } = fixture(t);
  setResult(comparison([{ total: 1, items: [{ quantity: 1 }] }], [{ total: '1', items: [{ quantity: 1 }] }]));
  ui.preset('checkout');
  assert.equal(ui.check().status, 'fail');
  node('#lens-json-input').value = 'pending import';
  node('#lens-import-error').hidden = false;
  let resolve;
  node('#lens-file').files = [{ size: 100, arrayBuffer: () => new Promise(done => { resolve = done; }) }];
  const pending = node('#lens-file').fire('change');
  const beforeUpdates = getUpdates();
  ui.reset();
  assert.equal(getUpdates(), beforeUpdates + 1);
  assert.equal(ui.value(), null);
  assert.equal(ui.check(), null);
  assert.equal(ui.hasRules(), false);
  assert.equal(ui.isDemo(), false);
  assert.equal(node('#lens-name').value, 'My consumer');
  assert.equal(node('#lens-focus').checked, false);
  assert.equal(node('#lens-json-input').value, '');
  assert.equal(node('#lens-import-error').hidden, true);
  const lens = { kind: 'payload-radar-consumer', schemaVersion: 1, name: 'Stale lens', rules: [{ tokens: ['id'], types: ['number'], required: true }] };
  resolve(new TextEncoder().encode(serializeLens(lens)).buffer);
  await pending;
  assert.equal(node('#lens-json-input').value, '');
  assert.equal(ui.value(), null);

  ui.preset('email', false);
  const updates = getUpdates();
  node('#lens-clear').click();
  assert.equal(getUpdates(), updates + 1);
  assert.equal(ui.isDemo(), false);
  assert.equal(ui.value(), null);
  assert.equal(node('#lens-name').value, 'My consumer');
});

test('CI snippet uses detected candidate format with explicit candidate format as its fallback', t => {
  const { ui, node, setResult, setDirty } = fixture(t);
  node('#after-format').value = 'jsonl';
  ui.render();
  assert.match(node('#lens-ci-snippet').textContent, /payload-radar@v0\.3\.0/);
  assert.match(node('#lens-ci-snippet').textContent, /candidate: candidate\.jsonl\n    format: jsonl$/);
  setResult(comparison([{ id: 1 }], [{ id: '1' }], 'json'));
  ui.render();
  assert.match(node('#lens-ci-snippet').textContent, /candidate: candidate\.json\n    format: json$/);
  node('#after-format').value = 'auto';
  setResult(comparison([{ id: 1 }], [{ id: '1' }], 'jsonl'));
  ui.render();
  assert.match(node('#lens-ci-snippet').textContent, /candidate: candidate\.jsonl\n    format: jsonl$/);
  setDirty(true);
  ui.render();
  assert.match(node('#lens-ci-snippet').textContent, /Compare the candidate/);
  assert.doesNotMatch(node('#lens-ci-snippet').textContent, /candidate\.jsonl/);
  node('#after-format').value = 'json';
  ui.render();
  assert.match(node('#lens-ci-snippet').textContent, /candidate: candidate\.json\n    format: json$/);
  node('#after-format').value = 'jsonl';
  ui.render();
  assert.match(node('#lens-ci-snippet').textContent, /candidate: candidate\.jsonl\n    format: jsonl$/);
});
