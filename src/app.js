import { inferShape, compareShapes, toJSONSchema, toMarkdown } from './core.js';
import { demos, demoText } from './demo.js';
import { collectEvidence, countFields } from './evidence.js';
import { lensMarkdown, relatedChanges } from './consumer.js';
import { createConsumerUI } from './consumer-ui.js';
import { parsePayload } from './input.js';
import { toReviewSummary } from './review.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const names = { before: 'before.jsonl', after: 'after.jsonl' };
const labels = { risk: 'Risk', review: 'Review', info: 'Info' };
const kindLabels = { removed: 'Field not observed', added: 'New field', 'type-changed': 'Type changed', nullable: 'Null first observed', 'presence-dropped': 'Presence dropped', 'presence-increased': 'Presence increased', 'insufficient-evidence': 'Limited evidence' };
let result = null;
let selected = null;
let severity = 'all';
let pageIndex = 0;
const PAGE_SIZE = 100;
let dirty = false;
let importing = 0;
let demoKey = 'checkout';
let consumer = null;
let workspaceMode = 'demo';
let demoLensKey = 'checkout';
const importVersion = { before: 0, after: 0 };
function cancelImports() { importVersion.before++; importVersion.after++; }

function status(text) { $('#input-status').textContent = text; }
let feedbackTimer;
function feedback(text) {
  const banner = $('#action-feedback'); banner.textContent = text; banner.hidden = false;
  clearTimeout(feedbackTimer); feedbackTimer = setTimeout(() => { banner.hidden = true; }, 6500);
}
function error(message = '') { $('#error-message').textContent = message; $('#error-message').hidden = !message; }
function setExportEnabled(enabled) { ['#export-report', '#export-json', '#export-schema', '#copy-review'].forEach(id => { $(id).disabled = !enabled; }); }
function markDirty() {
  dirty = true;
  setExportEnabled(false);
  error();
  status('Inputs changed · compare again to refresh results.');
  $('#results').classList.add('stale-results');
  $('#results').setAttribute('aria-label', 'Previous results. Compare again to refresh.');
  const protectButton = $('#detail-panel .protect-selected-field');
  if (protectButton) protectButton.disabled = true;
  consumer?.render();
  updateFormatLabels();
  updateIntro();
}

function compare(force = false) {
  if (importing && force !== true) return;
  error();
  try {
    let before, after, beforeFormat = null, afterFormat;
    try {
      if (!$('#before-input').value.trim() && consumer?.hasRules()) before = [];
      else { const parsed = parsePayload($('#before-input').value, $('#before-format').value); before = parsed.samples; beforeFormat = parsed.format; }
    } catch (e) { throw new Error(`Before: ${e.message}`); }
    try { const parsed = parsePayload($('#after-input').value, $('#after-format').value); after = parsed.samples; afterFormat = parsed.format; } catch (e) { throw new Error(`After: ${e.message}`); }
    const beforeShape = inferShape(before);
    const afterShape = inferShape(after);
    const changes = before.length ? compareShapes(beforeShape, afterShape) : [];
    const rank = { risk: 0, review: 1, info: 2 };
    changes.sort((a, b) => rank[a.severity] - rank[b.severity] || a.path.localeCompare(b.path));
    result = { before, after, beforeShape, afterShape, changes, beforeFormat, afterFormat, beforeName: names.before, afterName: names.after };
    selected = changes[0]?.id || null;
    dirty = false;
    severity = 'all';
    pageIndex = 0;
    $('#change-search').value = '';
    $('#results').hidden = false;
    $('#results').classList.remove('stale-results');
    $('#results').removeAttribute('aria-label');
    setExportEnabled(true);
    status(before.length ? `${before.length} baseline + ${after.length} candidate samples · compared locally` : `${after.length} candidate samples · Consumer Lens checked without baseline payloads`);
    render();
  } catch (e) {
    error(e.message);
    dirty = true;
    setExportEnabled(false);
    status('Check your input and compare again.');
    $('#results').classList.add('stale-results');
    consumer?.render();
    $('#payload-editors').open = true;
    updateIntro();
  }
}

