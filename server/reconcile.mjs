import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importPayments, invoiceStatus, parseBankCsv } from '../site/assets/ledger.js';
import { seedLedger } from '../site/assets/samples.js';

function reply(response, status, result) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(result));
}

async function readStatement(request) {
  const buffers = [];
  let bytes = 0;
  for await (const buffer of request) {
    bytes += buffer.length;
    if (bytes > 200_000) throw new Error('JSON musí mít nejvýše 200 kB.');
    buffers.push(buffer);
  }
  const { csv } = JSON.parse(Buffer.concat(buffers).toString('utf8')) ?? {};
  if (typeof csv !== 'string') throw new Error('Tělo požadavku musí obsahovat textové pole csv.');
  return parseBankCsv(csv);
}

export function createImportServer(filename) {
  const database = new DatabaseSync(filename);
  database.exec('PRAGMA busy_timeout = 3000; CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL)');
  database.prepare('INSERT OR IGNORE INTO ledger (id, state) VALUES (1, ?)').run(JSON.stringify(seedLedger()));
  const read = database.prepare('SELECT state FROM ledger WHERE id = 1');
  const write = database.prepare('UPDATE ledger SET state = ? WHERE id = 1');

  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/api/bank-import') return reply(response, 404, { error: 'Cesta neexistuje.' });
    let rows;
    try {
      rows = await readStatement(request);
    } catch (error) {
      return reply(response, 400, { error: error.message });
    }
    try {
      database.exec('BEGIN IMMEDIATE');
      try {
        const { ledger, added, skipped } = importPayments(JSON.parse(read.get().state), rows);
        if (added) write.run(JSON.stringify(ledger));
        const candidates = ledger.invoices
          .map(invoice => ({ invoice, result: invoiceStatus(ledger, invoice) }))
          .filter(({ result }) => result.state === 'ready')
          .map(({ invoice, result }) => ({ invoice: invoice.number, movement: result.payment.id }));
        database.exec('COMMIT');
        return reply(response, 200, { added, skipped, movementCount: ledger.payments.length, candidates });
      } catch (error) {
        database.exec('ROLLBACK');
        if (error.message.endsWith('Výpis nebyl importován.')) return reply(response, 409, { error: error.message });
        throw error;
      }
    } catch (error) {
      console.error(error.message);
      return reply(response, 503, { error: 'Úložiště se nepodařilo aktualizovat.' });
    }
  });
  server.on('close', () => database.close());
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const filename = resolve(process.env.INVOICE_DESK_DB ?? fileURLToPath(new URL('../artifacts/invoices.sqlite', import.meta.url)));
  mkdirSync(dirname(filename), { recursive: true });
  const server = createImportServer(filename);
  server.listen(4180, '127.0.0.1', () => console.log('Bank import API http://127.0.0.1:4180/api/bank-import'));
}
