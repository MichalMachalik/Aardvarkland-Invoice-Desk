# Aardvarkland Invoice Desk

[Česky](#česky) · [Open preview](https://michalmachalik.github.io/Aardvarkland-Invoice-Desk/)

Review invoice fields extracted from a sample PDF, import a bank statement and confirm a payment match. The preview uses fictional records and stores changes in the current browser.

1. Import the **FV-DEMO-2404** PDF and confirm its amount, currency and reference.
2. Import the sample statement. The first import adds three movements and skips three existing ones. A repeat import skips all six.
3. Open the invoice and confirm the exact incoming EUR payment. **FV-DEMO-2402** shows a CZK amount mismatch.

```sh
npm ci --ignore-scripts
npm test
npm run build
npm start
```

Open http://127.0.0.1:4179/. Node.js 24 builds a static site, including the sample files and self-hosted PDF.js. Matching uses integer minor units. A payment must be inbound, unassigned and posted on or after the issue date, with the same reference, amount and currency. Ambiguous candidates are left for review. The PDF importer expects the included single-page layout with a text layer. Clearing browser storage or resetting sample data restores the starting state.

Apache-2.0. Third-party notices are included next to the corresponding assets.

## Česky

[Otevřít ukázku](https://michalmachalik.github.io/Aardvarkland-Invoice-Desk/)

Zkontrolujte údaje načtené z PDF, importujte bankovní výpis a potvrďte spárování platby. Ukázka pracuje s fiktivními daty a změny ukládá v aktuálním prohlížeči.

1. Načtěte PDF **FV-DEMO-2404** a potvrďte částku, měnu a variabilní symbol.
2. Načtěte ukázkový výpis. Při prvním importu přibudou tři nové pohyby. Opakovaný import přeskočí všech šest.
3. Otevřete doklad a spárujte přesnou příchozí platbu v EUR. U dokladu **FV-DEMO-2402** si můžete prohlédnout neshodu v částce.

Lokální spuštění vyžaduje Node.js 24 a příkazy z anglické části. Platba musí být příchozí a dosud nepřiřazená, se shodným symbolem, měnou a částkou a datem od vystavení dokladu. Nejednoznačné shody zůstávají ke kontrole. Import PDF očekává přiložený jednostránkový formát s textovou vrstvou.
