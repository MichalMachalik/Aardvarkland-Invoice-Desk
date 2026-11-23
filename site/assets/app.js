import { approveInvoice, importInvoice, importPayments, invoiceStatus, matchInvoice, parseBankCsv, unmatchInvoice } from './ledger.js';
import { invoiceLines, samples, seedLedger } from './samples.js';
import { readInvoicePdf } from './pdf-reader.js';

const key = 'invoice-desk:v1';
const view = document.querySelector('#view');
const dialog = document.querySelector('#dialog');
const notice = document.querySelector('#notice');
const routes = { prehled: 'Přehled', doklady: 'Doklady', platby: 'Platby', historie: 'Historie' };
const states = {
  review: 'Ke kontrole', ready: 'Připraveno ke spárování', mismatch: 'Neshoda',
  ambiguous: 'Více možných shod', waiting: 'Čeká na platbu', paid: 'Spárováno',
};
const fullDate = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' });
const shortDate = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeZone: 'UTC' });
const icons = name => '<svg class="icon" aria-hidden="true"><use href="#' + name + '"/></svg>';
const escaped = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const money = (amount, currency) => new Intl.NumberFormat('cs-CZ', {
  style: 'currency', currency, minimumFractionDigits: amount % 100 ? 2 : 0,
}).format(amount / 100);
const date = value => shortDate.format(new Date(value + 'T00:00:00Z'));
const results = { query: '', status: '' };
let current = read();
let noticeTimer;

function read() {
  try {
    const data = JSON.parse(localStorage.getItem(key));
    if (data?.version === 1 && ['invoices', 'payments', 'matches', 'events'].every(field => Array.isArray(data[field]))) return data;
  } catch {
    // The application can still display its starting data when storage is unavailable.
  }
  return seedLedger();
}

async function commit(update) {
  const save = () => {
    const result = update(read());
    try {
      localStorage.setItem(key, JSON.stringify(result.ledger));
    } catch {
      throw new Error('Prohlížeč nepovolil uložení změny. Zkontrolujte nastavení úložiště.');
    }
    current = result.ledger;
    render();
    return result;
  };
  return navigator.locks ? navigator.locks.request(key, save) : save();
}

function say(message) {
  notice.textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.textContent = ''; }, 5500);
}

function button(action, label, { icon, primary = false, data, payment } = {}) {
  return '<button type="button" class="button' + (primary ? ' primary' : '') + '" data-action="' + action + '"'
    + (data ? ' data-id="' + escaped(data) + '"' : '')
    + (payment ? ' data-payment="' + escaped(payment) + '"' : '') + '>' + (icon ? icons(icon) : '') + escaped(label) + '</button>';
}

function page(heading, subheading, actions = '') {
  return '<header class="page-heading"><div><h1>' + heading + '</h1><p class="intro">' + subheading + '</p></div>'
    + (actions ? '<div class="actions">' + actions + '</div>' : '') + '</header>';
}

function pill(status) {
  return '<span class="pill ' + status + '">' + states[status] + '</span>';
}

function table(headers, rows, message) {
  return '<div class="table-card"><table><thead><tr>' + headers.map(item => '<th scope="col">' + item + '</th>').join('')
    + '</tr></thead><tbody>' + (rows || '<tr><td colspan="' + headers.length + '" class="empty">' + message + '</td></tr>') + '</tbody></table></div>';
}

function invoiceTable(invoices) {
  const rows = invoices.map(invoice => '<tr><td><button class="doc-button" data-action="detail" data-id="' + escaped(invoice.id) + '">'
    + escaped(invoice.number) + '</button><small>' + escaped(invoice.customer) + '</small></td>'
    + '<td class="mobile-hide numeric">' + invoice.symbol + '</td><td class="numeric mobile-right">' + money(invoice.amount, invoice.currency) + '</td>'
    + '<td class="mobile-hide">' + date(invoice.due) + '</td><td>' + pill(invoiceStatus(current, invoice).state) + '</td></tr>').join('');
  return table(['Doklad', 'Variabilní symbol', 'Částka', 'Splatnost', 'Stav'], rows, 'Žádné odpovídající doklady.');
}

function renderDocs() {
  const query = results.query.trim().toLocaleLowerCase('cs');
  const list = current.invoices.filter(invoice => [invoice.number, invoice.customer, invoice.symbol]
    .some(value => value.toLocaleLowerCase('cs').includes(query))
    && (!results.status || invoiceStatus(current, invoice).state === results.status));
  document.querySelector('#invoice-list').innerHTML = invoiceTable(list);
}