function summary() {
  const counts = Object.fromEntries(['risk', 'review', 'info'].map(key => [key, result.changes.filter(change => change.severity === key).length]));
  const cards = [
    { key: 'all', value: result.changes.length, label: 'Observed changes', note: result.changes.length ? 'Across the full payload shape' : 'Same observed shape' },
    { key: 'risk', value: counts.risk, label: 'Potential risks', note: 'Missing fields or new value types' },
    { key: 'review', value: counts.review, label: 'Need a closer look', note: 'Nullability, presence or coverage' },
    { key: 'info', value: counts.info, label: 'Informational', note: 'Additions or narrower observations' },
  ];
  $('#summary-cards').innerHTML = cards.map(card => `<div class="summary-card ${card.key}"><div class="stat-label"><span class="filter-dot ${card.key}"></span>${card.label}</div><div class="stat-value">${card.value.toString().padStart(2, '0')}</div><div class="stat-note">${card.note}</div></div>`).join('');
}

function percentage(presence) { return presence?.total ? `${Math.round(presence.seen / presence.total * 100)}%` : '—'; }
function typePills(types) { return types?.length ? types.map(type => `<span class="type-pill ${escape(type)}">${escape(type)}</span>`).join(' ') : '<span class="muted">not observed</span>'; }
function filteredChanges() {
  const query = $('#change-search').value.trim().toLowerCase();
  return consumer.focus(result.changes).filter(change => (severity === 'all' || change.severity === severity) && `${change.path} ${change.pointer} ${change.message} ${change.kind}`.toLowerCase().includes(query));
}
function renderList() {
  const filtered = filteredChanges();
  pageIndex = Math.min(pageIndex, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const visible = filtered.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE);
  $$('#severity-filters button').forEach(button => { button.classList.toggle('active', button.dataset.severity === severity); button.setAttribute('aria-pressed', String(button.dataset.severity === severity)); });
  if (visible.length && !visible.some(change => change.id === selected)) selected = visible[0].id;
  if (!filtered.length) selected = null;
  $('#change-list').innerHTML = filtered.length ? visible.map(change => `<button type="button" class="change-row ${escape(change.severity)} ${change.id === selected ? 'selected' : ''}" data-change-id="${escape(change.id)}" aria-pressed="${change.id === selected}"><span class="change-icon ${escape(change.severity)}" aria-hidden="true">${change.severity === 'risk' ? '↗' : change.severity === 'review' ? '◐' : '+'}</span><span class="change-copy"><span class="change-path">${escape(change.path)}</span><span class="change-description">${escape(kindLabels[change.kind] || change.kind)}</span><span class="change-meta">${typePills(change.beforeTypes)}<span class="change-arrow">→</span>${typePills(change.afterTypes)}</span></span><span class="change-tail"><span class="severity-tag ${escape(change.severity)}">${labels[change.severity]}</span><span class="presence">${percentage(change.beforePresence)} → ${percentage(change.afterPresence)}</span></span></button>`).join('') : `<div class="empty-state"><span class="empty-symbol">${result.changes.length ? '⌕' : '✓'}</span><h3>${result.changes.length ? 'No matching changes' : 'A familiar shape.'}</h3><p>${result.changes.length ? 'Try another path or severity filter.' : 'The observed types and field presence match. Values may differ; your samples still cannot prove the full contract.'}</p></div>`;
  if (filtered.length > PAGE_SIZE) {
    $('#change-list').insertAdjacentHTML('beforeend', `<div class="change-pagination"><button type="button" class="button button-quiet" data-page="previous" ${pageIndex === 0 ? 'disabled' : ''}>← Previous</button><span>${pageIndex * PAGE_SIZE + 1}–${Math.min((pageIndex + 1) * PAGE_SIZE, filtered.length)} of ${filtered.length}</span><button type="button" class="button button-quiet" data-page="next" ${(pageIndex + 1) * PAGE_SIZE >= filtered.length ? 'disabled' : ''}>Next →</button></div>`);
    $$('#change-list [data-page]').forEach(button => button.addEventListener('click', () => { pageIndex += button.dataset.page === 'next' ? 1 : -1; renderList(); renderDetail(); $('#change-list [data-change-id]')?.focus(); }));
  }
  $$('#change-list [data-change-id]').forEach(button => button.addEventListener('click', () => {
    selected = button.dataset.changeId;
    renderList(); renderDetail();
    $$('#change-list [data-change-id]').find(row => row.dataset.changeId === selected)?.focus({ preventScroll: true });
  }));
}

