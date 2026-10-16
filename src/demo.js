const before = [
  { id: 'ord_1041', total: 84.5, customer: { name: 'Ada Chen', email: 'ada@example.test', tier: 'pro' }, items: [{ sku: 'TK-01', quantity: 2 }], shipping: { tracking: 'TRK-1041' }, tags: ['priority'] },
  { id: 'ord_1042', total: 29, customer: { name: 'Sam Rivera', email: 'sam@example.test', tier: 'free' }, items: [{ sku: 'NB-02', quantity: 1 }], shipping: { tracking: 'TRK-1042' }, tags: ['standard'] },
  { id: 'ord_1043', total: 112, customer: { name: 'Lin Park', email: 'lin@example.test', tier: 'pro' }, items: [{ sku: 'TK-01', quantity: 3 }], shipping: { tracking: 'TRK-1043' }, tags: ['priority'] },
  { id: 'ord_1044', total: 42, customer: { name: 'Jo Morgan', email: 'jo@example.test', tier: 'free' }, items: [{ sku: 'NB-02', quantity: 2 }], shipping: { tracking: 'TRK-1044' }, tags: [] },
];
const after = [
  { id: 'ord_2041', total: '84.50', currency: 'USD', customer: { full_name: 'Ada Chen', email: 'ada@example.test', tier: 'pro' }, items: [{ sku: 'TK-01', quantity: '2' }], shipping: { tracking: 'TRK-2041' }, tags: [] },
  { id: 'ord_2042', total: '29.00', currency: 'USD', customer: { full_name: 'Sam Rivera', tier: null }, items: [{ sku: 'NB-02', quantity: 1 }], shipping: { tracking: null }, tags: [] },
  { id: 'ord_2043', total: '112.00', currency: 'USD', customer: { full_name: 'Lin Park', email: 'lin@example.test', tier: 'pro' }, items: [{ sku: 'TK-01', quantity: 3 }], shipping: { tracking: 'TRK-2043' }, tags: [] },
  { id: 'ord_2044', total: '42.00', currency: 'USD', customer: { full_name: 'Jo Morgan', tier: null }, items: [{ sku: 'NB-02', quantity: 2 }], shipping: { tracking: null }, tags: [] },
];

export const demos = {
  checkout: { title: 'Checkout API · v1 → v2', before, after, beforeName: 'checkout-v1.jsonl', afterName: 'checkout-v2.jsonl' },
  webhook: {
    title: 'Webhook · success → edge cases', beforeName: 'webhook-before.jsonl', afterName: 'webhook-after.jsonl',
    before: [{ event: 'payment.completed', data: { amount: 1200, refunded: false, receipt: { url: 'https://example.test/r/1' } } }, { event: 'payment.completed', data: { amount: 800, refunded: false, receipt: { url: 'https://example.test/r/2' } } }],
    after: [{ event: 'payment.completed', data: { amount: 1200, refunded: 'false', receipt: null }, version: 2 }, { event: 'payment.completed', data: { amount: 800, refunded: true, receipt: { url: 'https://example.test/r/3' } }, version: 2 }],
  },
  stable: {
    title: 'Healthy release · values change, shape stays', beforeName: 'stable-before.jsonl', afterName: 'stable-after.jsonl',
    before: [{ id: 1, name: 'Ada', active: true }, { id: 2, name: 'Sam', active: false }],
    after: [{ id: 91, name: 'Lin', active: false }, { id: 92, name: 'Jo', active: true }],
  },
};

export function demoText(samples, format = 'jsonl') {
  return format === 'jsonl' ? samples.map(sample => JSON.stringify(sample)).join('\n') : JSON.stringify(samples, null, 2);
}
