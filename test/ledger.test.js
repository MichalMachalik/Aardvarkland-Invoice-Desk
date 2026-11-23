import test from 'node:test';
import assert from 'node:assert/strict';
import { amountToMinor, approveInvoice, bankHeader, emptyLedger, importInvoice, importPayments,
  invoiceStatus, matchInvoice, normalizeInvoice, parseBankCsv, parseInvoiceText, unmatchInvoice } from '../site/assets/ledger.js';
import { invoiceLines, samples, seedLedger, statement } from '../site/assets/samples.js';

const record = (ledger, number) => ledger.invoices.find(item => item.number.endsWith(String(number)));
const sample = samples[3];
const importKota = ledger => importInvoice(ledger, parseInvoiceText(invoiceLines(sample).join('\n')), { file: sample.file });

test('PDF data is anchored to the expected layout and amounts use integer minor units', () => {
  assert.equal(parseInvoiceText(invoiceLines(sample).join('\n')).amount, 48000);
  assert.equal(amountToMinor('8 450,50'), 845050);
  assert.throws(() => amountToMinor('12.001'));
  assert.throws(() => parseInvoiceText('Invoice: FV-DEMO-1'));
});

test('review gates pairing and repeated import preserves an existing match', () => {
  const imported = importKota(seedLedger());
  const first = importPayments(imported.ledger, parseBankCsv(statement));
  assert.deepEqual([first.added, first.skipped], [3, 3]);
  assert.equal(invoiceStatus(first.ledger, record(first.ledger, 2404)).state, 'review');
  const reviewed = approveInvoice(first.ledger, imported.id, sample);
  const { state, payment } = invoiceStatus(reviewed, record(reviewed, 2404));
  assert.equal(state, 'ready');
  assert.equal(payment.id, 'TX-DEMO-018');
  const matched = matchInvoice(reviewed, imported.id, payment.id);
  assert.equal(invoiceStatus(matched, record(matched, 2404)).state, 'paid');
  assert.equal(matchInvoice(matched, imported.id, payment.id), matched);
  const repeat = importPayments(matched, parseBankCsv(statement));
  assert.deepEqual([repeat.added, repeat.skipped], [0, 6]);
  assert.equal(repeat.ledger, matched);
  assert.equal(importKota(repeat.ledger).ledger, matched);
  const unlinked = unmatchInvoice(matched, imported.id);
  assert.equal(invoiceStatus(unlinked, record(unlinked, 2404)).state, 'ready');
});

test('an amount difference is visible and cannot be forced into a match', () => {
  const ledger = seedLedger();
  const invoice = record(ledger, 2402);
  assert.equal(invoiceStatus(ledger, invoice).state, 'mismatch');
  assert.throws(() => matchInvoice(ledger, invoice.id, 'TX-DEMO-016'));
});

test('further exact transfers or competing documents block a match', () => {
  const seed = seedLedger();
  const candidate = seed.payments.find(payment => payment.id === 'TX-DEMO-015');
  const duplicated = importPayments(seed, [{ ...candidate, id: 'TX-DEMO-021' }]).ledger;
  assert.equal(invoiceStatus(duplicated, record(duplicated, 2401)).state, 'ambiguous');
  const second = importInvoice(seed, normalizeInvoice({ ...samples[0], number: 'FV-DEMO-3301' }), {});
  assert.equal(invoiceStatus(second.ledger, record(second.ledger, 2401)).state, 'ambiguous');
});

test('wrong currency, outflows, and movements dated before issue cannot match', () => {
  const imported = importKota(emptyLedger());
  const reviewed = approveInvoice(imported.ledger, imported.id, sample);
  const source = parseBankCsv(statement).find(payment => payment.id === 'TX-DEMO-018');
  for (const changes of [{ direction: 'OUT' }, { currency: 'CZK' }, { posted: '2026-11-01' }]) {
    const ledger = importPayments(reviewed, [{ ...source, ...changes }]).ledger;
    assert.notEqual(invoiceStatus(ledger, record(ledger, 2404)).state, 'ready');
  }
});

test('a conflicting identifier aborts the whole batch', () => {
  const ledger = seedLedger();
  const source = ledger.payments[0];
  const batch = [{ ...source, id: 'TX-DEMO-NEW' }, { ...source, amount: source.amount + 1 }];
  assert.throws(() => importPayments(ledger, batch), /Výpis nebyl importován/);
  assert.equal(ledger.payments.length, 3);
  const invoice = normalizeInvoice({ ...samples[0], total: '30.00' });
  assert.throws(() => importInvoice(ledger, invoice, {}), /jiné údaje/);
});

test('bank CSV accepts BOM, quoted delimiters and an empty reference', () => {
  const row = '\uFEFF' + bankHeader + '\r\nTX-DEMO-1;2026-11-18;IN;;20,00;CZK;"Demo; ""výpis"""\r\n';
  assert.equal(parseBankCsv(row)[0].party, 'Demo; "výpis"');
  assert.equal(parseBankCsv(row)[0].symbol, '');
  assert.throws(() => parseBankCsv(row.replace('2026-11-18', '2026-02-30')), /Řádek 2/);
  assert.throws(() => parseBankCsv(row.replace('"Demo', 'Demo')), /Řádek 2/);
});