function evidenceHTML(samples, tokens, label) {
  const { entries, total } = collectEvidence(samples, tokens);
  return `<section class="evidence-card"><div class="evidence-label">${label}<span>${total} ${total === 1 ? 'observation' : 'observations'}</span></div>${entries.length ? entries.map(entry => {
    const raw = entry.present ? JSON.stringify(entry.value, null, 2) : '[field absent]';
    const preview = raw.length > 600 ? `${raw.slice(0, 600)}\n… preview truncated` : raw;
    return `<div class="evidence-entry"><span class="evidence-location">Sample ${entry.sample} <span title="${escape(entry.location || '/')}">${escape(entry.location || '/')}</span></span><pre class="${entry.present ? '' : 'absent'}">${escape(preview)}</pre></div>`;
  }).join('') : '<p class="muted evidence-none">No observations at this path.</p>'}${total > entries.length ? `<p class="muted evidence-more">Showing the first ${entries.length} of ${total} observations.</p>` : ''}</section>`;
}
function renderDetail() {
  const change = result.changes.find(item => item.id === selected);
  if (!change) {
    $('#detail-panel').innerHTML = '<div class="detail-empty"><div class="detail-overline">EVIDENCE INSPECTOR</div><span class="empty-symbol">◎</span><h3>Every change has a story.</h3><p>Select a change to inspect the exact values observed in your samples.</p><span class="badge">Values stay in this tab</span></div>';
    return;
  }
  $('#detail-panel').innerHTML = `<div class="detail-heading"><span class="detail-overline">EVIDENCE INSPECTOR</span><span class="severity-tag ${escape(change.severity)}">${labels[change.severity]}</span></div><h3 class="detail-path">${escape(change.path)}</h3><p class="detail-message">${escape(change.message)}</p><button type="button" class="button button-outline protect-selected-field">Protect this field in Consumer Lens</button><div class="detail-section"><div class="detail-section-title">FIELD PRESENCE <span>within observed parent objects</span></div><div class="presence-comparison">${presenceCard(change.beforePresence, 'Before')}${presenceCard(change.afterPresence, 'After')}</div></div><div class="detail-section"><div class="detail-section-title">SAMPLE EVIDENCE <span>first 6 per side · local only</span></div><div class="evidence-grid">${evidenceHTML(result.before, change.tokens, 'Before')}${evidenceHTML(result.after, change.tokens, 'After')}</div></div><div class="evidence-note"><svg class="icon"><use href="#icon-help"/></svg><p>These are observed samples, not a verified API contract. Empty arrays provide no item evidence. Array items are pooled; they are not paired by identity.</p></div><div class="pointer-line"><span>Path</span><code>${escape(change.pointer || '(root)')}</code></div>`;
  $('#detail-panel .protect-selected-field').addEventListener('click', () => { try { consumer.protect(change.tokens); } catch (e) { $('#lens-status').textContent = e.message; } });
}
function presenceCard(presence, label) {
  return `<div class="presence-card"><span>${label}</span><strong>${percentage(presence)}</strong><div class="presence-track"><i style="width:${presence?.total ? Math.max(0, Math.min(100, presence.seen / presence.total * 100)) : 0}%"></i></div><small>${presence?.seen || 0} / ${presence?.total || 0} observed</small></div>`;
}
function coverage() {
  const beforeFields = countFields(result.beforeShape), afterFields = countFields(result.afterShape);
  $('#coverage-panel').innerHTML = `<div class="coverage-heading"><svg class="icon"><use href="#icon-shield"/></svg><div><h3>Know your sample coverage.</h3><p>${Math.min(result.before.length, result.after.length) < 5 ? 'Small sample set. Add more representative payloads to catch less common shapes.' : 'Presence reflects these samples only. Include edge cases, optional fields and failure responses.'}</p></div><span class="badge">OBSERVED, NOT GUARANTEED</span></div><div class="coverage-grid"><div class="coverage-stat"><span>Baseline samples</span><strong>${result.before.length}</strong></div><div class="coverage-stat"><span>Candidate samples</span><strong>${result.after.length}</strong></div><div class="coverage-stat"><span>Baseline field paths</span><strong>${beforeFields}</strong></div><div class="coverage-stat"><span>Candidate field paths</span><strong>${afterFields}</strong></div></div><p class="coverage-footnote">Property presence is counted within parent objects. Nested array items are pooled. Value-only changes, enum changes and format changes are outside this analysis.</p>`;
}
function render() {
  $('#summary-cards').hidden = !result.before.length;
  $('.result-grid').hidden = !result.before.length;
  $('#coverage-panel').hidden = false;
  $('.export-bar').hidden = false;
  $('#results-title').textContent = result.before.length ? 'The shape of change' : 'Consumer checks · no baseline needed';
  summary(); renderList(); renderDetail(); coverage(); consumer.render();
  setExportEnabled(!dirty && (result.before.length > 0 || consumer.hasRules()));
  updateFormatLabels(); updateIntro();
}

