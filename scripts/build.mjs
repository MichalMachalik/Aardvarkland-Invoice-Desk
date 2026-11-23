import { copyFile, cp, mkdir, writeFile } from 'node:fs/promises';
import { invoiceLines, samples, statement } from '../site/assets/samples.js';

const dist = new URL('../dist/', import.meta.url);
const fixtures = new URL('fixtures/', dist);
const vendor = new URL('assets/vendor/', dist);
await cp(new URL('../site/', import.meta.url), dist, { recursive: true });
await mkdir(fixtures, { recursive: true });
await mkdir(vendor, { recursive: true });
for (const file of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  await copyFile(new URL('../node_modules/pdfjs-dist/build/' + file, import.meta.url), new URL(file, vendor));
}
await copyFile(new URL('../node_modules/pdfjs-dist/LICENSE', import.meta.url), new URL('LICENSE.pdfjs.txt', vendor));

function pdfText(x, y, size, text) {
  const value = text.replace(/[\\()]/g, '\\$&');
  return 'BT /F1 ' + size + ' Tf 1 0 0 1 ' + x + ' ' + y + ' Tm (' + value + ') Tj ET\n';
}

function makeInvoice(sample) {
  const lines = invoiceLines(sample);
  let stream = '0.94 0.95 0.97 rg 49 697 497 81 re f\n0.09 0.11 0.15 rg\n';
  stream += pdfText(62, 751, 23, 'INVOICE');
  stream += pdfText(62, 723, 11, lines[0]);
  for (let i = 1; i < lines.length; i += 1) stream += pdfText(62, 708 - i * 32, 13, lines[i]);
  stream += '0.94 0.95 0.97 rg 49 330 497 61 re f\n0.09 0.11 0.15 rg\n';
  stream += pdfText(62, 365, 14, sample.description);
  stream += pdfText(62, 341, 10, 'One synthetic line item');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + 'endstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = ['0000000000 65535 f \n'];
  objects.forEach((object, i) => {
    offsets.push(String(Buffer.byteLength(pdf)).padStart(10, '0') + ' 00000 n \n');
    pdf += (i + 1) + ' 0 obj\n' + object + '\nendobj\n';
  });
  const xref = Buffer.byteLength(pdf);
  pdf += 'xref\n0 ' + offsets.length + '\n' + offsets.join('');
  return pdf + 'trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
}

for (const sample of samples) await writeFile(new URL(sample.file, fixtures), makeInvoice(sample), 'ascii');
await writeFile(new URL('vypis.csv', fixtures), statement);
