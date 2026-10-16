import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// A deliberately small DOM/event surface. Tests import the real app and use its
// handlers against the actual HTML; the harness only implements DOM mechanics.
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const voidTags = new Set(['meta', 'link', 'input', 'img', 'br', 'hr', 'source', 'area', 'base', 'embed', 'param', 'wbr']);
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toLowerCase(); this.children = []; this.attributes = {}; this.dataset = {}; this.listeners = new Map();
    this.value = ''; this.checked = false; this.hidden = false; this.disabled = false; this._text = ''; this._html = '';
    const classes = new Set();
    this.classList = { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name), toggle: (name, enabled = !classes.has(name)) => { if (enabled) classes.add(name); else classes.delete(name); return enabled; } };
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
    if (name === 'id' || name === 'value') this[name] = value;
    if (['checked', 'hidden', 'disabled', 'open'].includes(name)) this[name] = true;
    if (name === 'class') this.classList.add(...value.split(/\s+/));
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
  }
  removeAttribute(name) { delete this.attributes[name]; }
  append(child) { child.parent = this; this.children.push(child); }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(handler); }
  fire(type, event = {}) { return Promise.all((this.listeners.get(type) || []).map(handler => handler({ target: this, preventDefault() {}, ...event }))); }
  click() { return this.disabled ? Promise.resolve() : this.fire('click'); }
  focus() { this.focused = true; }
  select() { this.selectedText = true; }
  scrollIntoView() {}
  showModal() { this.open = true; }
  close() { this.open = false; return this.fire('close'); }
  contains(element) { return element === this || this.children.some(child => child.contains(element)); }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('[')) return [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)].every(([, key, value]) => key in this.attributes && (value === undefined || this.attributes[key] === value));
    return this.tagName === selector;
  }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
  querySelectorAll(selector) {
    const parts = selector.split(/\s+/);
    const matches = element => {
      if (!element.matches(parts.at(-1))) return false;
      let ancestor = element.parent;
      for (let index = parts.length - 2; index >= 0; index--) {
        while (ancestor && !ancestor.matches(parts[index])) ancestor = ancestor.parent;
        if (!ancestor) return false;
        ancestor = ancestor.parent;
      }
      return true;
    };
    const result = [];
    const visit = element => { for (const child of element.children) { if (matches(child)) result.push(child); visit(child); } };
    visit(this); return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text; }
  set innerHTML(value) { this._html = value; this.children = []; parse(value, this); }
  get innerHTML() { return this._html; }
  insertAdjacentHTML(_position, value) { this._html += value; parse(value, this); }
}