function report() { return { tool: 'Payload Radar', version: '0.3.0', basis: result.before.length ? 'Observed shape changes and any explicitly declared consumer checks; not proof of consumer compatibility.' : 'Explicit consumer checks only. No baseline shape comparison was performed.', beforeName: result.beforeName, afterName: result.afterName, beforeSamples: result.before.length, afterSamples: result.after.length, changes: result.changes, ...(consumer.check() ? { consumer: consumer.check() } : {}) }; }
function markdownReport() {
  const context = report();
  const structural = result.before.length ? toMarkdown(context) : '# Payload Radar report\n\nNo baseline payloads loaded. Only the explicit Consumer Lens was checked.\n';
  return structural + (context.consumer ? `\n${lensMarkdown(context.consumer)}` : '');
}
function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status(`Downloaded ${name} · contains no raw sample values.`);
  feedback(`Downloaded ${name} · no raw sample values.`);
}

function loadDemo(key = 'checkout') {
  cancelImports();
  demoKey = key;
  workspaceMode = 'demo'; demoLensKey = 'checkout';
  consumer?.preset(key === 'checkout' ? 'checkout' : null, false);
  const demo = demos[key];
  for (const side of ['before', 'after']) $(`#${side}-format`).value = 'auto';
  for (const side of ['before', 'after']) { $(`#${side}-input`).value = demoText(demo[side]); names[side] = demo[`${side}Name`]; $(`#${side}-name`).textContent = names[side]; }
  updateFormatLabels();
  compare(true);
  status(`${demo.title} · synthetic example · ${demo.before.length} + ${demo.after.length} samples`);
  $('#payload-editors').open = false;
}
function updateFormatLabels() {
  for (const side of ['before', 'after']) {
    const format = !dirty && result ? result[`${side}Format`] : null;
    const samples = !dirty && result ? result[side].length : 0;
    $(`#${side}-detected`).textContent = format ? `${format === 'jsonl' ? 'JSON Lines' : 'JSON'} · ${samples} ${samples === 1 ? 'sample' : 'samples'}` : 'Not compared';
  }
}

function updateIntro() {
  const isDemo = workspaceMode === 'demo';
  $('#workspace-mode').textContent = isDemo ? 'DEMO · SYNTHETIC DATA' : 'YOUR DATA · LOCAL ONLY';
  if (isDemo) {
    const lens = consumer?.value();
    const count = result?.changes.length || 0;
    const related = result && lens ? relatedChanges(result.changes, lens).length : null;
    $('#journey-title').textContent = lens && related !== null ? `${count} API changes. ${related} relate to ${lens.name}.` : count ? `${count} observed changes. See the evidence.` : 'Different values. The same observed shape.';
    $('#journey-description').textContent = `${demos[demoKey].title}. This is synthetic example data. Start your own comparison without carrying over demo rules.`;
  } else {
    $('#journey-title').textContent = result && !dirty ? `${result.before.length ? result.changes.length + (result.changes.length === 1 ? ' observed change' : ' observed changes') : 'Consumer checks'} in your payloads.` : 'Your responses. Your review.';
    $('#journey-description').textContent = 'Paste JSON or JSON Lines on either side. Formats are detected independently. Demo rules never apply to your data; your own lenses stay available.';
  }
  $('#show-results').textContent = isDemo ? 'See example results ↓' : 'View results ↓';
  $('#show-results').disabled = !result || dirty;
  $('#start-own').textContent = isDemo ? 'Use my own JSON' : 'New comparison';
  $('#copy-demo-link').hidden = !isDemo;
  $('#payload-summary-label').textContent = isDemo ? 'View example payloads' : 'Paste or import your responses';
  $('#payload-summary-note').textContent = isDemo ? 'Editing an example starts a custom comparison.' : 'Auto detect · JSON and JSON Lines · no upload';
}

