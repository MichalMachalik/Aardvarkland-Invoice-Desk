const invoicePattern = /^FV-DEMO-[A-Z0-9-]{1,30}$/;
const customerPattern = /^DEMO-[A-Z0-9-]{1,24}$/;
const paymentPattern = /^TX-DEMO-[A-Z0-9-]{1,30}$/;
const currencies = new Set(['CZK', 'EUR']);

export const bankHeader = 'transakce;datum;smer;symbol;castka;mena;protistrana';

function required(condition, message) {
  if (!condition) throw new Error(message);
}

function label(value, name) {
  const text = String(value ?? '').trim();
  required(text.length > 0 && text.length <= 100, 'Zkontrolujte pole ' + name + '.');
  return text;
}

function identifier(value, pattern, message) {
  const key = String(value ?? '').trim().toUpperCase();
  required(pattern.test(key), message);
  return key;
}

export function amountToMinor(value) {
  const compact = String(value ?? '').trim().replace(/[ \u00A0\u202F]/g, '');
  required(/^\d{1,12}(?:[.,]\d{1,2})?$/.test(compact), 'Částka musí být kladné číslo s nejvýše dvěma desetinnými místy.');
  const [whole, fraction = ''] = compact.split(/[,.]/);
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  required(amount > 0, 'Částka musí být větší než nula.');
  return amount;
}

function symbol(value, allowEmpty = false) {
  const raw = String(value ?? '').trim();
  if (allowEmpty && !raw) return '';
  required(/^\d{1,10}$/.test(raw), 'Variabilní symbol musí mít jeden až deset znaků číslic.');
  return raw.replace(/^0+(?=\d)/, '');
}

function currency(value) {
  const code = String(value ?? '').trim().toUpperCase();
  required(currencies.has(code), 'Podporované měny jsou CZK a EUR.');
  return code;
}

function date(value) {
  const raw = String(value ?? '').trim();
  const day = new Date(raw + 'T00:00:00Z');
  required(/^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(+day) && day.toISOString().slice(0, 10) === raw,
    'Datum musí být platné ve formátu RRRR-MM-DD.');
  return raw;
}

export function parseInvoiceText(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  required(lines.includes('FIKTIVNI DOKLAD / SAMPLE INVOICE'), 'Vyberte připravený fiktivní doklad ve formátu tohoto demo importu.');
  const fields = new Map();
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator);
    required(!fields.has(key), 'Doklad obsahuje více hodnot pro pole ' + key + '.');
    fields.set(key, line.slice(separator + 1).trim());
  }
  return normalizeInvoice({
    number: fields.get('Invoice'),
    customerId: fields.get('Customer ID'),
    customer: fields.get('Customer'),
    issued: fields.get('Issued'),
    due: fields.get('Due'),
    symbol: fields.get('Reference'),
    total: fields.get('Total'),
    currency: fields.get('Currency'),
  });
}

export function normalizeInvoice(input) {
  const invoice = {
    number: identifier(input.number, invoicePattern, 'Číslo fiktivního dokladu musí začínat FV-DEMO-.'),
    customerId: identifier(input.customerId, customerPattern, 'Odběratel musí mít fiktivní identifikátor DEMO-.'),
    customer: label(input.customer, 'odběratel'),
    issued: date(input.issued),
    due: date(input.due),
    symbol: symbol(input.symbol),
    amount: amountToMinor(input.total),
    currency: currency(input.currency),
  };
  required(invoice.issued <= invoice.due, 'Splatnost předchází vystavení dokladu.');
  return invoice;
}

export function emptyLedger() {
  return { version: 1, invoices: [], payments: [], matches: [], events: [] };
}

function event(ledger, data, at) {
  return { ...ledger, events: [{ at, ...data }, ...ledger.events] };
}

export function importInvoice(ledger, invoice, source, at = new Date().toISOString()) {
  const id = invoice.customerId + '/' + invoice.number;
  const signature = JSON.stringify(invoice);
  const present = ledger.invoices.find(record => record.id === id);
  if (present) {
    required(present.signature === signature, 'Doklad se stejným číslem a odběratelem už má jiné údaje. Původní záznam zůstal zachován.');
    return { ledger, id, added: false };
  }
  const record = { ...invoice, id, signature, source, reviewed: false };
  const next = event({ ...ledger, invoices: [record, ...ledger.invoices] },
    { kind: 'invoice', reference: invoice.number, detail: 'Import dokladu' }, at);
  return { ledger: next, id, added: true };
}

export function approveInvoice(ledger, id, values, at = new Date().toISOString()) {
  const invoice = ledger.invoices.find(record => record.id === id);
  required(invoice, 'Doklad už v přehledu není.');
  if (invoice.reviewed) return ledger;
  const reviewed = { ...invoice, amount: amountToMinor(values.total), currency: currency(values.currency), symbol: symbol(values.symbol), reviewed: true };
  const changed = ['amount', 'currency', 'symbol'].some(field => reviewed[field] !== invoice[field]);
  return event({ ...ledger, invoices: ledger.invoices.map(record => record.id === id ? reviewed : record) },
    { kind: 'review', reference: invoice.number, detail: changed ? 'Oprava a potvrzení údajů' : 'Potvrzení údajů' }, at);
}

