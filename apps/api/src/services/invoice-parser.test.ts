// Unit tests for invoice field parsing (no OCR binaries required)
import assert from "node:assert/strict";
import { buildOrganizedName, parseInvoiceText } from "../services/invoice-parser.js";

const sample = `
CONTINENTE MODELO
Continente Bom Dia
NIF: 501532554
Fatura FS 123A/7788
Data: 15/03/2024
Subtotal: 35,00
IVA (23%): 8,05
Total a pagar: EUR 43,05
`;

const fields = parseInvoiceText(sample);
assert.equal(fields.vendor, "CONTINENTE MODELO");
assert.equal(fields.invoiceDate, "2024-03-15");
assert.match(fields.invoiceNumber ?? "", /123A\/7788/);
assert.equal(fields.nif, "501532554");
assert.equal(fields.currency, "EUR");
assert.equal(fields.total, 43.05);
assert.equal(fields.tax, 8.05);
assert.equal(fields.category, "Supermarket");

const organized = buildOrganizedName(fields, "scan.pdf");
assert.equal(
  organized.organizedName,
  "2024-03-15_continente-modelo_EUR43.05.pdf",
);
assert.equal(
  organized.organizedPath,
  "2024/03/supermarket/2024-03-15_continente-modelo_EUR43.05.pdf",
);

// Credit note: IVA amount must not be mistaken for document total
const creditNote = `
asmoarttire
Loja Online
Nota de Crédito N.2 NC M/218
Data de Emissao: 20-07-2026
Contribuinte: 513674683
VISITA-CENTRO Visita Técnica 1 Uni. 24,39€ 23% 24,39€
Total Iliq. 24,39€
Resumo de Impostos
é . IVA Normal 5,61€
Designacao Valor Incidência Total
IVA Normal 23% 24,39€ 5,61€ Total a Creditar 30,00€
`;

const creditFields = parseInvoiceText(creditNote);
assert.equal(creditFields.total, 30);
assert.equal(creditFields.tax, 5.61);
assert.equal(creditFields.subtotal, 24.39);
assert.equal(creditFields.invoiceDate, "2026-07-20");
assert.match(creditFields.invoiceNumber ?? "", /NC\s*M\/218/i);

console.log("invoice-parser tests passed");
