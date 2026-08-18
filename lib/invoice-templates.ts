import type { ArcPassTokenSymbol } from "./arcpass.ts";

export const INVOICE_TEMPLATES_STORAGE_KEY = "arcpass.invoice-templates.v1";

export type InvoiceTemplate = {
  amount: string;
  description: string;
  expiresInHours: number;
  id: string;
  isBuiltIn?: boolean;
  label: string;
  token: ArcPassTokenSymbol;
};

export const BUILT_IN_INVOICE_TEMPLATES: InvoiceTemplate[] = [
  { id: "consulting-session", label: "Consulting session", description: "Strategy and consulting session", amount: "150.00", token: "USDC", expiresInHours: 72, isBuiltIn: true },
  { id: "digital-delivery", label: "Digital delivery", description: "Final digital delivery", amount: "500.00", token: "USDC", expiresInHours: 168, isBuiltIn: true },
  { id: "eurc-renewal", label: "EURC renewal", description: "Monthly service renewal", amount: "99.00", token: "EURC", expiresInHours: 72, isBuiltIn: true },
];

export function loadInvoiceTemplates(): InvoiceTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = JSON.parse(window.localStorage.getItem(INVOICE_TEMPLATES_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(stored) ? stored.filter(isInvoiceTemplate).slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function saveInvoiceTemplate(template: Omit<InvoiceTemplate, "id">): InvoiceTemplate[] {
  const normalized = normalizeInvoiceTemplate({ ...template, id: crypto.randomUUID() });
  if (!normalized) throw new Error("Invoice template is invalid.");
  const next = [normalized, ...loadInvoiceTemplates()].slice(0, 20);
  window.localStorage.setItem(INVOICE_TEMPLATES_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function removeInvoiceTemplate(id: string): InvoiceTemplate[] {
  const next = loadInvoiceTemplates().filter((template) => template.id !== id);
  window.localStorage.setItem(INVOICE_TEMPLATES_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function expiryInputFromHours(hours: number, now = new Date()) {
  const date = new Date(now.getTime() + hours * 60 * 60 * 1_000);
  const offsetMs = date.getTimezoneOffset() * 60 * 1_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function isInvoiceTemplate(value: unknown): value is InvoiceTemplate {
  return Boolean(normalizeInvoiceTemplate(value));
}

function normalizeInvoiceTemplate(value: unknown): InvoiceTemplate | null {
  if (!value || typeof value !== "object") return null;
  const template = value as Partial<InvoiceTemplate>;
  if (typeof template.id !== "string" || !template.id || template.id.length > 100) return null;
  if (typeof template.label !== "string" || !template.label.trim() || template.label.length > 60) return null;
  if (typeof template.description !== "string" || !template.description.trim() || template.description.length > 280) return null;
  if (typeof template.amount !== "string" || !template.amount.trim() || template.amount.length > 64) return null;
  if (template.token !== "USDC" && template.token !== "EURC") return null;
  const expiresInHours = template.expiresInHours;
  if (typeof expiresInHours !== "number" || !Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 720) return null;
  return { amount: template.amount.trim(), description: template.description.trim(), expiresInHours, id: template.id, label: template.label.trim(), token: template.token };
}
