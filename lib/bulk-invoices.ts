import type { ArcPassTokenSymbol } from "./arcpass.ts";

export type BulkInvoiceDraft = {
  amount: string;
  description: string;
  expiryHours: number;
  row: number;
  token: ArcPassTokenSymbol;
};

export type BulkInvoiceParseResult = {
  drafts: BulkInvoiceDraft[];
  errors: string[];
};

export const MAX_BULK_INVOICES = 10;

export function parseBulkInvoiceDrafts(value: string): BulkInvoiceParseResult {
  const rows = value.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  const drafts: BulkInvoiceDraft[] = [];
  const errors: string[] = [];
  if (rows.length > MAX_BULK_INVOICES) errors.push(`A batch can contain at most ${MAX_BULK_INVOICES} invoices.`);

  for (const [index, line] of rows.slice(0, MAX_BULK_INVOICES).entries()) {
    const row = index + 1;
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length !== 4) {
      errors.push(`Row ${row}: use Description | Amount | Token | Expiry hours.`);
      continue;
    }
    const [description, amount, tokenInput, expiryInput] = parts;
    const token = tokenInput.toUpperCase();
    const expiryHours = Number(expiryInput);
    if (!description || description.length > 280) errors.push(`Row ${row}: description must be between 1 and 280 characters.`);
    if (!/^\d+(?:\.\d{1,6})?$/.test(amount) || Number(amount) <= 0) errors.push(`Row ${row}: amount must be a positive number with up to 6 decimals.`);
    if (token !== "USDC" && token !== "EURC") errors.push(`Row ${row}: token must be USDC or EURC.`);
    if (!Number.isInteger(expiryHours) || expiryHours < 1 || expiryHours > 720) errors.push(`Row ${row}: expiry must be between 1 and 720 whole hours.`);
    if (errors.some((error) => error.startsWith(`Row ${row}:`))) continue;
    drafts.push({ amount, description, expiryHours, row, token: token as ArcPassTokenSymbol });
  }

  return { drafts, errors };
}
