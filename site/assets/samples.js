import { approveInvoice, bankHeader, emptyLedger, importInvoice, importPayments, normalizeInvoice, parseBankCsv } from './ledger.js';

export const samples = [
  { file: 'montaz.pdf', number: 'FV-DEMO-2401', customerId: 'DEMO-VODOR', customer: 'Vodor Montaz',
    issued: '2026-11-02', due: '2026-11-16', symbol: '2401', total: '12500.00', currency: 'CZK', description: 'Servis a montaz' },
  { file: 'vyroba.pdf', number: 'FV-DEMO-2402', customerId: 'DEMO-NORDA', customer: 'Norda Studio',
    issued: '2026-11-04', due: '2026-11-18', symbol: '2402', total: '8450.50', currency: 'CZK', description: 'Vyroba zakazkoveho vybaveni' },
  { file: 'servis.pdf', number: 'FV-DEMO-2403', customerId: 'DEMO-LUMEN', customer: 'Lumen Servis',
    issued: '2026-11-06', due: '2026-11-20', symbol: '2403', total: '3990.00', currency: 'CZK', description: 'Pravidelny servis' },
  { file: 'licence-eur.pdf', number: 'FV-DEMO-2404', customerId: 'DEMO-KOTA', customer: 'Kota Labs',
    issued: '2026-11-08', due: '2026-11-22', symbol: '2404', total: '480.00', currency: 'EUR', description: 'Licencni poplatek' },
];

const openingBank = [
  'TX-DEMO-015;2026-11-11;IN;002401;12500.00;CZK;Vodor Montaz',
  'TX-DEMO-016;2026-11-12;IN;2402;8450.00;CZK;Norda Studio',
  'TX-DEMO-017;2026-11-13;IN;2403;3990.00;CZK;Lumen Servis',
];

export const statement = [bankHeader, ...openingBank,
  'TX-DEMO-018;2026-11-15;IN;2404;480.00;EUR;Kota Labs',
  'TX-DEMO-019;2026-11-15;IN;;2190.00;CZK;Mostik Dily',
  'TX-DEMO-020;2026-11-16;OUT;2404;480.00;EUR;Ukazkovy pohyb', ''].join('\n');

export function seedLedger() {
  let ledger = emptyLedger();
  const stamp = '2026-11-17T08:00:00Z';
  for (const [index, sample] of samples.slice(0, 3).entries()) {
    const { ledger: imported, id } = importInvoice(ledger, normalizeInvoice(sample), { file: sample.file }, stamp);
    ledger = index < 2 ? approveInvoice(imported, id, sample, stamp) : imported;
  }
  return importPayments(ledger, parseBankCsv([bankHeader, ...openingBank].join('\n')), stamp).ledger;
}

export function invoiceLines(sample) {
  return [
    'FIKTIVNI DOKLAD / SAMPLE INVOICE',
    'Invoice: ' + sample.number,
    'Customer ID: ' + sample.customerId,
    'Customer: ' + sample.customer,
    'Issued: ' + sample.issued,
    'Due: ' + sample.due,
    'Reference: ' + sample.symbol,
    'Total: ' + sample.total,
    'Currency: ' + sample.currency,
  ];
}
