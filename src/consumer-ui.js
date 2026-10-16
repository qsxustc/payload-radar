import { normalizeLens, parseLens, serializeLens, checkLens, relatedChanges, CONSUMER_LIMITS } from './consumer.js';

const TYPES = ['string', 'number', 'boolean', 'null', 'object', 'array'];
const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const pathLabel = tokens => '$' + tokens.map(token => token === null ? '[]' : /^[A-Za-z_$][\w$]*$/.test(token) ? `.${token}` : `[${JSON.stringify(token)}]`).join('');
const PRESETS = {
  checkout: { name: 'Checkout UI', rules: [{ tokens: ['total'], types: ['number'], required: true }, { tokens: ['items', null, 'quantity'], types: ['number'], required: true }] },
  email: { name: 'Order email', rules: [{ tokens: ['customer', 'name'], types: ['string'], required: true }, { tokens: ['customer', 'email'], types: ['string'], required: true }] },
};

/** Keeps portable consumer assumptions separate from payload input and view filters. */
export function createConsumerUI({ getResult, isDirty, onUpdate, onDemo, download }) {
  let rules = [];
  let committedName = $('#lens-name').value.trim() || 'My consumer';
  let fieldOptions = [];
  let fieldShape = null;
  let cache = null;
  let lensImportVersion = 0;

  function value() {
    if (!rules.length) return null;
    return normalizeLens({ kind: 'payload-radar-consumer', schemaVersion: 1, name: committedName, rules });
  }
  function check() {
    const lens = value();
    const result = getResult();
    if (!lens || !result || isDirty()) return null;
    const signature = serializeLens(lens);
    if (!cache || cache.samples !== result.after || cache.signature !== signature) cache = { samples: result.after, signature, report: checkLens(lens, result.after) };
    return cache.report;
  }
  function focus(changes) {
    return rules.length && $('#lens-focus').checked ? relatedChanges(changes, value()) : changes;
  }
  function notify() { cache = null; onUpdate(); }
  // Validate edits before committing: an imported lens can already be at its size
  // limit, and even adding one allowed type or changing true to false adds bytes.
  function commit(nextRules, name = committedName) {
    const nextName = name.trim() || 'My consumer';
    if (nextName.length > CONSUMER_LIMITS.nameChars) throw new Error('Consumer lens name must contain 1 to 80 characters after trimming.');
    const next = nextRules.length ? normalizeLens({ kind: 'payload-radar-consumer', schemaVersion: 1, name: nextName, rules: nextRules }) : { name: nextName, rules: [] };
    rules = next.rules;
    committedName = next.name;
    notify();
  }
  function edit(nextRules) {
    try { commit(nextRules); }
    catch (error) { render(); $('#lens-status').textContent = error.message; }
  }
  function apply(lens) {
    const normalized = normalizeLens(lens);
    rules = normalized.rules;
    committedName = normalized.name;
    $('#lens-name').value = normalized.name;
    $('#lens-focus').checked = true;
    notify();
  }
  function preset(key, notifyChange = true) {
    const source = PRESETS[key];
    if (!source) { rules = []; $('#lens-focus').checked = false; cache = null; return; }
    rules = source.rules.map(rule => ({ ...rule, tokens: [...rule.tokens], types: [...rule.types] }));
    committedName = source.name;
    $('#lens-name').value = source.name;
    $('#lens-focus').checked = true;
    if (notifyChange) notify(); else cache = null;
  }
  function fields(shape) {
    const output = [];
    function visit(node, tokens, total) {
      if (output.length >= 1000) return;
      if (tokens.length && node.types.length) output.push({ tokens, types: [...node.types], required: node.seen === total, path: pathLabel(tokens) });
      for (const [key, child] of Object.entries(node.properties || {})) { if (output.length >= 1000) break; visit(child, [...tokens, key], node.objectCount); }
      if (node.items) visit(node.items, [...tokens, null], node.items.seen);
    }
    if (shape) visit(shape, [], shape.seen);
    return output;
  }
  function protect(tokens) {
    if (isDirty()) { $('#lens-status').textContent = 'Compare current payloads before protecting a field.'; return; }
    if (rules.some(rule => JSON.stringify(rule.tokens) === JSON.stringify(tokens))) { $('#lens-status').textContent = 'That field is already protected. Edit its allowed types below.'; return; }
    if (rules.length >= CONSUMER_LIMITS.rules) { $('#lens-status').textContent = 'A lens supports up to 100 explicit fields.'; return; }
    const result = getResult();
    let node = result?.beforeShape;
    let total = node?.seen;
    for (const token of tokens) {
      total = token === null ? node?.items?.seen : node?.objectCount;
      node = token === null ? node?.items : node?.properties?.[token];
    }
    if (!node?.types.length) { $('#lens-status').textContent = 'Choose a field observed in the baseline. Imported lenses can also declare fields manually.'; return; }
    const next = { tokens: [...tokens], types: [...node.types], required: node.seen === total };
    // Validate the entire configuration before changing current assumptions.
    commit([...rules, next]);
  }
  function render() {
    const result = getResult();
    const dirty = isDirty();
    if (fieldShape !== (result?.beforeShape || null)) {
      fieldShape = result?.beforeShape || null;
      fieldOptions = fields(fieldShape);
      $('#lens-field').innerHTML = '<option value="">Choose a field…</option>' + fieldOptions.map((field, index) => `<option value="${index}">${escape(field.path)} · ${escape(field.types.join(' | '))}</option>`).join('');
    }
    $('#lens-field').disabled = !fieldOptions.length || dirty;
    $('#lens-add').disabled = !fieldOptions.length || dirty || rules.length >= CONSUMER_LIMITS.rules;
    $('#lens-export').disabled = !rules.length;
    $('#lens-clear').disabled = !rules.length;
    const format = $('#input-format').value === 'jsonl' ? 'jsonl' : 'json';
    $('#lens-ci-snippet').textContent = `- uses: actions/checkout@v4\n- uses: qsxustc/payload-radar@v0.2.0\n  with:\n    lens: consumer.lens.json\n    candidate: candidate.${format}\n    format: ${format}`;
    $('#lens-focus').disabled = !rules.length || !result?.before.length || dirty;
    const checked = check();
    const related = result && rules.length ? relatedChanges(result.changes, value()) : [];
    $('#lens-status').textContent = !rules.length ? 'Select the fields your consumer relies on, or try a named example. Nothing is stored automatically.' : dirty ? 'Inputs changed. Compare again to refresh consumer checks. Your lens rules remain available.' : !result ? 'Lens ready. Load candidate payloads, then compare. The baseline may be left empty.' : 'These are explicit field assumptions. Change allowed types or requiredness to match your consumer.';
    $('#lens-relevance').textContent = result?.before.length && rules.length ? `${related.length} related / ${result.changes.length} total shape changes · ${result.changes.length - related.length} unrelated` : 'No raw payload values are stored in a lens.';
    $('#lens-check-summary').innerHTML = checked ? `<div class="lens-metrics"><div class="lens-metric"><span>Consumer check</span><strong class="lens-state ${checked.status}">${checked.status === 'fail' ? 'Needs attention' : checked.status === 'review' ? 'Needs evidence' : 'Checks passed'}</strong></div><div class="lens-metric"><span>Protected fields</span><strong>${checked.ruleCount}</strong></div><div class="lens-metric"><span>Fields with violations</span><strong>${checked.results.filter(rule => rule.status === 'fail').length}</strong></div><div class="lens-metric"><span>Failed observations</span><strong>${checked.violations}</strong></div></div>` : '';
    $('#lens-rule-list').innerHTML = rules.length ? rules.map((rule, index) => {
      const report = checked?.results[index];
      return `<article class="lens-rule"><div class="lens-rule-top"><code>${escape(pathLabel(rule.tokens))}</code><div>${report ? `<span class="lens-state ${report.status}">${report.status === 'fail' ? 'VIOLATION' : report.status === 'review' ? 'UNOBSERVED' : 'PASS'}</span>` : ''}<button type="button" class="lens-remove" data-remove-rule="${index}" aria-label="Remove ${escape(pathLabel(rule.tokens))}">Remove</button></div></div><div class="lens-rule-options"><fieldset class="lens-types"><legend>Allowed types</legend>${TYPES.map(type => `<label><input type="checkbox" data-rule="${index}" data-rule-type="${type}" ${rule.types.includes(type) ? 'checked' : ''}>${type}</label>`).join('')}</fieldset><label class="lens-required"><input type="checkbox" data-required-rule="${index}" ${rule.required ? 'checked' : ''}>Required path</label></div>${report ? `<div class="lens-rule-check">${report.present} present · ${report.missing} missing · ${report.mismatched} wrong type${report.emptyArrays ? ` · ${report.emptyArrays} empty arrays` : ''}</div>${report.examples.length ? `<details class="lens-failures"><summary>See ${report.examples.length} failure location${report.examples.length === 1 ? "" : "s"}</summary>${report.examples.map(example => `<span>Sample ${example.sample} <code>${escape(example.pointer || '(root)')}</code>: ${example.reason === 'missing' ? 'path unavailable' : `${escape(example.actual)} → expected ${escape(example.expected.join(' | '))}`}</span>`).join('')}</details>` : report.status === 'review' ? '<p class="lens-failures">No field values observed. Empty arrays and absent optional paths cannot verify the allowed types.</p>' : ''}` : ''}</article>`;
    }).join('') : '<p class="lens-empty">Your consumer does not use every field. Protect only its actual dependencies, then export a small <code>.lens.json</code> file for CI.</p>';
    $('#lens-rule-list').querySelectorAll('[data-remove-rule]').forEach(button => button.addEventListener('click', () => { rules.splice(Number(button.dataset.removeRule), 1); if (!rules.length) $('#lens-focus').checked = false; notify(); }));
    $('#lens-rule-list').querySelectorAll('[data-rule-type]').forEach(input => input.addEventListener('change', () => {
      const rule = rules[Number(input.dataset.rule)];
      const type = input.dataset.ruleType;
      if (!input.checked && rule.types.length === 1) { input.checked = true; $('#lens-status').textContent = 'Keep at least one allowed type for this field.'; return; }
      const types = input.checked ? [...rule.types, type].sort() : rule.types.filter(value => value !== type);
      edit(rules.map((value, index) => index === Number(input.dataset.rule) ? { ...value, types } : value));
      $('#lens-rule-list').querySelector(`[data-rule="${input.dataset.rule}"][data-rule-type="${type}"]`)?.focus({ preventScroll: true });
    }));
    $('#lens-rule-list').querySelectorAll('[data-required-rule]').forEach(input => input.addEventListener('change', () => { const index = input.dataset.requiredRule; edit(rules.map((rule, ruleIndex) => ruleIndex === Number(index) ? { ...rule, required: input.checked } : rule)); $('#lens-rule-list').querySelector(`[data-required-rule="${index}"]`)?.focus({ preventScroll: true }); }));
  }

  $('#lens-add').addEventListener('click', () => { const index = $('#lens-field').value; if (index !== '' && fieldOptions[Number(index)]) { try { protect(fieldOptions[Number(index)].tokens); } catch (error) { $('#lens-status').textContent = error.message; } } });
  $('#lens-name').addEventListener('input', () => {
    try { commit(rules, $('#lens-name').value); }
    catch (error) { $('#lens-name').value = committedName; render(); $('#lens-status').textContent = error.message; }
  });
  $('#lens-focus').addEventListener('change', onUpdate);
  $('#lens-clear').addEventListener('click', () => { rules = []; $('#lens-focus').checked = false; notify(); });
  $('#lens-demo').addEventListener('click', () => onDemo('checkout'));
  $('#lens-email-demo').addEventListener('click', () => onDemo('email'));
  $('#lens-export').addEventListener('click', () => { try { const lens = value(); if (lens) download(serializeLens(lens), 'consumer.lens.json', 'application/json'); } catch (error) { $('#lens-status').textContent = error.message; } });
  $('#lens-import').addEventListener('click', () => { lensImportVersion++; $('#lens-import-error').hidden = true; $('#lens-json-input').value = ''; $('#lens-import-dialog').showModal(); });
  $('#lens-apply-import').addEventListener('click', () => {
    try { const lens = parseLens($('#lens-json-input').value); lensImportVersion++; apply(lens); $('#lens-import-dialog').close(); }
    catch (error) { $('#lens-import-error').textContent = error.message; $('#lens-import-error').hidden = false; }
  });
  $('#lens-json-input').addEventListener('input', () => { lensImportVersion++; });
  $('#lens-import-dialog').addEventListener('close', () => { lensImportVersion++; });
  $('#lens-pick-file').addEventListener('click', () => $('#lens-file').click());
  $('#lens-file').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    const ticket = ++lensImportVersion;
    try {
      if (file.size > CONSUMER_LIMITS.bytes) throw new Error('A Consumer Lens file must be 256 KiB or smaller.');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (ticket !== lensImportVersion) return;
      const lens = parseLens(text);
      $('#lens-json-input').value = serializeLens(lens);
      $('#lens-import-error').hidden = true;
    } catch (error) { if (ticket === lensImportVersion) { $('#lens-import-error').textContent = error.message; $('#lens-import-error').hidden = false; } }
  });
  return { render, value, check, focus, protect, preset, hasRules: () => rules.length > 0 };
}
