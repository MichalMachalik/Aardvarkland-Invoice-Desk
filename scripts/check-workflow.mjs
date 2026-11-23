import assert from 'node:assert/strict';
import { statement } from '../site/assets/samples.js';

const endpoint = process.argv[2] ?? 'http://127.0.0.1:5678/webhook/invoice-desk-bank';
const send = csv => fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ csv }),
  signal: AbortSignal.timeout(8000),
});

const first = await send(statement);
assert.equal(first.status, 200, await first.clone().text());
const initial = await first.json();
assert.deepEqual([initial.added, initial.skipped, initial.movementCount], [3, 3, 6]);
assert.deepEqual(initial.candidates, [{ invoice: 'FV-DEMO-2401', movement: 'TX-DEMO-015' }]);

const repeat = await send(statement);
assert.equal(repeat.status, 200);
const report = await repeat.json();
assert.deepEqual([report.added, report.skipped, report.movementCount], [0, 6, 6]);

const conflict = await send(statement.replace('12500.00', '12501.00'));
assert.equal(conflict.status, 409);
const invalid = await send('invalid CSV');
assert.equal(invalid.status, 400);

console.log(JSON.stringify({ first: initial, repeat: report, conflict: conflict.status, invalid: invalid.status }, null, 2));
