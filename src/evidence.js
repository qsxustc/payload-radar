// null in a path means an array item. A literal field named "[]" stays a string.
export function collectEvidence(samples, tokens, limit = 6) {
  const output = [];
  let total = 0;
  function visit(value, depth, location, sample) {
    if (depth === tokens.length) {
      total++;
      if (output.length < limit) output.push({ sample, location, present: true, value });
      return;
    }
    const key = tokens[depth];
    if (key === null) {
      if (Array.isArray(value)) value.forEach((item, index) => visit(item, depth + 1, `${location}/${index}`, sample));
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const next = `${location}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      if (Object.hasOwn(value, key)) visit(value[key], depth + 1, next, sample);
      else if (depth === tokens.length - 1) {
        total++;
        if (output.length < limit) output.push({ sample, location: next, present: false });
      }
    }
  }
  samples.forEach((sample, index) => visit(sample, 0, '', index + 1));
  return { entries: output, total };
}

export function countFields(shape) {
  let count = 0;
  function visit(node) {
    for (const child of Object.values(node.properties || {})) { count++; visit(child); }
    if (node.items) visit(node.items);
  }
  visit(shape);
  return count;
}
