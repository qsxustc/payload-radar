import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { toReviewSummary } from '../src/review.js';
import { inferShape, compareShapes } from '../src/core.js';
import { parseLens, checkLens } from '../src/consumer.js';
import { demos } from '../src/demo.js';

const finding = (path = '$.total', severity = 'risk') => ({ path, severity, kind: 'type-changed', beforeTypes: ['number'], afterTypes: ['string'] });
const rule = (path = '$.total', status = 'fail') => ({ path, status, violations: 2, missing: 1, mismatched: 1 });
const consumer = results => ({ name: 'Checkout UI', status: 'fail', ruleCount: results.length, violations: 5, unobservedRules: 1, results });
const report = extra => ({ beforeSamples: 2, afterSamples: 3, changes: [finding()], ...extra });

test('summary includes structural counts, limited evidence and transparent attribution', () => {
  const text = toReviewSummary(report({ changes: [finding(), finding('$.customer', 'review'), finding('$.currency', 'info')] }));
  assert.match(text, /^## Payload Radar review\n/);
  assert.match(text, /2 baseline \/ 3 candidate/);
  assert.match(text, /\*\*3\*\* \(1 risk · 1 review · 1 info\)/);
  assert.match(text, /\| risk \| ` \$\.total ` \| Type changed \| number \| string \|/);
  assert.match(text, /not proven contract breaks/);
  assert.match(text, /\[Reviewed with Payload Radar\]\(https:\/\/qsxustc.github.io\/payload-radar\/\)/);
  assert.match(text, /\[Source\]\(https:\/\/github.com\/qsxustc\/payload-radar\)/);
});

test('only whitelisted metadata enters the share text, never raw values, filenames, evidence or lens configuration', () => {
  const secret = 'SECRET_customer_value_741';
  const result = rule();
  Object.assign(result, { tokens: [secret], types: [secret], required: true, examples: [{ value: secret, pointer: secret }], metadata: secret });
  const text = toReviewSummary(report({
    tool: secret, version: secret, basis: secret, beforeName: secret, afterName: secret,
    before: [{ total: secret }], after: [{ total: secret }],
    changes: [{ ...finding(), message: secret, id: secret, pointer: secret, tokens: [secret], beforeValue: secret, afterValue: secret, beforeTypes: [secret, 'number'], afterTypes: [secret, 'string'] }],
    consumer: { ...consumer([result]), samples: [secret], lens: { name: secret } },
  }));
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes('required'), false);
  assert.match(text, /Field paths and consumer names may still be sensitive/);
  assert.match(text, /do not inspect application code or guarantee runtime behavior/);
});

test('candidate-only checks never claim zero drift or a baseline comparison', () => {
  const text = toReviewSummary(report({ beforeSamples: 0, changes: [finding()], consumer: consumer([rule()]) }));
  assert.match(text, /Consumer checks only; no baseline comparison/);
  assert.match(text, /No claim about structural drift is made/);
  assert.equal(text.includes('Observed shape changes:'), false);
  assert.equal(text.includes('Type changed'), false);
  assert.match(text, /Consumer: ` Checkout UI `/);
  assert.match(text, /Failed observations: \*\*5\*\*/);
});

test('missing comparison context is explicit, while a stable observed shape remains qualified', () => {
  assert.match(toReviewSummary({}), /Insufficient comparison context/);
  assert.match(toReviewSummary(report({ beforeSamples: 0 })), /No structural drift conclusion is available/);
  assert.match(toReviewSummary(report({ afterSamples: 0 })), /Insufficient comparison context/);
  const stable = toReviewSummary(report({ changes: [] }));
  assert.match(stable, /No structural changes observed in these samples/);
  assert.match(stable, /unchanged structure does not prove compatibility/);
  assert.throws(() => toReviewSummary(null), TypeError);
});

