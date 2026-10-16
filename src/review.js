/** A compact, value-free handoff for a pull request or issue. */
const ROW_LIMIT = 8;
const PATH_LIMIT = 240;
const NAME_LIMIT = 80;
const TYPES = new Set(['array', 'boolean', 'null', 'number', 'object', 'string']);
const SEVERITIES = ['risk', 'review', 'info'];
const KINDS = {
  removed: 'Field not observed',
  added: 'New field',
  'type-changed': 'Type changed',
  nullable: 'Null first observed',
  'presence-dropped': 'Presence dropped',
  'presence-increased': 'Presence increased',
  'insufficient-evidence': 'Limited evidence',
};

function count(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }

// The only free-text fields are consumer names and display paths. Bound them
// before generating delimiters, and keep arbitrary Markdown/HTML inside code.
function markdownCode(value, limit, fallback) {
  let text = typeof value === 'string' ? value : fallback;
  text = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ');
  if (text.length > limit) {
    text = text.slice(0, limit);
    if (/[\ud800-\udbff]$/.test(text)) text = text.slice(0, -1);
    text += '… [truncated]';
  }
  return text.split('|').map(part => {
    let longest = 0;
    for (const run of part.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
    const delimiter = '`'.repeat(longest + 1);
    return `${delimiter} ${part} ${delimiter}`;
  }).join('&#124;');
}

function types(values) {
  return Array.isArray(values) ? [...new Set(values.filter(value => TYPES.has(value)))].sort().join(', ') || 'not observed' : 'not observed';
}

/**
 * Only whitelisted structural metadata enters this summary. In particular,
 * samples, scalar evidence, filenames, rule configurations and free-form report
 * descriptions are intentionally never read. Field paths and names can still
 * identify private systems, so users should review this text before sharing.
 */
export function toReviewSummary(report = {}) {
  if (report === null || typeof report !== 'object') throw new TypeError('A review report must be an object.');
  const beforeSamples = count(report.beforeSamples);
  const afterSamples = count(report.afterSamples);
  const changes = Array.isArray(report.changes) ? report.changes.filter(change => change && typeof change === 'object') : [];
  const consumer = report.consumer && typeof report.consumer === 'object' ? report.consumer : null;
  const lines = ['## Payload Radar review', '', `Samples: **${beforeSamples} baseline / ${afterSamples} candidate**.`, ''];

  if (beforeSamples > 0 && afterSamples > 0) {
    const counts = SEVERITIES.map(severity => `${changes.filter(change => change.severity === severity).length} ${severity}`);
    lines.push(`Observed shape changes: **${changes.length}** (${counts.join(' · ')}).`, '', 'Sample-based structural comparison; findings indicate review risk, not proven contract breaks.', '');
    if (changes.length) {
      const ranked = changes.map((change, index) => ({ change, index })).sort((a, b) => {
        const rank = severity => { const index = SEVERITIES.indexOf(severity); return index < 0 ? SEVERITIES.length : index; };
        return rank(a.change.severity) - rank(b.change.severity) || a.index - b.index;
      });
      lines.push('| Severity | Field | Change | Before types | After types |', '| --- | --- | --- | --- | --- |');
      for (const { change } of ranked.slice(0, ROW_LIMIT)) {
        const severity = SEVERITIES.includes(change.severity) ? change.severity : 'unknown';
        const kind = Object.hasOwn(KINDS, change.kind) ? KINDS[change.kind] : 'Observed change';
        lines.push(`| ${severity} | ${markdownCode(change.path, PATH_LIMIT, '(path unavailable)')} | ${kind} | ${types(change.beforeTypes)} | ${types(change.afterTypes)} |`);
      }
      if (changes.length > ROW_LIMIT) lines.push('', `Showing ${ROW_LIMIT} of ${changes.length} structural findings; **${changes.length - ROW_LIMIT} more omitted** from this summary.`);
    } else {
      lines.push('No structural changes observed in these samples. Values may differ; unchanged structure does not prove compatibility.');
    }
  } else if (beforeSamples === 0 && consumer) {
    lines.push('**Consumer checks only; no baseline comparison.** No claim about structural drift is made.');
  } else {
    lines.push('**Insufficient comparison context.** Load both baseline and candidate samples, or import a Consumer Lens and provide candidate samples. No structural drift conclusion is available.');
  }

  if (consumer) {
    const status = ['fail', 'review', 'pass'].includes(consumer.status) ? consumer.status : 'unknown';
    const results = Array.isArray(consumer.results) ? consumer.results.filter(result => result && typeof result === 'object') : [];
    const attention = results.filter(result => result.status === 'fail' || result.status === 'review');
    attention.sort((a, b) => Number(a.status !== 'fail') - Number(b.status !== 'fail'));
    lines.push('', `Consumer: ${markdownCode(consumer.name, NAME_LIMIT, 'Unnamed consumer')} · Status: **${status}**.`, '', `Rules: **${count(consumer.ruleCount)}** · Failed observations: **${count(consumer.violations)}** · Unobserved rules: **${count(consumer.unobservedRules)}**.`, '', 'Explicit type and presence rules are checked against candidate samples. These checks do not inspect application code or guarantee runtime behavior or future payload compatibility. Empty arrays provide no item evidence.');
    if (attention.length) {
      lines.push('', '| Status | Field | Violations | Missing | Wrong type |', '| --- | --- | --- | --- | --- |');
      for (const result of attention.slice(0, ROW_LIMIT)) {
        lines.push(`| ${result.status === 'fail' ? 'fail' : 'unobserved'} | ${markdownCode(result.path, PATH_LIMIT, '(path unavailable)')} | ${count(result.violations)} | ${count(result.missing)} | ${count(result.mismatched)} |`);
      }
      if (attention.length > ROW_LIMIT) lines.push('', `Showing ${ROW_LIMIT} of ${attention.length} failing or unobserved rules; **${attention.length - ROW_LIMIT} more omitted** from this summary.`);
    } else {
      lines.push('', 'No failing or unobserved rules reported. A pass covers only the selected rules and these samples.');
    }
  }

  lines.push('', 'No raw sample values or filenames are included. Field paths and consumer names may still be sensitive; review before sharing.', '', '[Reviewed with Payload Radar](https://qsxustc.github.io/payload-radar/) · [Source](https://github.com/qsxustc/payload-radar)', '');
  return lines.join('\n');
}
