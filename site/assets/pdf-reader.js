import { parseInvoiceText } from './ledger.js';

export async function readInvoicePdf(bytes) {
  if (bytes.byteLength > 2_000_000) throw new Error('PDF musí mít nejvýše 2 MB.');
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('Soubor není PDF.');
  const { GlobalWorkerOptions, getDocument } = await import('./vendor/pdf.min.mjs');
  GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
  const task = getDocument({ data: bytes, isEvalSupported: false, enableXfa: false, useSystemFonts: false, stopAtErrors: true });
  try {
    const pdf = await task.promise;
    if (pdf.numPages !== 1) throw new Error('Ukázkový doklad musí mít jednu stranu.');
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const lines = [];
    let row = '';
    for (const item of content.items) {
      if ('str' in item) row += item.str;
      if (item.hasEOL) {
        lines.push(row);
        row = '';
      }
    }
    if (row) lines.push(row);
    const text = lines.join('\n');
    return { invoice: parseInvoiceText(text), text };
  } finally {
    await task.destroy();
  }
}
