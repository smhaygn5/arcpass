import assert from "node:assert/strict";
import test from "node:test";
import { MAX_BULK_INVOICES, parseBulkInvoiceDrafts } from "./bulk-invoices.ts";

test("parses valid bulk invoice rows", () => {
  const result = parseBulkInvoiceDrafts("Design delivery | 250.50 | usdc | 72\nMonthly support | 99 | EURC | 168");
  assert.equal(result.errors.length, 0);
  assert.equal(result.drafts.length, 2);
  assert.equal(result.drafts[0].token, "USDC");
  assert.equal(result.drafts[1].expiryHours, 168);
});

test("rejects invalid rows and caps a batch", () => {
  const invalid = parseBulkInvoiceDrafts("Missing fields | 10\nBad token | 5 | ETH | 24");
  assert.equal(invalid.drafts.length, 0);
  assert.equal(invalid.errors.length, 2);
  const tooMany = parseBulkInvoiceDrafts(Array.from({ length: MAX_BULK_INVOICES + 1 }, (_, index) => `Invoice ${index} | 1 | USDC | 24`).join("\n"));
  assert.match(tooMany.errors[0], /at most 10/);
});