function render() {
  const candidate = location.hash.slice(1);
  const route = Object.hasOwn(routes, candidate) ? candidate : 'prehled';
  document.querySelector('#section-label').textContent = routes[route];
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const pdf = button('pdf', 'Importovat PDF', { icon: 'upload', primary: true });
  const bank = button('bank', 'Importovat výpis', { icon: 'upload', primary: route === 'platby' });
  if (route === 'doklady') {
    view.innerHTML = page('Doklady', 'Údaje z PDF a stav jejich úhrady.', pdf)
      + '<div class="filters"><label class="search">' + icons('search')
      + '<input type="search" id="invoice-query" aria-label="Hledat doklady" placeholder="Číslo, odběratel nebo symbol" value="' + escaped(results.query) + '"></label>'
      + '<select aria-label="Stav dokladu" id="invoice-status"><option value="">Všechny stavy</option>'
      + Object.entries(states).map(([value, label]) => '<option value="' + value + '"' + (results.status === value ? ' selected' : '') + '>' + label + '</option>').join('')
      + '</select></div><div id="invoice-list"></div>';
    renderDocs();
    return;
  }
  if (route === 'platby') {
    const rows = current.payments.map(payment => {
      const match = current.matches.find(record => record.paymentId === payment.id);
      return '<tr><td><strong>' + escaped(payment.id) + '</strong><small>' + escaped(payment.party) + '</small></td>'
        + '<td class="numeric mobile-right">' + (payment.direction === 'OUT' ? '−' : '+') + money(payment.amount, payment.currency) + '</td>'
        + '<td class="mobile-hide">' + date(payment.posted) + '</td><td class="mobile-hide">' + (payment.symbol || '—') + '</td><td>'
        + (match ? pill('paid') : '<span class="pill">' + (payment.direction === 'IN' ? 'Příchozí' : 'Odchozí') + '</span>') + '</td></tr>';
    }).join('');
    view.innerHTML = page('Platby', 'Pohyby z bankovních výpisů a jejich vazba na doklady.', bank)
      + table(['Pohyb', 'Částka', 'Zaúčtováno', 'Variabilní symbol', 'Stav'], rows, 'Zatím žádné bankovní pohyby.');
    return;
  }
  if (route === 'historie') {
    const rows = current.events.map(entry => '<tr><td>' + fullDate.format(new Date(entry.at)) + '</td><td><strong>'
      + escaped(entry.reference) + '</strong><small>' + escaped(entry.detail) + '</small></td></tr>').join('');
    view.innerHTML = page('Historie', 'Importy, kontrola dokladů a změny párování.', button('reset', 'Obnovit ukázková data'))
      + table(['Datum a čas', 'Událost'], rows, 'Zatím žádné změny.');
    return;
  }
  const counts = [current.invoices.length, current.invoices.filter(item => invoiceStatus(current, item).state === 'ready').length, current.matches.length];
  const cards = [['Doklady', ''], ['Připraveno ke spárování', 'ready'], ['Spárováno', 'paid']];
  view.innerHTML = page('Přehled dokladů', 'Importujte doklady a ověřte jejich úhradu.', pdf + bank)
    + '<div class="metrics">' + cards.map(([label, status], index) => '<a class="metric" href="#doklady" data-status="'
      + status + '"><span>' + label + '</span><strong>' + counts[index] + '</strong></a>').join('') + '</div>'
    + '<div class="section-heading"><h2>Poslední doklady</h2><a href="#doklady" data-status="">Všechny doklady</a></div>'
    + invoiceTable(current.invoices.slice(0, 6));
}

function show(title, subtitle, content) {
  dialog.innerHTML = '<div class="dialog-inner"><header class="dialog-head"><div><h2 id="dialog-title">' + escaped(title)
    + '</h2>' + (subtitle ? '<p class="muted">' + escaped(subtitle) + '</p>' : '')
    + '</div><button type="button" class="button icon-button" data-action="close" aria-label="Zavřít">' + icons('close')
    + '</button></header><div class="dialog-body">' + content
    + '</div><p class="error" role="alert" id="dialog-error" hidden></p></div>';
  if (dialog.open) dialog.querySelector('[data-action="close"]').focus();
  else dialog.showModal();
}

function uploadForm(kind, caption, accept) {
  return '<form data-form="' + kind + '"><label class="field">' + caption + '<input type="file" name="file" accept="' + accept
    + '" required></label><div class="dialog-actions"><button type="submit" class="button primary">Importovat soubor</button></div></form>';
}