function parse(source, root) {
  const stack = [root];
  for (const match of source.matchAll(/<\/?([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const [, tag, attributes] = match;
    if (match[0].startsWith('</')) { if (stack.at(-1)?.tagName === tag) stack.pop(); continue; }
    const element = new Element(tag);
    for (const attribute of attributes.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) element.setAttribute(attribute[1], attribute[2] ?? attribute[3] ?? '');
    stack.at(-1).append(element);
    if (tag === 'option' && (element.attributes.selected !== undefined || stack.at(-1).children.length === 1)) stack.at(-1).value = element.value;
    if (!voidTags.has(tag) && !match[0].endsWith('/>')) stack.push(element);
  }
}

let session = 0;
async function app(t, { clipboard } = {}) {
  const document = new Element('document'); parse(html, document);
  document.createElement = tag => new Element(tag);
  document.body = document.querySelector('body');
  const globals = { document, location: { href: 'https://qsxustc.github.io/payload-radar/' }, navigator: { clipboard }, matchMedia: () => ({ matches: true }) };
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => { for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  await import(`../src/app.js?test-session=${++session}`);
  const $ = selector => { const element = document.querySelector(selector); assert.ok(element, `Missing element: ${selector}`); return element; };
  return { $, async paste(side, value) { $(`#${side}-input`).value = value; await $(`#${side}-input`).fire('input'); }, async importLens(lens) { $('#lens-json-input').value = JSON.stringify(lens); await $('#lens-apply-import').click(); } };
}

test('editing either demo side starts a custom comparison and exposes unrelated real changes', async t => {
  for (const first of ['before', 'after']) {
    await t.test(`${first} is edited first`, async child => {
      const { $, paste } = await app(child);
      assert.equal($('#lens-focus').checked, true);
      assert.match($('#lens-rule-list').innerHTML, /\$\.total/);
      await paste(first, first === 'before' ? '{"id":1}' : '{"id":"1"}');
      const other = first === 'before' ? 'after' : 'before';
      assert.equal($(`#${other}-input`).value, '', 'the untouched side must not retain synthetic data');
      assert.equal($('#lens-focus').checked, false);
      assert.equal($('#lens-name').value, 'My consumer');
      assert.match($('#workspace-mode').textContent, /YOUR DATA/);
      assert.equal($('#export-json').disabled, true);
      await paste(other, other === 'before' ? '{"id":1}' : '{"id":"1"}');
      await $('#compare-button').click();
      assert.equal($('#error-message').hidden, true);
      assert.match($('#change-list').innerHTML, /\$\.id/);
      assert.doesNotMatch($('#change-list').innerHTML, /\$\.total/);
      assert.equal($('#copy-review').disabled, false);
    });
  }
});

test('Use my own JSON opens empty auto-detected editors with no demo assumptions', async t => {
  const { $ } = await app(t);
  await $('#start-own').click();
  for (const side of ['before', 'after']) {
    assert.equal($(`#${side}-input`).value, '');
    assert.equal($(`#${side}-format`).value, 'auto');
    assert.equal($(`#${side}-detected`).textContent, 'Not compared');
  }
  assert.equal($('#payload-editors').open, true);
  assert.equal($('#before-input').focused, true);
  assert.equal($('#lens-name').value, 'My consumer');
  assert.equal($('#lens-focus').checked, false);
  assert.equal($('#lens-export').disabled, true);
  assert.equal($('#copy-review').disabled, true);
  assert.equal($('#copy-demo-link').hidden, true);
  assert.match($('#lens-rule-list').innerHTML, /actual dependencies/);
});

test('opening an import picker preserves the demo; selecting a file starts a clean custom comparison', async t => {
  const { $, paste } = await app(t);
  const before = $('#before-input').value;
  const after = $('#after-input').value;
  await $('#import-button').click();
  assert.equal($('#before-input').value, before, 'cancelling the picker must not discard the visible example');
  assert.equal($('#after-input').value, after);
  assert.equal($('#lens-focus').checked, true);
  const text = '{\n  "id": 1\n}';
  $('#before-file').files = [{ name: 'response.json', size: new TextEncoder().encode(text).length, arrayBuffer: async () => new TextEncoder().encode(text).buffer }];
  await $('#before-file').fire('change');
  await new Promise(setImmediate);
  assert.equal($('#before-input').value, text);
  assert.equal($('#before-name').textContent, 'response.json');
  assert.equal($('#after-input').value, '');
  assert.equal($('#lens-focus').checked, false);
  assert.equal($('#lens-name').value, 'My consumer');
  assert.match($('#workspace-mode').textContent, /YOUR DATA/);
  await paste('after', '{"id":"1"}\n{"id":"2"}');
  await $('#compare-button').click();
  assert.equal($('#error-message').hidden, true);
  assert.equal($('#before-detected').textContent, 'JSON · 1 sample');
  assert.equal($('#after-detected').textContent, 'JSON Lines · 2 samples');
  assert.match($('#change-list').innerHTML, /\$\.id/);
});

test('new comparisons retain imported lenses and candidate-only checks remain available', async t => {
  const { $, paste, importLens } = await app(t);
  const lens = { kind: 'payload-radar-consumer', schemaVersion: 1, name: 'Order service', rules: [{ tokens: ['id'], types: ['number'], required: true }] };
  await importLens(lens);
  await $('#start-own').click();
  assert.equal($('#lens-name').value, 'Order service');
  assert.match($('#lens-rule-list').innerHTML, /\$\.id/);
  assert.equal($('#lens-export').disabled, false);
  await paste('after', '{"id":"wrong"}');
  await $('#compare-button').click();
  assert.equal($('#error-message').hidden, true);
  assert.match($('#results-title').textContent, /no baseline needed/);
  assert.match($('#lens-check-summary').innerHTML, /Needs attention/);
  assert.match($('#input-status').textContent, /1 candidate samples/);
  assert.equal($('#copy-review').disabled, false);
  await $('#clear-button').click();
  assert.equal($('#lens-name').value, 'Order service');
  assert.match($('#lens-rule-list').innerHTML, /\$\.id/);
});

test('explicit edits to example assumptions remain available when payloads are replaced', async t => {
  const { $, paste } = await app(t);
  $('#lens-name').value = 'My checkout';
  await $('#lens-name').fire('input');
  await paste('before', '{"total":1,"items":[{"quantity":1}]}');
  await paste('after', '{"total":"1","items":[{"quantity":1}]}');
  await $('#compare-button').click();
  assert.equal($('#lens-name').value, 'My checkout');
  assert.equal($('#lens-focus').checked, true);
  assert.match($('#lens-check-summary').innerHTML, /Needs attention/);
  assert.match($('#change-list').innerHTML, /\$\.total/);
});

test('pretty JSON and JSON Lines are detected independently and swap preserves each explicit override', async t => {
  const { $, paste } = await app(t);
  await $('#start-own').click();
  await paste('before', '{\n  "id": 1\n}');
  await paste('after', '{"id":"1"}\n{"id":"2"}');
  await $('#compare-button').click();
  assert.equal($('#error-message').hidden, true);
  assert.equal($('#before-detected').textContent, 'JSON · 1 sample');
  assert.equal($('#after-detected').textContent, 'JSON Lines · 2 samples');
  assert.match($('#lens-ci-snippet').textContent, /candidate\.jsonl/);
  assert.match($('#change-list').innerHTML, /\$\.id/);
  $('#before-format').value = 'json'; await $('#before-format').fire('change');
  $('#after-format').value = 'jsonl'; await $('#after-format').fire('change');
  await $('#swap-button').click();
  assert.equal($('#before-format').value, 'jsonl');
  assert.equal($('#after-format').value, 'json');
  assert.equal($('#before-detected').textContent, 'JSON Lines · 2 samples');
  assert.equal($('#after-detected').textContent, 'JSON · 1 sample');
  assert.equal($('#error-message').hidden, true);
});

test('denied clipboard access opens a selectable value-free review and demo links contain no custom input', async t => {
  const { $, paste } = await app(t, { clipboard: { writeText: async () => { throw new Error('Permission denied'); } } });
  await $('#copy-demo-link').click();
  await Promise.resolve();
  assert.equal($('#copy-dialog').open, true);
  assert.equal($('#copy-text').value, 'https://qsxustc.github.io/payload-radar/?lens=checkout#consumer-panel');
  await $('#copy-dialog').close();
  await paste('before', '{"id":739281,"private":"secret-baseline"}');
  await paste('after', '{"id":"secret-candidate","private":null}');
  await $('#compare-button').click();
  await $('#copy-review').click();
  await Promise.resolve();
  assert.equal($('#copy-dialog').open, true);
  assert.equal($('#copy-text').selectedText, true);
  assert.match($('#copy-text').value, /Payload Radar review/);
  assert.match($('#copy-text').value, /\$\.id/);
  assert.doesNotMatch($('#copy-text').value, /739281|secret-baseline|secret-candidate/);
  assert.match($('#input-status').textContent, /selectable copy/);
});