function clearPayloads({ focus = true } = {}) {
  cancelImports(); workspaceMode = 'own'; consumer.dropDemo();
  for (const side of ['before', 'after']) { $(`#${side}-input`).value = ''; names[side] = `${side}.json`; $(`#${side}-name`).textContent = names[side]; $(`#${side}-format`).value = 'auto'; }
  result = null; selected = null; dirty = false; error();
  $('#results').hidden = false; $('#summary-cards').hidden = true; $('.result-grid').hidden = true; $('#coverage-panel').hidden = true; $('.export-bar').hidden = true;
  $('#results').classList.remove('stale-results'); $('#results').removeAttribute('aria-label');
  $('#results-title').textContent = 'Consumer Lens · optional field checks'; setExportEnabled(false);
  $('#payload-editors').open = true; consumer.render(); updateFormatLabels(); updateIntro();
  status(consumer.hasRules() ? 'Fresh payloads · your explicit Consumer Lens is retained. You may load only the candidate.' : 'Fresh comparison · paste both responses. No demo rules are active.');
  if (focus) $('#before-input').focus();
}

function adoptOwnData(side) {
  if (workspaceMode !== 'demo') return;
  const text = $(`#${side}-input`).value;
  clearPayloads({ focus: false });
  $(`#${side}-input`).value = text;
}

async function copyText(text, title, success) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text); status(success); feedback(success);
  } catch {
    $('#copy-title').textContent = title; $('#copy-text').value = text;
    $('#copy-text').rows = text.includes('\n') ? 10 : 3;
    $('#copy-dialog').showModal(); $('#copy-text').focus(); $('#copy-text').select();
    status('Clipboard unavailable · a selectable copy is open. Nothing was uploaded.');
  }
}

async function importFile(side, file) {
  if (!file) return;
  if (workspaceMode === 'demo') { clearPayloads({ focus: false }); }
  const ticket = ++importVersion[side];
  markDirty();
  if (file.size > 2 * 1024 * 1024) { error('Each input must be 2 MiB or smaller. Use a representative subset.'); status('Import rejected · previous results need a fresh comparison.'); return; }
  importing++;
  $('#compare-button').disabled = true;
  status(`Reading ${file.name} locally…`);
  try {
    const buffer = await file.arrayBuffer();
    if (ticket !== importVersion[side]) return;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if (text.includes('\0')) throw new Error('Please import a UTF-8 JSON or JSON Lines text file.');
    $(`#${side}-input`).value = text;
    names[side] = file.name;
    $(`#${side}-name`).textContent = file.name;
    markDirty();
    status(`Loaded ${file.name} into ${side}. Auto detect is ready; compare when your inputs are complete.`);
  } catch (e) { if (ticket === importVersion[side]) error(e.message); }
  finally { importing--; $('#compare-button').disabled = importing > 0; }
}