function showPdf() {
  const sample = samples[3];
  show('Import PDF', 'Vyberte ukázkový doklad nebo nahrajte PDF ve stejném formátu.',
    '<div class="sample"><div><strong>' + sample.number + '</strong><small>' + sample.customer + ' · 480 EUR</small></div>'
    + button('sample-pdf', 'Načíst doklad', { data: sample.file }) + '</div>'
    + '<a class="dialog-copy" href="./fixtures/' + sample.file + '" download>Stáhnout ukázkové PDF</a>'
    + uploadForm('pdf', 'Soubor PDF', '.pdf,application/pdf'));
}

function showBank() {
  show('Import výpisu', 'Opakované načtení stejného pohybu nevytvoří další záznam.',
    '<div class="sample"><div><strong>Bankovní výpis</strong><small>6 pohybů · CZK a EUR</small></div>'
    + button('sample-bank', 'Načíst výpis') + '</div><a class="dialog-copy" href="./fixtures/vypis.csv" download>Stáhnout šablonu CSV</a>'
    + uploadForm('bank', 'Soubor CSV', '.csv,text/csv'));
}

function detail(id) {
  const invoice = current.invoices.find(record => record.id === id);
  if (!invoice) throw new Error('Doklad už v přehledu není.');
  const status = invoiceStatus(current, invoice);
  const related = current.payments.filter(payment => payment.direction === 'IN' && payment.symbol === invoice.symbol);
  let candidate = '';
  if (status.payment) {
    const payment = status.payment;
    candidate = '<div class="candidate"><h3>' + (status.state === 'paid' ? 'Spárovaná platba' : 'Nalezená platba') + '</h3><p>'
      + escaped(payment.id) + ' · ' + date(payment.posted) + ' · ' + money(payment.amount, payment.currency) + '</p><div class="actions">'
      + (status.state === 'paid' ? button('unmatch', 'Rozpojit', { data: id, payment: payment.id })
        : button('match', 'Spárovat platbu', { data: id, payment: payment.id, primary: true, icon: 'link' })) + '</div></div>';
  } else if (status.state === 'mismatch' || status.state === 'ambiguous') {
    const explanation = status.state === 'mismatch' ? 'Příchozí platba se stejným symbolem nesouhlasí částkou, měnou nebo datem.'
      : 'Pohybu odpovídá více dokladů nebo dokladu více plateb. Párování vyžaduje jednoznačnou shodu.';
    candidate = '<div class="candidate"><p>' + explanation + '</p>' + related.map(payment => '<p>' + escaped(payment.id) + ' · '
      + date(payment.posted) + ' · ' + money(payment.amount, payment.currency) + '</p>').join('') + '</div>';
  }
  const sample = samples.find(entry => entry.file === invoice.source.file);
  const source = invoice.source.text ?? (sample ? invoiceLines(sample).join('\n') : '');
  const locked = invoice.reviewed ? ' disabled' : '';
  show(invoice.number, invoice.customer + ' · Vystaveno ' + date(invoice.issued) + ' · Splatnost ' + date(invoice.due),
    '<div>' + pill(status.state) + '</div><form data-form="review" data-id="' + escaped(id) + '"><div class="inputs">'
    + '<label class="field">Variabilní symbol<input name="symbol" inputmode="numeric" maxlength="10" value="' + invoice.symbol + '" required' + locked + '></label>'
    + '<label class="field">Částka<input name="total" inputmode="decimal" maxlength="15" value="' + (invoice.amount / 100).toFixed(2) + '" required' + locked + '></label>'
    + '<label class="field">Měna<select name="currency"' + locked + '>' + ['CZK', 'EUR'].map(unit => '<option'
      + (invoice.currency === unit ? ' selected' : '') + '>' + unit + '</option>').join('') + '</select></label></div>'
    + (invoice.reviewed ? '' : '<div class="dialog-actions"><button class="button primary" type="submit">Potvrdit údaje</button></div>')
    + '</form>' + candidate + (source ? '<details><summary>Text z PDF</summary><pre>' + escaped(source) + '</pre></details>' : '')
    + (sample ? '<a class="dialog-copy" href="./fixtures/' + sample.file + '" target="_blank" rel="noopener">Otevřít původní PDF</a>' : ''));
}

async function sampleResponse(filename) {
  const response = await fetch('./fixtures/' + filename);
  if (!response.ok) throw new Error('Soubor ukázky se nepodařilo načíst.');
  return response;
}

