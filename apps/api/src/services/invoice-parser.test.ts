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
assert.equal(fields.invoiceNumber, "123A/7788");
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

console.log("invoice-parser tests passed");