test('structural and consumer tables show at most eight entries with exact omitted totals and risk first', () => {
  const changes = Array.from({ length: 12 }, (_, index) => finding(`$.change${index}`, index < 4 ? 'info' : 'risk'));
  const results = Array.from({ length: 11 }, (_, index) => rule(`$.rule${index}`, index < 3 ? 'review' : 'fail'));
  const text = toReviewSummary(report({ changes, consumer: consumer([...results, rule('$.passed', 'pass')]) }));
  assert.match(text, /Showing 8 of 12 structural findings; \*\*4 more omitted\*\*/);
  assert.match(text, /Showing 8 of 11 failing or unobserved rules; \*\*3 more omitted\*\*/);
  assert.equal(text.split('\n').filter(line => /^\| (risk|review|info) \|/.test(line)).length, 8);
  assert.equal(text.split('\n').filter(line => /^\| (fail|unobserved) \|/.test(line)).length, 8);
  assert.equal(text.includes('$.change0'), false);
  assert.equal(text.includes('$.rule0'), false);
  assert.equal(text.includes('$.passed'), false);
});

test('Markdown names and paths cannot break tables, create links/images or execute HTML', () => {
  const malicious = '`x``|\\|\n![x](https://evil.test) <img src=x onerror=alert(1)>\u2028\u0000';
  const text = toReviewSummary(report({ changes: [finding(malicious)], consumer: { ...consumer([rule(malicious)]), name: malicious } }));
  const row = text.split('\n').find(line => line.startsWith('| risk |'));
  // Literal input pipes are converted into entities between balanced code spans;
  // every remaining pipe belongs to the table's fixed column separators.
  assert.equal(row.match(/\|/g).length, 6);
  assert.match(row, /&#124;/);
  assert.match(row, /``` `x`` ```/);
  assert.equal(text.includes('\u0000'), false);
  assert.equal(text.includes('\u2028'), false);
  const nameLine = text.split('\n').find(line => line.startsWith('Consumer:'));
  assert.ok(nameLine.endsWith('Status: **fail**.'));
  assert.match(nameLine, /` .*?!\[x\]\(https:\/\/evil.test\) <img .*? ` · Status/);
});

test('long multi-byte, delimiter-heavy paths are visibly truncated and output stays under 64 KiB', () => {
  const longPath = '$.' + '`|😀字'.repeat(4096);
  const text = toReviewSummary(report({
    changes: Array.from({ length: 16 }, () => finding(longPath)),
    consumer: { ...consumer(Array.from({ length: 16 }, () => rule(longPath))), name: '😀'.repeat(80) },
  }));
  assert.match(text, /… \[truncated\]/);
  assert.ok(Buffer.byteLength(text) < 64 * 1024, `${Buffer.byteLength(text)} bytes`);
  assert.equal(text.includes('\ufffd'), false);
  assert.equal(text.includes(longPath), false);
  assert.match(text, /Showing 8 of 16/);
});

test('invalid numeric and enum metadata cannot smuggle custom text into the summary', () => {
  const secret = 'SECRET_METADATA';
  const text = toReviewSummary({ beforeSamples: 1, afterSamples: 1, changes: [{ ...finding(), severity: secret, kind: secret, beforeTypes: [secret], afterTypes: [secret] }], consumer: { name: 'Consumer', status: secret, ruleCount: secret, violations: Infinity, unobservedRules: -1, results: [] } });
  assert.equal(text.includes(secret), false);
  assert.match(text, /Status: \*\*unknown\*\*/);
  assert.match(text, /Rules: \*\*0\*\* · Failed observations: \*\*0\*\* · Unobserved rules: \*\*0\*\*/);
});

test('the real checkout demo reports nine changes, two failed rules and five failed observations without sample values', async () => {
  const lens = parseLens(await readFile(new URL('../examples/checkout.lens.json', import.meta.url), 'utf8'));
  const text = toReviewSummary({
    beforeSamples: demos.checkout.before.length, afterSamples: demos.checkout.after.length,
    changes: compareShapes(inferShape(demos.checkout.before), inferShape(demos.checkout.after)),
    consumer: checkLens(lens, demos.checkout.after),
  });
  assert.match(text, /Observed shape changes: \*\*9\*\*/);
  assert.match(text, /Rules: \*\*2\*\* · Failed observations: \*\*5\*\*/);
  assert.equal(text.split('\n').filter(line => line.startsWith('| fail |')).length, 2);
  for (const value of ['84.50', 'Ada Chen', 'ada@example.test', 'ord_1041', 'TRK-2041']) assert.equal(text.includes(value), false);
});