function csvCells(line) {
  const cells = [...line.matchAll(/(?:^|;)("(?:[^"]|"")*"|[^;"]*)/gy)];
  required(cells.map(cell => cell[0]).join('') === line, 'Výpis obsahuje chybně zapsané buňky CSV.');
  return cells.map(([, raw]) => {
    return raw.startsWith('"') ? raw.slice(1, -1).replaceAll('""', '"') : raw;
  });
}

export function parseBankCsv(text) {
  const [header, ...rows] = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  required(header === bankHeader, 'Výpis musí mít sloupce z připravené šablony CSV.');
  required(rows.length > 0 && rows.length <= 200, 'Výpis musí obsahovat jeden až 200 pohybů.');
  return rows.map((row, index) => {
    try {
      const cells = csvCells(row);
      required(cells.length === 7, 'Řádek musí mít sedm sloupců.');
      const [transaction, posted, direction, reference, total, unit, party] = cells;
      required(direction === 'IN' || direction === 'OUT', 'Směr pohybu musí být IN nebo OUT.');
      return {
        id: identifier(transaction, paymentPattern, 'ID fiktivní transakce musí začínat TX-DEMO-.'),
        posted: date(posted),
        direction,
        symbol: symbol(reference, true),
        amount: amountToMinor(total),
        currency: currency(unit),
        party: label(party, 'protistrana'),
      };
    } catch (error) {
      throw new Error('Řádek ' + (index + 2) + '. ' + error.message);
    }
  });
}

export function importPayments(ledger, rows, at = new Date().toISOString()) {
  const existing = new Map(ledger.payments.map(payment => [payment.id, payment]));
  const added = [];
  let skipped = 0;
  for (const payment of rows) {
    const present = existing.get(payment.id);
    if (present) {
      required(JSON.stringify(present) === JSON.stringify(payment),
        'Pohyb ' + payment.id + ' má stejné ID a jiné údaje. Výpis nebyl importován.');
      skipped += 1;
      continue;
    }
    existing.set(payment.id, payment);
    added.push(payment);
  }
  const next = added.length ? event({ ...ledger, payments: [...added, ...ledger.payments] },
    { kind: 'bank', reference: 'Bankovní výpis', detail: 'Nové pohyby ' + added.length + ' · Přeskočené ' + skipped }, at) : ledger;
  return { ledger: next, added: added.length, skipped };
}

function exact(invoice, payment) {
  return payment.direction === 'IN' && payment.symbol === invoice.symbol && payment.amount === invoice.amount
    && payment.currency === invoice.currency && payment.posted >= invoice.issued;
}

export function invoiceStatus(ledger, invoice) {
  const linked = ledger.matches.find(match => match.invoiceId === invoice.id);
  if (linked) return { state: 'paid', payment: ledger.payments.find(payment => payment.id === linked.paymentId) };
  if (!invoice.reviewed) return { state: 'review' };
  const available = ledger.payments.filter(payment => !ledger.matches.some(match => match.paymentId === payment.id));
  const candidates = available.filter(payment => exact(invoice, payment));
  if (candidates.length > 1) return { state: 'ambiguous' };
  if (candidates.length === 1) {
    const payment = candidates[0];
    const competing = ledger.invoices.some(other => other.id !== invoice.id
      && !ledger.matches.some(match => match.invoiceId === other.id) && exact(other, payment));
    return competing ? { state: 'ambiguous' } : { state: 'ready', payment };
  }
  const related = available.filter(payment => payment.direction === 'IN' && payment.symbol === invoice.symbol);
  return { state: related.length ? 'mismatch' : 'waiting' };
}

export function matchInvoice(ledger, invoiceId, paymentId, at = new Date().toISOString()) {
  const invoice = ledger.invoices.find(record => record.id === invoiceId);
  required(invoice, 'Doklad už v přehledu není.');
  const status = invoiceStatus(ledger, invoice);
  if (status.state === 'paid' && status.payment.id === paymentId) return ledger;
  required(status.state === 'ready' && status.payment.id === paymentId, 'Platba už nesplňuje podmínky jednoznačného spárování.');
  return event({ ...ledger, matches: [...ledger.matches, { invoiceId, paymentId, at }] },
    { kind: 'match', reference: invoice.number, detail: 'Spárováno s ' + paymentId }, at);
}

export function unmatchInvoice(ledger, invoiceId, at = new Date().toISOString()) {
  const match = ledger.matches.find(record => record.invoiceId === invoiceId);
  if (!match) return ledger;
  const invoice = ledger.invoices.find(record => record.id === invoiceId);
  return event({ ...ledger, matches: ledger.matches.filter(record => record.invoiceId !== invoiceId) },
    { kind: 'unmatch', reference: invoice.number, detail: 'Rozpojeno s ' + match.paymentId }, at);
}
