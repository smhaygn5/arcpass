export function paymentQrFilename(invoiceId: string) {
  const normalized = invoiceId.replace(/[^a-z0-9_-]/gi, "-").slice(0, 80);
  return `arcpass-${normalized || "invoice"}-payment-qr.png`;
}