$('#compare-button').addEventListener('click', compare);
$('#demo-button').addEventListener('click', () => loadDemo());
$('#examples-button').addEventListener('click', () => {
  let dialog = $('#examples-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog'); dialog.id = 'examples-dialog'; dialog.className = 'help-dialog';
    dialog.setAttribute('aria-labelledby', 'examples-title');
    dialog.innerHTML = `<div class="dialog-eyebrow">A FEW WAYS TO EXPLORE</div><h2 id="examples-title">Start with a real-shaped problem.</h2><p>All examples are synthetic. Load one to explore the workflow.</p><div class="example-options">${Object.entries(demos).map(([key, demo]) => `<button type="button" class="example-option" data-example="${key}"><strong>${escape(demo.title)}</strong><span>${key === 'checkout' ? 'Type drift, missing fields, nullable values and empty arrays' : key === 'webhook' ? 'The string “false” is truthy. See the shape behind the bug.' : 'Different IDs and names. No structural changes.'} →</span></button>`).join('')}</div><form method="dialog"><button class="button button-outline">Close</button></form>`;
    document.body.append(dialog);
    dialog.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => { loadDemo(button.dataset.example); dialog.close(); }));
  }
  dialog.showModal();
});
['#how-it-works-button', '#method-button'].forEach(id => $(id).addEventListener('click', () => $('#help-dialog').showModal()));
$('#import-button').addEventListener('click', () => { $('#before-file').click(); });
$$('[data-upload]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.upload}-file`).click()));
for (const side of ['before', 'after']) {
  $(`#${side}-input`).addEventListener('input', () => { adoptOwnData(side); importVersion[side]++; names[side] = `pasted-${side}`; $(`#${side}-name`).textContent = names[side]; markDirty(); });
  $(`#${side}-file`).addEventListener('change', event => { importFile(side, event.target.files[0]); event.target.value = ''; });
  const card = $(`.${side}-card`);
  card.addEventListener('dragover', event => { event.preventDefault(); card.classList.add('drag-over'); });
  card.addEventListener('dragleave', event => { if (!card.contains(event.relatedTarget)) card.classList.remove('drag-over'); });
  card.addEventListener('drop', event => { event.preventDefault(); card.classList.remove('drag-over'); if (event.dataTransfer.files.length !== 1) { error('Drop one file per card.'); return; } importFile(side, event.dataTransfer.files[0]); });
}
for (const side of ['before', 'after']) $(`#${side}-format`).addEventListener('change', markDirty);
$('#swap-button').addEventListener('click', () => {
  cancelImports();
  const value = $('#before-input').value; $('#before-input').value = $('#after-input').value; $('#after-input').value = value;
  [names.before, names.after] = [names.after, names.before];
  const format = $('#before-format').value; $('#before-format').value = $('#after-format').value; $('#after-format').value = format;
  for (const side of ['before', 'after']) $(`#${side}-name`).textContent = names[side];
  markDirty(); compare(true);
});
$('#clear-button').addEventListener('click', () => clearPayloads());
$('#start-own').addEventListener('click', () => clearPayloads());
$('#show-results').addEventListener('click', () => {
  const target = consumer.hasRules() ? $('#consumer-panel') : $('#results');
  target.tabIndex = -1; target.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); target.focus({ preventScroll: true });
});
$('#copy-review').addEventListener('click', () => { if (result && !dirty) copyText(toReviewSummary(report()), 'Copy review summary', 'Review summary copied · structure only. Inspect field names before sharing.'); });
$('#copy-demo-link').addEventListener('click', () => {
  const url = new URL('https://qsxustc.github.io/payload-radar/');
  if (demoKey === 'checkout') { url.searchParams.set('lens', demoLensKey); url.hash = 'consumer-panel'; }
  else { url.searchParams.set('demo', demoKey); url.hash = 'results'; }
  copyText(url.href, 'Copy built-in demo link', 'Built-in demo link copied · your payloads and custom rules are not included.');
});
$('#severity-filters').addEventListener('click', event => { const button = event.target.closest('[data-severity]'); if (!button || !result) return; severity = button.dataset.severity; pageIndex = 0; renderList(); renderDetail(); });
$('#change-search').addEventListener('input', () => { if (result) { pageIndex = 0; renderList(); renderDetail(); } });
$('#export-report').addEventListener('click', () => { if (result && !dirty) download(markdownReport(), 'payload-radar-report.md', 'text/markdown;charset=utf-8'); });
$('#export-json').addEventListener('click', () => { if (result && !dirty) download(JSON.stringify(report(), null, 2), 'payload-radar-report.json', 'application/json'); });
$('#export-schema').addEventListener('click', () => { if (result && !dirty) download(JSON.stringify(toJSONSchema(result.afterShape), null, 2), 'candidate.schema.json', 'application/schema+json'); });
document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); compare(); } });
consumer = createConsumerUI({
  getResult: () => result,
  isDirty: () => dirty,
  onUpdate: () => { pageIndex = 0; if (result && !dirty) render(); else consumer.render(); },
  onDemo: key => { loadDemo('checkout'); demoLensKey = key; consumer.preset(key); },
  download,
});
const query = new URL(location.href).searchParams;
const requestedDemo = query.get('demo');
loadDemo(Object.hasOwn(demos, requestedDemo) ? requestedDemo : demoKey);
if (query.get('lens') === 'email' && demoKey === 'checkout') { demoLensKey = 'email'; consumer.preset('email'); }
