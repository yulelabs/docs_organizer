import type { InvoiceFields } from "@docs-organizer/shared";
import { emptyInvoiceFields } from "@docs-organizer/shared";

const MONTHS: Record<string, string> = {
  jan: "01",
  janeiro: "01",
  january: "01",
  fev: "02",
  fevereiro: "02",
  february: "02",
  mar: "03",
  marco: "03",
  março: "03",
  march: "03",
  abr: "04",
  abril: "04",
  april: "04",
  mai: "05",
  maio: "05",
  may: "05",
  jun: "06",
  junho: "06",
  june: "06",
  jul: "07",
  julho: "07",
  july: "07",
  ago: "08",
  agosto: "08",
  august: "08",
  set: "09",
  setembro: "09",
  september: "09",
  out: "10",
  outubro: "10",
  october: "10",
  nov: "11",
  novembro: "11",
  november: "11",
  dez: "12",
  dezembro: "12",
  december: "12",
};

const AMOUNT = String.raw`([0-9]{1,3}(?:[.\s][0-9]{3})*(?:,[0-9]{2})|[0-9]+(?:[.,][0-9]{2}))`;

function normalizeText(text: string): string {
  return text.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

function parseAmount(raw: string): number | null {
  const cleaned = raw
    .replace(/[^\d,.\-]/g, "")
    .replace(/\s/g, "")
    .trim();
  if (!cleaned) return null;

  // Portuguese: 1.234,56 / English: 1,234.56
  let normalized = cleaned;
  if (/,/.test(cleaned) && /\./.test(cleaned)) {
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (/,/.test(cleaned)) {
    normalized = cleaned.replace(",", ".");
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function toIsoDate(day: string, month: string, year: string): string | null {
  const y = year.length === 2 ? `20${year}` : year;
  const d = day.padStart(2, "0");
  const m = month.padStart(2, "0");
  const iso = `${y}-${m}-${d}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  return iso;
}

function extractDate(text: string): string | null {
  const patterns = [
    /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/,
    /\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/,
    /\b(\d{1,2})\s+de\s+([A-Za-zçÇãÃéÉôÔ]+)\s+de\s+(\d{4})\b/i,
    /\b(\d{1,2})\s+([A-Za-zçÇãÃéÉôÔ]+)\s+(\d{4})\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    if (pattern === patterns[1]) {
      return toIsoDate(match[3], match[2], match[1]);
    }

    if (pattern === patterns[2] || pattern === patterns[3]) {
      const monthKey = match[2]
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .slice(0, 3);
      const month = MONTHS[match[2].toLowerCase()] ?? MONTHS[monthKey];
      if (!month) continue;
      return toIsoDate(match[1], month, match[3]);
    }

    return toIsoDate(match[1], match[2], match[3]);
  }

  return null;
}

function extractVendor(lines: string[]): string | null {
  const skip =
    /^(fatura|factura|invoice|recibo|receipt|nota\s+de\s+cr[eé]dito|nif|vat|iva|total|data|date|morada|address|tel|telefone|email|www\.|http)/i;

  for (const line of lines.slice(0, 12)) {
    const cleaned = line.replace(/[^\p{L}\p{N}&.,\-/' ]/gu, "").trim();
    if (cleaned.length < 3 || cleaned.length > 80) continue;
    if (skip.test(cleaned)) continue;
    if (/^\d+$/.test(cleaned)) continue;
    return cleaned;
  }
  return null;
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function firstAmount(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const amount = parseAmount(match[1]);
    if (amount != null) return amount;
  }
  return null;
}

function guessCategory(text: string, vendor: string | null): string | null {
  const hay = `${vendor ?? ""} ${text}`.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/continente|pingo doce|lidl|aldi|minipre[cç]o|auchan|intermarch[eé]/, "Supermarket"],
    [/edp|galp|endesa|goldenergy|meo|nos|vodafone|agua|águas/, "Utilities"],
    [/farmacia|farmácia|hospit|clinica|clínica/, "Health"],
    [/uber|bolt|cp |comboios|tap |ryanair|easyjet/, "Transport"],
    [/amazon|fnac|worten|ikea|leroy/, "Shopping"],
    [/restaurante|cafe|café|pastelaria|mcdonald|burger/, "Dining"],
  ];
  for (const [re, category] of rules) {
    if (re.test(hay)) return category;
  }
  return "General";
}

function detectCurrency(text: string): string {
  if (/\$|USD|US\$/i.test(text)) return "USD";
  if (/£|GBP/i.test(text)) return "GBP";
  if (/R\$|BRL/i.test(text)) return "BRL";
  return "EUR";
}

/**
 * Document totals — prefer explicit Portuguese/English labels.
 * Amount may appear after the label (`Total a Creditar 30,00€`)
 * or before it (`30,00€ Total`).
 */
function extractTotal(text: string): number | null {
  const label =
    String.raw`total\s*(?:a\s*(?:pagar|creditar|créditar)|geral|liquido|líquido|com\s*iva)?|` +
    String.raw`amount\s*due|grand\s*total|valor\s*total`;

  const patterns = [
    // Total a Creditar 30,00€ / Total a pagar: EUR 43,05
    new RegExp(
      String.raw`\b(?:${label})\b\s*[:.]?\s*(?:EUR|€|USD|\$|£)?\s*${AMOUNT}\s*(?:€|EUR)?`,
      "i",
    ),
    // 30,00€ Total a Creditar
    new RegExp(
      String.raw`${AMOUNT}\s*(?:€|EUR)?\s*[:.]?\s*\b(?:${label})\b`,
      "i",
    ),
  ];

  return firstAmount(text, patterns);
}

function extractTax(text: string): number | null {
  const patterns = [
    // IVA Normal 23% 24,39€ 5,61€  → capture the tax amount after incidence
    new RegExp(
      String.raw`\b(?:iva|vat)\s*(?:normal|reduzido|interm[eé]dio)?\s*(?:\d+[.,]?\d*\s*%)?\s*${AMOUNT}\s*(?:€|EUR)?\s*${AMOUNT}\s*(?:€|EUR)?`,
      "i",
    ),
    // IVA Normal 5,61€ / IVA (23%): 8,05
    new RegExp(
      String.raw`\b(?:iva|vat|tax)\s*(?:normal|reduzido|interm[eé]dio)?\s*(?:\([^)]*\)|\d+[.,]?\d*\s*%)?\s*[:.]?\s*(?:EUR|€)?\s*${AMOUNT}\s*(?:€|EUR)?`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    // Prefer the last capture group when incidence + tax are both present
    const raw = match[2] ?? match[1];
    const amount = raw ? parseAmount(raw) : null;
    if (amount != null) return amount;
  }
  return null;
}

function extractSubtotal(text: string): number | null {
  return firstAmount(text, [
    new RegExp(
      String.raw`\b(?:subtotal|sub-total|total\s*il[ií]q\.?|valor\s*il[ií]quido|net(?:\s*amount)?|base)\b\s*[:.]?\s*(?:EUR|€)?\s*${AMOUNT}\s*(?:€|EUR)?`,
      "i",
    ),
  ]);
}

export function parseInvoiceText(rawText: string): InvoiceFields {
  const text = normalizeText(rawText);
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const fields = emptyInvoiceFields();
  fields.vendor = extractVendor(lines);
  fields.invoiceDate = extractDate(text);
  fields.currency = detectCurrency(text);
  fields.category = guessCategory(text, fields.vendor);

  fields.invoiceNumber = firstMatch(text, [
    /(?:nota\s+de\s+cr[eé]dito|fatura|factura|invoice|recibo|receipt)\s*(?:n[ºo°.]?|no\.?|number|#)?\s*[:.]?\s*((?:NC|FT|FR|FS)[\s\/\-]?[A-Z0-9][A-Z0-9\-\/]*)/i,
    /\b((?:NC|FT|FR|FS)[\s\/\-][A-Z0-9][A-Z0-9\-\/]*)\b/i,
    /(?:fatura|factura|invoice|recibo|receipt)\s*(?:n[ºo°.]?|no\.?|number|#)?\s*[:.]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i,
  ]);

  fields.nif = firstMatch(text, [
    /(?:nif|nipc|contribuinte|vat|tax\s*id)\s*[:.]?\s*([A-Z]{0,2}\d{8,12})/i,
  ]);

  fields.dueDate = (() => {
    const dueSection = text.match(
      /(?:vencimento|due\s*date|data\s*limite)[^\n]{0,40}/i,
    );
    return dueSection ? extractDate(dueSection[0]) : null;
  })();

  fields.total = extractTotal(text);
  fields.tax = extractTax(text);
  fields.subtotal = extractSubtotal(text);

  // If total missing but we have subtotal + tax, derive it
  if (fields.total == null && fields.subtotal != null && fields.tax != null) {
    fields.total = Number((fields.subtotal + fields.tax).toFixed(2));
  }

  return fields;
}

export function buildOrganizedName(
  fields: InvoiceFields,
  originalName: string,
): { organizedName: string; organizedPath: string } {
  const ext = pathExt(originalName);
  const date = fields.invoiceDate ?? "unknown-date";
  const vendor = slugify(fields.vendor ?? "unknown-vendor");
  const total =
    fields.total != null
      ? `${fields.currency ?? "EUR"}${fields.total.toFixed(2)}`
      : "amount-unknown";

  const organizedName = `${date}_${vendor}_${total}${ext}`;
  const year = fields.invoiceDate?.slice(0, 4) ?? "unknown-year";
  const month = fields.invoiceDate?.slice(5, 7) ?? "00";
  const category = slugify(fields.category ?? "general");
  const organizedPath = `${year}/${month}/${category}/${organizedName}`;

  return { organizedName, organizedPath };
}

function pathExt(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx === -1) return "";
  return name.slice(idx).toLowerCase();
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase() || "item";
}
