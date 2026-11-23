import { once } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { statement } from '../site/assets/samples.js';
import { createImportServer } from '../server/reconcile.mjs';

async function start(database) {
  const server = createImportServer(database);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    send: csv => fetch('http://127.0.0.1:' + server.address().port + '/api/bank-import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }),
    }),
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

test('reimports remain idempotent after restart, even across concurrent requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'invoice-desk-'));
  const database = join(directory, 'test.sqlite');
  let app = await start(database);
  try {
    const responses = await Promise.all([app.send(statement), app.send(statement)]);
    assert(responses.every(response => response.status === 200));
    const reports = await Promise.all(responses.map(response => response.json()));
    assert.deepEqual(reports.map(report => report.added).sort(), [0, 3]);
    await app.close();
    app = await start(database);
    const result = await (await app.send(statement)).json();
    assert.deepEqual([result.added, result.skipped, result.movementCount], [0, 6, 6]);
    assert.deepEqual(result.candidates, [{ invoice: 'FV-DEMO-2401', movement: 'TX-DEMO-015' }]);
    assert.equal((await app.send(statement.replace('12500.00', '12501.00'))).status, 409);
    assert.equal((await app.send('wrong')).status, 400);
    assert.equal((await (await app.send(statement)).json()).movementCount, 6);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