async function loadPdf(bytes, file) {
  const { invoice, text } = await readInvoicePdf(bytes);
  const result = await commit(ledger => importInvoice(ledger, invoice, { file, text }));
  detail(result.id);
  say(result.added ? 'Doklad je uložený a čeká na kontrolu.' : 'Doklad už je uložený. Další záznam nevznikl.');
}

async function loadBank(text) {
  const rows = parseBankCsv(text);
  const result = await commit(ledger => importPayments(ledger, rows));
  const message = 'Nové pohyby: ' + result.added + ' · Přeskočené: ' + result.skipped;
  show('Výsledek importu výpisu', '', '<p class="dialog-copy">' + message + '</p><div class="actions">'
    + button('bank', 'Importovat další výpis') + '<a class="button primary" href="#platby" data-action="close">Zobrazit platby</a></div>');
  say(message);
}

async function perform(control, task) {
  const controls = [...dialog.querySelectorAll('button, input, select')].filter(item => !item.disabled && item.dataset.action !== 'close');
  controls.forEach(item => { item.disabled = true; });
  if (control) control.disabled = true;
  try {
    await task();
  } catch (error) {
    const target = dialog.querySelector('#dialog-error');
    if (target && dialog.open) {
      target.hidden = false;
      target.textContent = error.message;
    } else say(error.message);
  } finally {
    controls.forEach(item => { item.disabled = false; });
    if (control) control.disabled = false;
  }
}

document.addEventListener('click', event => {
  const filter = event.target.closest('[data-status]');
  if (filter) {
    results.query = '';
    results.status = filter.dataset.status;
  }
  const control = event.target.closest('[data-action],#reset');
  if (!control) return;
  const { action = 'reset', id, payment } = control.dataset;
  if (action === 'pdf') showPdf();
  if (action === 'bank') showBank();
  if (action === 'detail') detail(id);
  if (action === 'close') dialog.close();
  if (action === 'reset') show('Obnovit ukázková data?', 'Importované soubory, párování a historie v tomto prohlížeči se vymažou.',
    '<div class="dialog-actions">' + button('close', 'Zpět') + button('reset-confirm', 'Obnovit data', { primary: true }) + '</div>');
  if (action === 'reset-confirm') void perform(control, async () => {
    await commit(() => ({ ledger: seedLedger() }));
    dialog.close();
    say('Ukázková data obnovena.');
  });
  if (action === 'sample-pdf') void perform(control, async () => {
    const response = await sampleResponse(id);
    await loadPdf(new Uint8Array(await response.arrayBuffer()), id);
  });
  if (action === 'sample-bank') void perform(control, async () => loadBank(await (await sampleResponse('vypis.csv')).text()));
  if (action === 'match' || action === 'unmatch') void perform(control, async () => {
    await commit(ledger => {
      if (action === 'match') return { ledger: matchInvoice(ledger, id, payment) };
      const link = ledger.matches.find(match => match.invoiceId === id);
      if (link && link.paymentId !== payment) throw new Error('Doklad má jinou spárovanou platbu. Otevřete detail znovu.');
      return { ledger: unmatchInvoice(ledger, id) };
    });
    detail(id);
    say(action === 'match' ? 'Doklad a platba byly spárovány.' : 'Doklad a platba byly rozpojeny.');
  });
});

dialog.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const { form: kind, id } = form.dataset;
  void perform(event.submitter, async () => {
    if (kind === 'review') {
      await commit(ledger => ({ ledger: approveInvoice(ledger, id, Object.fromEntries(data)) }));
      detail(id);
      say('Údaje byly potvrzeny.');
      return;
    }
    const file = data.get('file');
    if (!file?.size) throw new Error('Vyberte soubor k importu.');
    if (kind === 'pdf') await loadPdf(new Uint8Array(await file.arrayBuffer()), null);
    else {
      if (file.size > 200_000) throw new Error('Bankovní výpis musí mít nejvýše 200 kB.');
      await loadBank(await file.text());
    }
  });
});

view.addEventListener('input', event => {
  if (event.target.id === 'invoice-query') {
    results.query = event.target.value;
    renderDocs();
  }
  if (event.target.id === 'invoice-status') {
    results.status = event.target.value;
    renderDocs();
  }
});

window.addEventListener('hashchange', render);
window.addEventListener('storage', event => {
  if (event.key !== key) return;
  current = read();
  render();
});
render();
