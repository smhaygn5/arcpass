"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Address } from "viem";
import { ArcPassMark } from "@/components/ArcPassMark";
import { PaymentLinkQr } from "@/components/PaymentLinkQr";
import { ARC_TESTNET_NETWORK } from "@/lib/arc-chain";
import {
  createInvoice,
  createMerchantPassport,
  decodeInvoicePayload,
  invoiceHash,
  merchantPassportHash,
  trustLabel,
  trustScore,
  type ArcPassTokenSymbol,
  type PassportStatus,
  type RefundPolicy,
} from "@/lib/arcpass";
import {
  createSavedInvoice,
  INVOICES_STORAGE_KEY,
  invoiceStatus,
  invoiceStatusLabel,
  isSavedInvoice,
  loadSavedInvoices,
  merchantPassportLink,
  mergeSavedInvoices,
  saveInvoiceLocally,
  type SavedInvoice,
} from "@/lib/invoices";
import {
  extractInvoicePayload,
  isSavedReceipt,
  loadSavedReceipts,
  mergeSavedReceipts,
  RECEIPTS_STORAGE_KEY,
  saveVerifiedReceipt,
  type SavedReceipt,
  type VerifiedReceiptPayload,
} from "@/lib/receipts";
import { ensurePaymentNetwork, requestWalletAddress, signWalletMessage, walletErrorMessage } from "@/lib/wallet";
import { escapeCsvCell, shortAddress } from "@/lib/format";
import { invoiceLifecycle } from "@/lib/invoice-lifecycle";
import {
  BUILT_IN_INVOICE_TEMPLATES,
  expiryInputFromHours,
  loadInvoiceTemplates,
  removeInvoiceTemplate,
  saveInvoiceTemplate,
  type InvoiceTemplate,
} from "@/lib/invoice-templates";
import { formatRevenueAmount, merchantRevenueInsights } from "@/lib/revenue-insights";
import { isRefundRequest, type RefundRequest, type RefundRequestStatus } from "@/lib/refunds";
import { collectionReminders, type CollectionReminder } from "@/lib/collection-reminders";
import { parseBulkInvoiceDrafts, type BulkInvoiceDraft } from "@/lib/bulk-invoices";
import { DEFAULT_PAYMENT_LINK_BRANDING, PAYMENT_BRAND_ACCENTS, merchantMonogram, type PaymentBrandAccent, type PaymentLinkBranding } from "@/lib/payment-branding";

const WORKSPACE_TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "passport", label: "Passport" },
  { id: "verify", label: "Verify Domain" },
  { id: "invoice", label: "Invoice Link" },
  { id: "payments", label: "Payments" },
  { id: "receipts", label: "Receipts" },
] as const;
const INVOICE_FILTERS = [
  { id: "all", label: "All" },
  { id: "awaiting", label: "Awaiting" },
  { id: "verified", label: "Verified" },
  { id: "expired", label: "Expired" },
] as const;
const INPUT_CLASS =
  "min-h-11 w-full rounded-md border border-black/10 bg-white/80 px-3 text-sm text-[#111318] outline-none transition focus:border-[#1b66ff] focus:bg-white";

type InvoiceFilter = (typeof INVOICE_FILTERS)[number]["id"];
type InvoiceOperationsSummary = {
  awaiting: number;
  expired: number;
  openValue: string;
  settledValue: string;
  total: number;
  verified: number;
};
type ReceiptOperationsSummary = {
  lastPaid: string;
  total: number;
  uniquePayers: number;
  volume: string;
};
type VerificationState = "idle" | "checking" | "verified" | "failed";
type WorkspaceTab = (typeof WORKSPACE_TABS)[number]["id"];

export function ArcPassApp() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("dashboard");
  const [amount, setAmount] = useState("5.00");
  const [businessName, setBusinessName] = useState("Northstar AI Studio");
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [createdInvoiceId, setCreatedInvoiceId] = useState<string | null>(null);
  const [description, setDescription] = useState("AI research report");
  const [domain, setDomain] = useState("northstar.example");
  const [error, setError] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(defaultExpiryInput());
  const [invoiceHistory, setInvoiceHistory] = useState<SavedInvoice[]>(loadSavedInvoices);
  const [isLoadingServerInvoices, setIsLoadingServerInvoices] = useState(false);
  const [isLoadingServerReceipts, setIsLoadingServerReceipts] = useState(false);
  const [passportStatus, setPassportStatus] = useState<PassportStatus>("pending");
  const [receiptHistory, setReceiptHistory] = useState<SavedReceipt[]>(loadSavedReceipts);
  const [refundPolicy, setRefundPolicy] = useState<RefundPolicy>("merchant-refund");
  const [serverInvoiceError, setServerInvoiceError] = useState<string | null>(null);
  const [serverReceiptError, setServerReceiptError] = useState<string | null>(null);
  const [token, setToken] = useState<ArcPassTokenSymbol>("USDC");
  const [verification, setVerification] = useState<VerificationState>("idle");
  const [walletAddress, setWalletAddress] = useState<Address | null>(null);

  const passportPreview = useMemo(() => {
    if (!walletAddress) return null;

    try {
      return createMerchantPassport({
        businessName,
        domain,
        refundPolicy,
        status: passportStatus,
        walletAddress,
      });
    } catch {
      return null;
    }
  }, [businessName, domain, passportStatus, refundPolicy, walletAddress]);

  const score = passportPreview ? trustScore(passportPreview) : 0;
  const manifest = useMemo(() => {
    return JSON.stringify(
      {
        businessName,
        domain,
        service: "ArcPass",
        walletAddress: walletAddress ?? "0xYourMerchantWallet",
      },
      null,
      2,
    );
  }, [businessName, domain, walletAddress]);

  const loadMerchantServerInvoices = useCallback(async (address: Address) => {
    setIsLoadingServerInvoices(true);
    setServerInvoiceError(null);

    try {
      const res = await fetch(`/api/invoices?merchant=${encodeURIComponent(address)}`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; invoices?: unknown[] }
        | null;

      if (!res.ok) {
        throw new Error(body?.error || "Shared invoice ledger could not be loaded.");
      }

      const serverInvoices = (body?.invoices ?? []).filter(isSavedInvoice);
      setInvoiceHistory((current) => mergeSavedInvoices([serverInvoices, current, loadSavedInvoices()]));
    } catch (err) {
      setServerInvoiceError(err instanceof Error ? err.message : "Shared invoice ledger could not be loaded.");
    } finally {
      setIsLoadingServerInvoices(false);
    }
  }, []);

  const loadMerchantServerReceipts = useCallback(async (address: Address) => {
    setIsLoadingServerReceipts(true);
    setServerReceiptError(null);

    try {
      const res = await fetch(`/api/receipts?merchant=${encodeURIComponent(address)}`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; receipts?: unknown[] }
        | null;

      if (!res.ok) {
        throw new Error(body?.error || "Shared merchant ledger could not be loaded.");
      }

      const serverReceipts = (body?.receipts ?? []).filter(isSavedReceipt) as SavedReceipt[];
      setReceiptHistory((current) => mergeSavedReceipts([serverReceipts, current, loadSavedReceipts()]));
    } catch (err) {
      setServerReceiptError(err instanceof Error ? err.message : "Shared merchant ledger could not be loaded.");
    } finally {
      setIsLoadingServerReceipts(false);
    }
  }, []);

  useEffect(() => {
    function refreshInvoiceHistory() {
      setInvoiceHistory((current) => mergeSavedInvoices([loadSavedInvoices(), current]));
    }

    function refreshReceiptHistory() {
      setReceiptHistory((current) => mergeSavedReceipts([loadSavedReceipts(), current]));
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === INVOICES_STORAGE_KEY) refreshInvoiceHistory();
      if (event.key === RECEIPTS_STORAGE_KEY) refreshReceiptHistory();
    }

    window.addEventListener("arcpass:invoices-updated", refreshInvoiceHistory);
    window.addEventListener("arcpass:receipts-updated", refreshReceiptHistory);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("arcpass:invoices-updated", refreshInvoiceHistory);
      window.removeEventListener("arcpass:receipts-updated", refreshReceiptHistory);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  async function connectWallet() {
    setError(null);
    try {
      await ensurePaymentNetwork(ARC_TESTNET_NETWORK);
      const address = await requestWalletAddress();
      await startMerchantSession(address);
      setWalletAddress(address);
      void loadMerchantServerInvoices(address);
      void loadMerchantServerReceipts(address);
    } catch (err) {
      setError(walletErrorMessage(err));
    }
  }

  async function startMerchantSession(address: Address) {
    const challengeRes = await fetch(`/api/merchant-session?address=${encodeURIComponent(address)}`, {
      cache: "no-store",
    });
    const challenge = (await challengeRes.json().catch(() => null)) as
      | { error?: string; message?: string }
      | null;

    if (!challengeRes.ok || !challenge?.message) {
      throw new Error(challenge?.error || "Merchant session challenge could not be created.");
    }

    const signature = await signWalletMessage(address, challenge.message);
    const sessionRes = await fetch("/api/merchant-session", {
      body: JSON.stringify({ address, message: challenge.message, signature }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const session = (await sessionRes.json().catch(() => null)) as
      | { authenticated?: boolean; error?: string }
      | null;

    if (!sessionRes.ok || session?.authenticated !== true) {
      throw new Error(session?.error || "Merchant session could not be verified.");
    }
  }

  function mergeInvoiceHistory(invoices: SavedInvoice[]) {
    setInvoiceHistory((current) => mergeSavedInvoices([invoices, current, loadSavedInvoices()]));
  }

  function mergeReceiptHistory(receipts: SavedReceipt[]) {
    setReceiptHistory((current) => mergeSavedReceipts([receipts, current, loadSavedReceipts()]));
  }

  async function verifyDomain() {
    if (!walletAddress) {
      setError("Connect a merchant wallet before verifying a domain.");
      return;
    }

    setVerification("checking");
    setError(null);

    try {
      const res = await fetch("/api/passport/verify-domain", {
        body: JSON.stringify({ domain, walletAddress }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = await res.json();

      if (!res.ok || !body.verified) {
        setPassportStatus("pending");
        setVerification("failed");
        setError(body.error || "Domain verification failed.");
        return;
      }

      setPassportStatus("verified");
      setVerification("verified");
    } catch (err) {
      setPassportStatus("pending");
      setVerification("failed");
      setError(err instanceof Error ? err.message : "Domain verification failed.");
    }
  }

  async function createPaymentLink(branding: PaymentLinkBranding) {
    setError(null);
    setServerInvoiceError(null);

    try {
      if (!walletAddress) {
        throw new Error("Connect a merchant wallet before creating an invoice.");
      }

      const merchant = createMerchantPassport({
        businessName,
        domain,
        refundPolicy,
        status: passportStatus,
        walletAddress,
      });
      const invoice = createInvoice({
        amount,
        branding,
        description,
        expiresAt: new Date(expiresAt).toISOString(),
        merchant,
        token,
      });
      const savedInvoice = createSavedInvoice({ invoice, origin: window.location.origin });
      const nextHistory = saveInvoiceLocally(savedInvoice);

      setCreatedLink(savedInvoice.link);
      setCreatedInvoiceId(savedInvoice.invoice.invoiceId);
      setInvoiceHistory(nextHistory);
      setActiveTab("payments");

      try {
        const res = await fetch("/api/invoices", {
          body: JSON.stringify({ payload: savedInvoice.payload }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const body = (await res.json().catch(() => null)) as
          | { error?: string; invoice?: unknown; saved?: boolean }
          | null;

        if (!res.ok || body?.saved !== true) {
          throw new Error(body?.error || "Shared invoice ledger could not save this link.");
        }

        const serverInvoice = isSavedInvoice(body.invoice) ? body.invoice : savedInvoice;
        mergeInvoiceHistory([serverInvoice]);
      } catch (err) {
        setServerInvoiceError(err instanceof Error ? err.message : "Shared invoice ledger could not save this link.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invoice could not be created.");
    }
  }

  async function createBulkPaymentLinks(drafts: BulkInvoiceDraft[], branding: PaymentLinkBranding) {
    setError(null);
    setServerInvoiceError(null);
    try {
      if (!walletAddress) throw new Error("Connect a merchant wallet before creating invoices.");
      const merchant = createMerchantPassport({ businessName, domain, refundPolicy, status: passportStatus, walletAddress });
      const batch = drafts.map((draft) => {
        const invoice = createInvoice({ amount: draft.amount, branding, description: draft.description, expiresAt: new Date(Date.now() + draft.expiryHours * 3_600_000).toISOString(), merchant, token: draft.token });
        return createSavedInvoice({ invoice, origin: window.location.origin });
      });
      const res = await fetch("/api/invoices", { body: JSON.stringify({ payloads: batch.map((item) => item.payload) }), headers: { "content-type": "application/json" }, method: "POST" });
      const body = (await res.json().catch(() => null)) as { error?: string; invoices?: unknown[]; saved?: boolean } | null;
      const serverInvoices = (body?.invoices ?? []).filter(isSavedInvoice);
      if (!res.ok || body?.saved !== true || serverInvoices.length !== batch.length) throw new Error(body?.error || "The invoice batch could not be registered.");
      for (const item of serverInvoices) saveInvoiceLocally(item);
      setInvoiceHistory((current) => mergeSavedInvoices([serverInvoices, loadSavedInvoices(), current]));
      setCreatedLink(serverInvoices[0].link);
      setCreatedInvoiceId(serverInvoices[0].invoice.invoiceId);
      setActiveTab("payments");
      return serverInvoices.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : "The invoice batch could not be created.";
      setError(message);
      throw new Error(message);
    }
  }

  async function copyLink() {
    if (!createdLink) return;
    await window.navigator.clipboard.writeText(createdLink);
  }

  function selectTab(tab: WorkspaceTab) {
    setActiveTab(tab);
    window.setTimeout(() => {
      document.getElementById("workspace")?.scrollIntoView({ block: "start" });
    }, 0);
  }

  return (
    <main className="arcpass-page">
      <section className="arcpass-hero">
        <div className="arcpass-hero-background" aria-hidden="true" />
        <nav className="arcpass-nav" aria-label="ArcPass navigation">
          <button type="button" onClick={() => selectTab("dashboard")} className="arcpass-brand-button">
            <ArcPassMark />
          </button>

          <div className="arcpass-nav-links">
            {WORKSPACE_TABS.slice(1, 5).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => selectTab(tab.id)}
                className={activeTab === tab.id ? "is-active" : ""}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="arcpass-nav-actions">
            <button type="button" onClick={() => selectTab("receipts")} className="arcpass-ghost-button">
              Receipts
            </button>
            <button type="button" onClick={connectWallet} className="arcpass-dark-button">
              {walletAddress ? shortAddress(walletAddress) : "Connect"}
            </button>
          </div>
        </nav>

        <div className="arcpass-hero-content">
          <div className="arcpass-hero-copy">
            <p className="arcpass-eyebrow">Trust-first checkout on Arc</p>
            <h1>Verified links for stablecoin payments.</h1>
            <p>
              ArcPass turns every crypto payment link into a merchant passport, locked invoice, and
              explorer-backed receipt so buyers know exactly who they are paying.
            </p>
            <div className="arcpass-hero-actions">
              <button type="button" onClick={() => selectTab("invoice")} className="arcpass-dark-button arcpass-hero-cta">
                Create payment link <span aria-hidden="true">›</span>
              </button>
              <button type="button" onClick={() => selectTab("passport")} className="arcpass-text-button">
                Build merchant passport
              </button>
            </div>
          </div>

          <aside className="arcpass-hero-panel" aria-label="ArcPass status summary">
            <div>
              <p className="arcpass-panel-label">Current trust score</p>
              <strong>{score}/100</strong>
              <span>{trustLabel(score)}</span>
            </div>
            <div className="arcpass-hero-panel-grid">
              <MetricPill label="Network" value="Arc Testnet" />
              <MetricPill label="Invoices" value={String(invoiceHistory.length)} />
              <MetricPill label="Passport" value={passportStatus} />
              <MetricPill label="Receipts" value={String(receiptHistory.length)} />
            </div>
          </aside>
        </div>

        <ArcPassMark compact className="arcpass-corner-logo" />
      </section>

      <section id="workspace" className="arcpass-workspace">
        <div className="arcpass-workspace-heading">
          <div>
            <p className="arcpass-eyebrow">Merchant workspace</p>
            <h2>{WORKSPACE_TABS.find((tab) => tab.id === activeTab)?.label}</h2>
          </div>
          <div className="arcpass-tabbar" role="tablist" aria-label="ArcPass workspace tabs">
            {WORKSPACE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "dashboard" ? (
          <DashboardTab
            createdLink={createdLink}
            invoiceHistory={invoiceHistory}
            receiptHistory={receiptHistory}
            score={score}
            selectTab={setActiveTab}
            walletAddress={walletAddress}
          />
        ) : null}
        {activeTab === "passport" ? (
          <PassportTab
            businessName={businessName}
            domain={domain}
            passportHash={passportPreview ? merchantPassportHash(passportPreview) : null}
            refundPolicy={refundPolicy}
            score={score}
            setBusinessName={setBusinessName}
            setDomain={(value) => {
              setDomain(value);
              setPassportStatus("pending");
              setVerification("idle");
            }}
            setRefundPolicy={setRefundPolicy}
            walletAddress={walletAddress}
          />
        ) : null}
        {activeTab === "verify" ? (
          <VerifyTab
            domain={domain}
            manifest={manifest}
            verification={verification}
            verifyDomain={verifyDomain}
            walletAddress={walletAddress}
          />
        ) : null}
        {activeTab === "invoice" ? (
          <InvoiceTab
            amount={amount}
            businessName={businessName}
            createBulkPaymentLinks={createBulkPaymentLinks}
            createPaymentLink={createPaymentLink}
            description={description}
            expiresAt={expiresAt}
            setAmount={setAmount}
            setDescription={setDescription}
            setExpiresAt={setExpiresAt}
            setToken={setToken}
            token={token}
          />
        ) : null}
        {activeTab === "payments" ? (
          <PaymentsTab
            copyLink={copyLink}
            createdLink={createdLink}
            createdInvoiceId={createdInvoiceId}
            invoiceHistory={invoiceHistory}
            isLoadingServerInvoices={isLoadingServerInvoices}
            onRefreshServerInvoices={() => (walletAddress ? loadMerchantServerInvoices(walletAddress) : Promise.resolve())}
            receiptHistory={receiptHistory}
            selectTab={setActiveTab}
            serverInvoiceError={serverInvoiceError}
            walletAddress={walletAddress}
          />
        ) : null}
        {activeTab === "receipts" ? (
          <ReceiptsTab
            invoiceHistory={invoiceHistory}
            isLoadingServerReceipts={isLoadingServerReceipts}
            onReceiptImported={mergeReceiptHistory}
            onRefreshServerReceipts={() => (walletAddress ? loadMerchantServerReceipts(walletAddress) : Promise.resolve())}
            receiptHistory={receiptHistory}
            serverReceiptError={serverReceiptError}
            walletAddress={walletAddress}
          />
        ) : null}

        {error ? (
          <p className="arcpass-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}

function DashboardTab({
  createdLink,
  invoiceHistory,
  receiptHistory,
  score,
  selectTab,
  walletAddress,
}: {
  createdLink: string | null;
  invoiceHistory: SavedInvoice[];
  receiptHistory: SavedReceipt[];
  score: number;
  selectTab: (tab: WorkspaceTab) => void;
  walletAddress: Address | null;
}) {
  const latestReceipt = receiptHistory[0];

  return (
    <div className="arcpass-dashboard-grid">
      <div className="arcpass-panel arcpass-panel-large">
        <p className="arcpass-panel-label">Operational flow</p>
        <h3>From merchant identity to buyer-safe checkout.</h3>
        <div className="arcpass-flow">
          {[
            ["01", "Bind wallet", walletAddress ? shortAddress(walletAddress) : "Waiting"],
            ["02", "Verify domain", "Manifest + wallet match"],
            ["03", "Lock invoice", "Amount, token, merchant, expiry"],
            ["04", "Collect payment", "Arc Testnet receipt"],
          ].map(([step, title, detail]) => (
            <button
              key={step}
              type="button"
              onClick={() => selectTab(step === "01" ? "passport" : step === "02" ? "verify" : step === "03" ? "invoice" : "payments")}
              className="arcpass-flow-item"
            >
              <span>{step}</span>
              <strong>{title}</strong>
              <em>{detail}</em>
            </button>
          ))}
        </div>
      </div>

      <div className="arcpass-panel">
        <p className="arcpass-panel-label">Trust score</p>
        <strong className="arcpass-score">{score}</strong>
        <span className="arcpass-muted">{trustLabel(score)}</span>
      </div>

      <div className="arcpass-panel">
        <p className="arcpass-panel-label">{latestReceipt ? "Latest verified receipt" : "Latest link"}</p>
        {latestReceipt ? (
          <a href={latestReceipt.explorerUrl} target="_blank" rel="noreferrer" className="arcpass-link-preview">
            {latestReceipt.amount} {latestReceipt.token} from {shortAddress(latestReceipt.payer)}
          </a>
        ) : createdLink ? (
          <a href={createdLink} target="_blank" rel="noreferrer" className="arcpass-link-preview">
            Open hosted checkout
          </a>
        ) : (
          <button type="button" onClick={() => selectTab("invoice")} className="arcpass-text-button">
            Create the first link
          </button>
        )}
      </div>

      <div className="arcpass-panel arcpass-panel-wide">
        <p className="arcpass-panel-label">Recent invoices</p>
        <InvoiceList
          invoiceHistory={invoiceHistory}
          emptyLabel="No invoices yet."
          receiptHistory={receiptHistory}
        />
      </div>

      <InvoiceLifecycleTimeline
        invoiceHistory={invoiceHistory}
        receiptHistory={receiptHistory}
      />

      <MerchantRevenueInsights receiptHistory={receiptHistory} />
    </div>
  );
}

function MerchantRevenueInsights({ receiptHistory }: { receiptHistory: SavedReceipt[] }) {
  const insights = useMemo(() => merchantRevenueInsights(receiptHistory), [receiptHistory]);

  return (
    <section className="arcpass-panel arcpass-panel-wide arcpass-revenue-panel">
      <div className="arcpass-revenue-heading">
        <div>
          <p className="arcpass-panel-label">Revenue insights</p>
          <h3>Verified settlement activity over the last {insights.periodDays} days.</h3>
        </div>
        <span>{insights.totalPayments} payments · {insights.uniquePayers} payers</span>
      </div>
      {insights.totalPayments ? (
        <div className="arcpass-revenue-grid">
          {insights.tokens.map((item) => {
            const peak = Math.max(...item.dailyTotals, 1);
            const changeLabel = item.changePercent === null ? "New activity" : `${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(0)}% vs prior week`;
            return (
              <article className="arcpass-revenue-token" key={item.token}>
                <div className="arcpass-revenue-token-head"><span>{item.token}</span><em data-positive={item.changePercent === null || item.changePercent >= 0}>{changeLabel}</em></div>
                <strong>{formatRevenueAmount(item.total)} {item.token}</strong>
                <p>{item.paymentCount} verified payments · Avg {formatRevenueAmount(item.average)} {item.token}</p>
                <div className="arcpass-revenue-chart" role="img" aria-label={`${item.token} settlement trend for the last ${insights.periodDays} days`}>
                  {item.dailyTotals.map((value, index) => <span key={index} style={{ height: `${Math.max(8, (value / peak) * 100)}%` }} title={`${formatRevenueAmount(value)} ${item.token}`} />)}
                </div>
              </article>
            );
          })}
        </div>
      ) : <p className="arcpass-empty">Verified payments will appear here as separate USDC and EURC settlement trends.</p>}
    </section>
  );
}

function InvoiceLifecycleTimeline({
  invoiceHistory,
  receiptHistory,
}: {
  invoiceHistory: SavedInvoice[];
  receiptHistory: SavedReceipt[];
}) {
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const selected =
    invoiceHistory.find((item) => item.invoice.invoiceId === selectedInvoiceId) ??
    invoiceHistory[0] ??
    null;
  const events = selected ? invoiceLifecycle(selected, receiptHistory) : [];

  return (
    <section className="arcpass-panel arcpass-panel-wide arcpass-lifecycle-panel">
      <div className="arcpass-lifecycle-heading">
        <div>
          <p className="arcpass-panel-label">Invoice lifecycle</p>
          <h3>See exactly where each payment link stands.</h3>
        </div>
        {selected ? <span className="arcpass-status-word">{invoiceStatusLabel(invoiceStatus(selected.invoice, receiptHistory))}</span> : null}
      </div>
      {invoiceHistory.length ? (
        <>
          <div className="arcpass-lifecycle-select" role="list" aria-label="Choose an invoice timeline">
            {invoiceHistory.slice(0, 8).map((item) => (
              <button
                key={item.invoice.invoiceId}
                type="button"
                className={item.invoice.invoiceId === selected?.invoice.invoiceId ? "is-selected" : ""}
                onClick={() => setSelectedInvoiceId(item.invoice.invoiceId)}
              >
                {item.invoice.invoiceId} · {item.invoice.amount} {item.invoice.token}
              </button>
            ))}
          </div>
          <div className="arcpass-lifecycle-events">
            {events.map((event) => (
              <div className="arcpass-lifecycle-event" key={`${event.status}-${event.at}`}>
                <span data-status={event.status} />
                <div>
                  <strong>{event.title}</strong>
                  <p>{event.detail}</p>
                </div>
                <time>{new Date(event.at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</time>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="arcpass-empty">Create an invoice to start its lifecycle timeline.</p>
      )}
    </section>
  );
}

function PassportTab({
  businessName,
  domain,
  passportHash,
  refundPolicy,
  score,
  setBusinessName,
  setDomain,
  setRefundPolicy,
  walletAddress,
}: {
  businessName: string;
  domain: string;
  passportHash: string | null;
  refundPolicy: RefundPolicy;
  score: number;
  setBusinessName: (value: string) => void;
  setDomain: (value: string) => void;
  setRefundPolicy: (value: RefundPolicy) => void;
  walletAddress: Address | null;
}) {
  return (
    <div className="arcpass-two-column">
      <div className="arcpass-panel">
        <p className="arcpass-panel-label">Merchant identity</p>
        <h3>Make the link feel less like a random address.</h3>
        <div className="arcpass-form-grid">
          <Field label="Business name">
            <input value={businessName} onChange={(event) => setBusinessName(event.target.value)} className={INPUT_CLASS} />
          </Field>
          <Field label="Domain">
            <input value={domain} onChange={(event) => setDomain(event.target.value)} className={INPUT_CLASS} />
          </Field>
          <Field label="Refund policy">
            <select value={refundPolicy} onChange={(event) => setRefundPolicy(event.target.value as RefundPolicy)} className={INPUT_CLASS}>
              <option value="merchant-refund">Merchant refund</option>
              <option value="escrow-window">Escrow window</option>
              <option value="none">No refund</option>
            </select>
          </Field>
        </div>
      </div>

      <aside className="arcpass-panel">
        <p className="arcpass-panel-label">Passport preview</p>
        <h3>{businessName}</h3>
        <div className="arcpass-detail-list">
          <Detail label="Domain" value={domain} />
          <Detail label="Wallet" value={walletAddress ? shortAddress(walletAddress) : "Not connected"} />
          <Detail label="Refund" value={refundPolicy} />
          <Detail label="Trust score" value={`${score}/100`} />
        </div>
        {passportHash ? <p className="arcpass-hash">Passport hash: {passportHash}</p> : null}
      </aside>
    </div>
  );
}

function VerifyTab({
  domain,
  manifest,
  verification,
  verifyDomain,
  walletAddress,
}: {
  domain: string;
  manifest: string;
  verification: VerificationState;
  verifyDomain: () => void;
  walletAddress: Address | null;
}) {
  return (
    <div className="arcpass-two-column">
      <div className="arcpass-panel">
        <p className="arcpass-panel-label">Domain verification</p>
        <h3>Publish a merchant manifest.</h3>
        <p className="arcpass-muted">
          Put this file at <span className="arcpass-code">https://{domain}/.well-known/arcpass.json</span>.
        </p>
        <pre className="arcpass-code-block">{manifest}</pre>
        <button
          type="button"
          onClick={verifyDomain}
          disabled={!walletAddress || verification === "checking"}
          className="arcpass-dark-button arcpass-inline-action"
        >
          {verification === "checking" ? "Checking domain" : "Verify domain"}
        </button>
      </div>
      <aside className="arcpass-panel">
        <p className="arcpass-panel-label">Verification state</p>
        <strong className="arcpass-status-word">{verification}</strong>
        <p className="arcpass-muted">
          The verifier checks that the public domain manifest points back to the connected merchant wallet.
        </p>
      </aside>
    </div>
  );
}

function InvoiceTab({
  amount,
  businessName,
  createBulkPaymentLinks,
  createPaymentLink,
  description,
  expiresAt,
  setAmount,
  setDescription,
  setExpiresAt,
  setToken,
  token,
}: {
  amount: string;
  businessName: string;
  createBulkPaymentLinks: (drafts: BulkInvoiceDraft[], branding: PaymentLinkBranding) => Promise<number>;
  createPaymentLink: (branding: PaymentLinkBranding) => Promise<void>;
  description: string;
  expiresAt: string;
  setAmount: (value: string) => void;
  setDescription: (value: string) => void;
  setExpiresAt: (value: string) => void;
  setToken: (value: ArcPassTokenSymbol) => void;
  token: ArcPassTokenSymbol;
}) {
  const [customTemplates, setCustomTemplates] = useState<InvoiceTemplate[]>(loadInvoiceTemplates);
  const [templateName, setTemplateName] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSuccess, setBulkSuccess] = useState<string | null>(null);
  const [isCreatingBulk, setIsCreatingBulk] = useState(false);
  const [brandAccent, setBrandAccent] = useState<PaymentBrandAccent>(DEFAULT_PAYMENT_LINK_BRANDING.accent);
  const [brandMessage, setBrandMessage] = useState("");
  const [showMonogram, setShowMonogram] = useState(true);
  const bulkPreview = useMemo(() => parseBulkInvoiceDrafts(bulkInput), [bulkInput]);
  const branding = useMemo<PaymentLinkBranding>(() => ({ accent: brandAccent, message: brandMessage.trim(), showMonogram }), [brandAccent, brandMessage, showMonogram]);

  function applyTemplate(template: InvoiceTemplate) {
    setAmount(template.amount);
    setDescription(template.description);
    setToken(template.token);
    setExpiresAt(expiryInputFromHours(template.expiresInHours));
  }

  function saveCurrentTemplate() {
    try {
      const next = saveInvoiceTemplate({
        amount,
        description,
        expiresInHours: Math.max(1, Math.min(720, Math.round((new Date(expiresAt).getTime() - Date.now()) / 3_600_000) || 24)),
        label: templateName.trim() || "Saved invoice template",
        token,
      });
      setCustomTemplates(next);
      setTemplateName("");
    } catch {
      // The form still keeps the current invoice values if local storage is unavailable.
    }
  }

  async function createBatch() {
    setBulkError(null);
    setBulkSuccess(null);
    if (!bulkInput.trim()) { setBulkError("Add at least one invoice row."); return; }
    if (bulkPreview.errors.length || bulkPreview.drafts.length === 0) { setBulkError("Fix every row before creating the batch."); return; }
    setIsCreatingBulk(true);
    try {
      const count = await createBulkPaymentLinks(bulkPreview.drafts, branding);
      setBulkSuccess(`${count} verified payment links created.`);
      setBulkInput("");
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "The invoice batch could not be created.");
    } finally {
      setIsCreatingBulk(false);
    }
  }

  return (
    <div className="arcpass-panel">
      <p className="arcpass-panel-label">Invoice builder</p>
      <h3>Create a locked, buyer-readable checkout link.</h3>
      <section className="arcpass-template-kit" aria-label="Invoice templates">
        <div>
          <strong>Start from a template</strong>
          <p>Apply common invoice settings, then edit anything before creating the payment link.</p>
        </div>
        <div className="arcpass-template-list">
          {[...BUILT_IN_INVOICE_TEMPLATES, ...customTemplates].map((template) => (
            <div className="arcpass-template-item" key={template.id}>
              <button type="button" onClick={() => applyTemplate(template)}>
                <strong>{template.label}</strong><span>{template.amount} {template.token} · {template.expiresInHours}h</span>
              </button>
              {!template.isBuiltIn ? <button type="button" className="arcpass-template-remove" onClick={() => setCustomTemplates(removeInvoiceTemplate(template.id))} aria-label={`Remove ${template.label}`}>×</button> : null}
            </div>
          ))}
        </div>
      </section>
      <div className="arcpass-form-grid arcpass-form-grid-four">
        <Field label="Description">
          <input value={description} onChange={(event) => setDescription(event.target.value)} className={INPUT_CLASS} />
        </Field>
        <Field label="Amount">
          <input value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value)} className={INPUT_CLASS} />
        </Field>
        <Field label="Token">
          <select value={token} onChange={(event) => setToken(event.target.value as ArcPassTokenSymbol)} className={INPUT_CLASS}>
            <option value="USDC">USDC</option>
            <option value="EURC">EURC</option>
          </select>
        </Field>
        <Field label="Expires at">
          <input value={expiresAt} type="datetime-local" onChange={(event) => setExpiresAt(event.target.value)} className={INPUT_CLASS} />
        </Field>
      </div>
      <div className="arcpass-template-save">
        <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Template name (optional)" className={INPUT_CLASS} />
        <button type="button" onClick={saveCurrentTemplate} className="arcpass-ghost-button">Save current as template</button>
      </div>
      <section className="arcpass-branding-builder">
        <div className="arcpass-branding-heading"><div><p className="arcpass-panel-label">Payment link branding</p><h3>Make the checkout recognizable.</h3><p>Brand styling stays inside ArcPass’s fixed, accessible checkout structure.</p></div><div className="arcpass-brand-preview" style={{ "--brand-preview": PAYMENT_BRAND_ACCENTS[brandAccent].color, "--brand-preview-soft": PAYMENT_BRAND_ACCENTS[brandAccent].soft } as CSSProperties}>{showMonogram ? <span>{merchantMonogram(businessName)}</span> : null}<div><strong>{businessName}</strong><small>{brandMessage.trim() || "Verified payment via ArcPass"}</small></div></div></div>
        <div className="arcpass-branding-controls"><fieldset><legend>Accent</legend><div>{Object.entries(PAYMENT_BRAND_ACCENTS).map(([id, option]) => <label key={id}><input type="radio" name="payment-brand-accent" value={id} checked={brandAccent === id} onChange={() => setBrandAccent(id as PaymentBrandAccent)} /><span style={{ background: option.color }} /><em>{option.label}</em></label>)}</div></fieldset><label className="arcpass-brand-message"><span>Checkout message</span><input value={brandMessage} onChange={(event) => setBrandMessage(event.target.value)} maxLength={120} placeholder="A short note for your customer" className={INPUT_CLASS} /><small>{brandMessage.trim().length}/120</small></label><label className="arcpass-brand-toggle"><input type="checkbox" checked={showMonogram} onChange={(event) => setShowMonogram(event.target.checked)} /><span>Show merchant monogram</span></label></div>
      </section>
      <button type="button" onClick={() => void createPaymentLink(branding)} className="arcpass-dark-button arcpass-inline-action">
        Generate verified payment link
      </button>
      <section className="arcpass-bulk-builder">
        <div><p className="arcpass-panel-label">Bulk invoice creator</p><h3>Create up to 10 verified links at once.</h3><p>Enter one invoice per line using: Description | Amount | Token | Expiry hours</p></div>
        <textarea value={bulkInput} onChange={(event) => { setBulkInput(event.target.value); setBulkError(null); setBulkSuccess(null); }} placeholder={"Design delivery | 250 | USDC | 72\nMonthly support | 99 | EURC | 168"} rows={5} />
        {bulkInput.trim() ? <div className="arcpass-bulk-preview"><strong>{bulkPreview.drafts.length} valid rows</strong>{bulkPreview.errors.length ? <ul>{bulkPreview.errors.map((item) => <li key={item}>{item}</li>)}</ul> : <p>All rows are ready for server registration.</p>}</div> : null}
        <button type="button" className="arcpass-dark-button" onClick={() => void createBatch()} disabled={isCreatingBulk || bulkPreview.errors.length > 0}>{isCreatingBulk ? "Creating batch" : `Create ${bulkPreview.drafts.length || "batch"} payment links`}</button>
        {bulkError ? <p className="arcpass-error" role="alert">{bulkError}</p> : null}
        {bulkSuccess ? <p className="arcpass-success">{bulkSuccess}</p> : null}
      </section>
    </div>
  );
}

function PaymentsTab({
  copyLink,
  createdLink,
  createdInvoiceId,
  invoiceHistory,
  isLoadingServerInvoices,
  onRefreshServerInvoices,
  receiptHistory,
  selectTab,
  serverInvoiceError,
  walletAddress,
}: {
  copyLink: () => Promise<void>;
  createdLink: string | null;
  createdInvoiceId: string | null;
  invoiceHistory: SavedInvoice[];
  isLoadingServerInvoices: boolean;
  onRefreshServerInvoices: () => Promise<void>;
  receiptHistory: SavedReceipt[];
  selectTab: (tab: WorkspaceTab) => void;
  serverInvoiceError: string | null;
  walletAddress: Address | null;
}) {
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>("all");
  const [invoiceQuery, setInvoiceQuery] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [sharedReminderId, setSharedReminderId] = useState<string | null>(null);
  const invoiceOperations = useMemo(
    () => summarizeInvoiceOperations(invoiceHistory, receiptHistory),
    [invoiceHistory, receiptHistory],
  );
  const filteredInvoices = useMemo(
    () => filterInvoices(invoiceHistory, receiptHistory, invoiceFilter, invoiceQuery),
    [invoiceFilter, invoiceHistory, invoiceQuery, receiptHistory],
  );
  const activeInvoiceId = selectedInvoiceId ?? createdInvoiceId;
  const selectedInvoice =
    filteredInvoices.find((item) => item.invoice.invoiceId === activeInvoiceId) ??
    filteredInvoices[0] ??
    null;
  const reminders = useMemo(() => collectionReminders(invoiceHistory, receiptHistory), [invoiceHistory, receiptHistory]);

  async function copySelectedInvoiceLink() {
    if (!selectedInvoice) return;
    await window.navigator.clipboard.writeText(selectedInvoice.link);
  }

  async function shareReminder(reminder: CollectionReminder) {
    try {
      if (navigator.share) await navigator.share({ text: reminder.message, title: `ArcPass reminder · ${reminder.invoice.invoice.invoiceId}` });
      else await navigator.clipboard.writeText(reminder.message);
      setSharedReminderId(reminder.invoice.invoice.invoiceId);
    } catch {
      setSharedReminderId(null);
    }
  }

  return (
    <div className="arcpass-receipts-layout">
      <div className="arcpass-panel">
        <p className="arcpass-panel-label">Hosted checkout</p>
        <h3>Buyer opens a payment page with passport, invoice lock, and Arc receipt state.</h3>
        {createdLink ? (
          <div className="arcpass-generated-link">
            <a href={createdLink} target="_blank" rel="noreferrer">
              {createdLink}
            </a>
            <button type="button" onClick={copyLink} className="arcpass-dark-button">
              Copy link
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => selectTab("invoice")} className="arcpass-dark-button arcpass-inline-action">
            Create a link first
          </button>
        )}
      </div>

      <div className="arcpass-panel">
        <p className="arcpass-panel-label">Payment links</p>
        <h3>All server-backed invoices for this merchant.</h3>
        <PaymentOperationsSummary stats={invoiceOperations} />
        <div className="arcpass-ledger-sync">
          <span>
            Shared invoice ledger: {walletAddress ? shortAddress(walletAddress) : "Connect merchant wallet"}
          </span>
          <button
            type="button"
            onClick={onRefreshServerInvoices}
            disabled={!walletAddress || isLoadingServerInvoices}
            className="arcpass-ghost-button"
          >
            {isLoadingServerInvoices ? "Refreshing" : "Refresh"}
          </button>
        </div>
        {serverInvoiceError ? (
          <p className="arcpass-error" role="alert">
            {serverInvoiceError}
          </p>
        ) : null}
        <div className="arcpass-ops-toolbar">
          <div className="arcpass-segmented-control" role="tablist" aria-label="Invoice status">
            {INVOICE_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                role="tab"
                aria-selected={invoiceFilter === filter.id}
                onClick={() => setInvoiceFilter(filter.id)}
              >
                {filter.label}
                <span>{invoiceFilterCount(invoiceOperations, filter.id)}</span>
              </button>
            ))}
          </div>
          <label className="arcpass-search-field">
            <span>Search invoices</span>
            <input
              value={invoiceQuery}
              onChange={(event) => setInvoiceQuery(event.target.value)}
              placeholder="Invoice, domain, amount"
              className={INPUT_CLASS}
            />
          </label>
          <button
            type="button"
            onClick={() => exportInvoiceReport(filteredInvoices, receiptHistory)}
            disabled={filteredInvoices.length === 0}
            className="arcpass-ghost-button arcpass-export-button"
          >
            Export CSV
          </button>
        </div>
        <InvoiceList
          invoiceHistory={filteredInvoices}
          emptyLabel={invoiceHistory.length === 0 ? "Create an invoice to see it here." : "No invoices match this view."}
          onSelectInvoice={(item) => setSelectedInvoiceId(item.invoice.invoiceId)}
          receiptHistory={receiptHistory}
          selectedInvoiceId={selectedInvoice?.invoice.invoiceId ?? null}
        />
      </div>

      <InvoiceDetailPanel
        item={selectedInvoice}
        onCopyLink={copySelectedInvoiceLink}
        receiptHistory={receiptHistory}
      />

      <section className="arcpass-panel arcpass-collection-panel">
        <div className="arcpass-collection-heading"><div><p className="arcpass-panel-label">Expiry & collection reminders</p><h3>Follow up before payment links go cold.</h3></div><span>{reminders.length} actions</span></div>
        {reminders.length ? <div className="arcpass-collection-list">{reminders.slice(0, 8).map((reminder) => <article key={reminder.invoice.invoice.invoiceId}><div><i data-kind={reminder.kind}>{reminder.label}</i><strong>{reminder.invoice.invoice.description}</strong><span>{reminder.invoice.invoice.amount} {reminder.invoice.invoice.token} · expires {new Date(reminder.invoice.invoice.expiresAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</span></div><button type="button" onClick={() => void shareReminder(reminder)} className="arcpass-ghost-button">{sharedReminderId === reminder.invoice.invoice.invoiceId ? "Message ready" : reminder.kind === "expired" ? "Share expiry notice" : "Share reminder"}</button></article>)}</div> : <p className="arcpass-empty">No collection reminders need attention right now.</p>}
        <p className="arcpass-muted">ArcPass prepares the message; you choose the recipient and channel. Expired links are never presented as payable.</p>
      </section>

      <aside className="arcpass-panel">
        <p className="arcpass-panel-label">Payment rail</p>
        <div className="arcpass-detail-list">
          <Detail label="Network" value="Arc Testnet" />
          <Detail label="Settlement" value="ERC-20 transfer" />
          <Detail label="Invoice source" value="Server ledger" />
          <Detail label="Receipt source" value="ArcScan + server ledger" />
        </div>
      </aside>
    </div>
  );
}

function ReceiptsTab({
  invoiceHistory,
  isLoadingServerReceipts,
  onReceiptImported,
  onRefreshServerReceipts,
  receiptHistory,
  serverReceiptError,
  walletAddress,
}: {
  invoiceHistory: SavedInvoice[];
  isLoadingServerReceipts: boolean;
  onReceiptImported: (receipts: SavedReceipt[]) => void;
  onRefreshServerReceipts: () => Promise<void>;
  receiptHistory: SavedReceipt[];
  serverReceiptError: string | null;
  walletAddress: Address | null;
}) {
  const [importError, setImportError] = useState<string | null>(null);
  const [importLink, setImportLink] = useState("");
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [importTxHash, setImportTxHash] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [receiptQuery, setReceiptQuery] = useState("");
  const receiptOperations = useMemo(() => summarizeReceiptOperations(receiptHistory), [receiptHistory]);
  const filteredReceipts = useMemo(
    () => filterReceipts(receiptHistory, receiptQuery),
    [receiptHistory, receiptQuery],
  );

  async function importReceipt() {
    setImportError(null);
    setImportSuccess(null);

    const payload = extractInvoicePayload(importLink);
    const invoice = decodeInvoicePayload(payload);
    const txHash = importTxHash.trim();

    if (!invoice) {
      setImportError("Paste a valid ArcPass payment link or invoice payload.");
      return;
    }

    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      setImportError("Paste a valid Arc transaction hash.");
      return;
    }

    setIsImporting(true);

    try {
      const res = await fetch("/api/payments/verify", {
        body: JSON.stringify({ payload, txHash }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await res.json().catch(() => null)) as
        | (Partial<VerifiedReceiptPayload> & { error?: string; verified?: boolean })
        | null;

      if (!res.ok || body?.verified !== true) {
        throw new Error(body?.error || "ArcPass could not verify this receipt.");
      }

      const verified = body as VerifiedReceiptPayload;
      const nextReceipts = saveVerifiedReceipt({
        invoice,
        payload,
        receipt: verified,
      });
      const ledgerNote = verified.serverSaved
        ? "Shared merchant ledger updated."
        : "Saved locally; shared ledger can be refreshed after retrying verification.";

      onReceiptImported(nextReceipts);
      void onRefreshServerReceipts();
      setImportLink("");
      setImportTxHash("");
      setImportSuccess(`Saved verified ${verified.amount} ${verified.token} receipt for ${shortAddress(verified.payer)}. ${ledgerNote}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "ArcPass could not verify this receipt.");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="arcpass-receipts-layout">
      <div className="arcpass-panel">
        <p className="arcpass-panel-label">Import verified receipt</p>
        <h3>Save a buyer payment into this merchant ledger.</h3>
        <div className="arcpass-import-grid">
          <Field label="Payment link or payload">
            <input
              value={importLink}
              onChange={(event) => setImportLink(event.target.value)}
              placeholder="https://.../pay/..."
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Arc transaction hash">
            <input
              value={importTxHash}
              onChange={(event) => setImportTxHash(event.target.value)}
              placeholder="0x..."
              className={INPUT_CLASS}
            />
          </Field>
        </div>
        <button type="button" onClick={importReceipt} disabled={isImporting} className="arcpass-dark-button arcpass-inline-action">
          {isImporting ? "Verifying receipt" : "Verify and save receipt"}
        </button>
        {importError ? (
          <p className="arcpass-error" role="alert">
            {importError}
          </p>
        ) : null}
        {importSuccess ? <p className="arcpass-success">{importSuccess}</p> : null}
      </div>

      <div className="arcpass-panel">
        <p className="arcpass-panel-label">Verified receipt ledger</p>
        <h3>Payments matched on Arc by invoice amount, token, and merchant wallet.</h3>
        <div className="arcpass-ops-summary">
          <MetricPill label="Receipts" value={String(receiptOperations.total)} />
          <MetricPill label="Volume" value={receiptOperations.volume} />
          <MetricPill label="Payers" value={String(receiptOperations.uniquePayers)} />
          <MetricPill label="Last paid" value={receiptOperations.lastPaid} />
        </div>
        <div className="arcpass-ledger-sync">
          <span>
            Shared ledger: {walletAddress ? shortAddress(walletAddress) : "Connect merchant wallet"}
          </span>
          <button
            type="button"
            onClick={onRefreshServerReceipts}
            disabled={!walletAddress || isLoadingServerReceipts}
            className="arcpass-ghost-button"
          >
            {isLoadingServerReceipts ? "Refreshing" : "Refresh"}
          </button>
        </div>
        {serverReceiptError ? (
          <p className="arcpass-error" role="alert">
            {serverReceiptError}
          </p>
        ) : null}
        <div className="arcpass-report-toolbar">
          <label className="arcpass-search-field">
            <span>Search receipts</span>
            <input
              value={receiptQuery}
              onChange={(event) => setReceiptQuery(event.target.value)}
              placeholder="Invoice, payer, transaction"
              className={INPUT_CLASS}
            />
          </label>
          <button
            type="button"
            onClick={() => exportReceiptReport(filteredReceipts)}
            disabled={filteredReceipts.length === 0}
            className="arcpass-ghost-button arcpass-export-button"
          >
            Export CSV
          </button>
        </div>
        <ReceiptList
          emptyLabel={receiptHistory.length === 0 ? "No verified payments yet." : "No receipts match this search."}
          receiptHistory={filteredReceipts}
        />
      </div>

      <div className="arcpass-panel">
        <p className="arcpass-panel-label">Open invoice links</p>
        <h3>Links ready for buyer testing.</h3>
        <InvoiceList
          invoiceHistory={invoiceHistory}
          emptyLabel="Create an invoice to see it here."
          receiptHistory={receiptHistory}
        />
      </div>

      <RefundRequestsPanel walletAddress={walletAddress} />
    </div>
  );
}

function RefundRequestsPanel({ walletAddress }: { walletAddress: Address | null }) {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [requests, setRequests] = useState<RefundRequest[]>([]);

  const loadRequests = useCallback(async () => {
    if (!walletAddress) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/refunds?merchant=${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as { error?: string; refunds?: unknown[] } | null;
      if (!res.ok) throw new Error(body?.error || "Refund requests could not be loaded.");
      setRequests((body?.refunds ?? []).filter(isRefundRequest));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refund requests could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress) return;
    let cancelled = false;
    void fetch(`/api/refunds?merchant=${encodeURIComponent(walletAddress)}`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { error?: string; refunds?: unknown[] } | null;
        if (!res.ok) throw new Error(body?.error || "Refund requests could not be loaded.");
        if (!cancelled) setRequests((body?.refunds ?? []).filter(isRefundRequest));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Refund requests could not be loaded.");
      });
    return () => { cancelled = true; };
  }, [walletAddress]);

  async function decide(requestId: string, status: Exclude<RefundRequestStatus, "pending">) {
    if (!walletAddress) return;
    setError(null);
    try {
      const res = await fetch("/api/refunds", { body: JSON.stringify({ merchant: walletAddress, requestId, status }), headers: { "content-type": "application/json" }, method: "PATCH" });
      const body = (await res.json().catch(() => null)) as { error?: string; refund?: unknown } | null;
      if (!res.ok || !isRefundRequest(body?.refund)) throw new Error(body?.error || "Refund decision could not be saved.");
      setRequests((current) => current.map((item) => item.requestId === requestId ? body.refund as RefundRequest : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refund decision could not be saved.");
    }
  }

  return (
    <section className="arcpass-panel arcpass-refund-merchant-panel">
      <div className="arcpass-refund-panel-heading"><div><p className="arcpass-panel-label">Refund workflow</p><h3>Review payer-signed refund requests.</h3></div><button type="button" className="arcpass-ghost-button" onClick={loadRequests} disabled={!walletAddress || isLoading}>{isLoading ? "Refreshing" : "Refresh"}</button></div>
      {!walletAddress ? <p className="arcpass-empty">Connect the merchant wallet to review refund requests.</p> : requests.length === 0 ? <p className="arcpass-empty">No refund requests yet.</p> : (
        <div className="arcpass-refund-list">{requests.map((request) => <article key={request.requestId}><div className="arcpass-refund-item-head"><div><strong>{request.amount} {request.token}</strong><span>{request.invoiceId} · {shortAddress(request.payer)}</span></div><i data-status={request.status}>{request.status}</i></div><p>{request.reason}</p><small>Requested {new Date(request.createdAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</small>{request.status === "pending" ? <div className="arcpass-refund-decision"><button type="button" onClick={() => decide(request.requestId, "declined")}>Decline</button><button type="button" onClick={() => decide(request.requestId, "approved")}>Approve</button></div> : <p className="arcpass-muted">Decision recorded. Token settlement remains a separate merchant action.</p>}</article>)}</div>
      )}
      {error ? <p className="arcpass-error" role="alert">{error}</p> : null}
    </section>
  );
}

function InvoiceDetailPanel({
  item,
  onCopyLink,
  receiptHistory,
}: {
  item: SavedInvoice | null;
  onCopyLink: () => Promise<void>;
  receiptHistory: SavedReceipt[];
}) {
  if (!item) {
    return (
      <div className="arcpass-panel arcpass-invoice-detail">
        <p className="arcpass-panel-label">Invoice detail</p>
        <h3>No invoice selected.</h3>
        <p className="arcpass-muted">Create or refresh merchant invoices to inspect payment state.</p>
      </div>
    );
  }

  const { invoice } = item;
  const matchedReceipt = receiptHistory.find((receipt) => receipt.invoiceId === invoice.invoiceId) ?? null;
  const status = invoiceStatus(invoice, receiptHistory);

  return (
    <div className="arcpass-panel arcpass-invoice-detail">
      <div className="arcpass-invoice-detail-head">
        <div>
          <p className="arcpass-panel-label">Invoice detail</p>
          <h3>{invoice.description}</h3>
        </div>
        <span data-status={status}>{invoiceStatusLabel(status)}</span>
      </div>

      <div className="arcpass-generated-link">
        <a href={item.link} target="_blank" rel="noreferrer">
          {item.link}
        </a>
      </div>

      <PaymentLinkQr invoiceId={invoice.invoiceId} paymentLink={item.link} />

      <div className="arcpass-invoice-actions">
        <button type="button" onClick={() => void onCopyLink()} className="arcpass-dark-button">
          Copy link
        </button>
        <a href={item.link} target="_blank" rel="noreferrer" className="arcpass-ghost-button">
          Open checkout
        </a>
        <a href={merchantPassportLink(item)} target="_blank" rel="noreferrer" className="arcpass-ghost-button">
          Open passport
        </a>
        {matchedReceipt ? (
          <a href={matchedReceipt.explorerUrl} target="_blank" rel="noreferrer" className="arcpass-ghost-button">
            Open receipt
          </a>
        ) : null}
      </div>

      <div className="arcpass-detail-list">
        <Detail label="Invoice" value={invoice.invoiceId} />
        <Detail label="Amount" value={`${invoice.amount} ${invoice.token}`} />
        <Detail label="Merchant" value={shortAddress(invoice.merchant.walletAddress)} />
        <Detail label="Domain" value={invoice.merchant.domain} />
        <Detail label="Refund" value={invoice.merchant.refundPolicy} />
        <Detail label="Created" value={formatInvoiceDate(invoice.createdAt)} />
        <Detail label="Expires" value={formatInvoiceDate(invoice.expiresAt)} />
      </div>

      <div className="arcpass-hash-stack">
        <div>
          <p className="arcpass-panel-label">Invoice hash</p>
          <p className="arcpass-hash">{invoiceHash(invoice)}</p>
        </div>
        <div>
          <p className="arcpass-panel-label">Passport hash</p>
          <p className="arcpass-hash">{merchantPassportHash(invoice.merchant)}</p>
        </div>
      </div>

      {matchedReceipt ? (
        <div className="arcpass-success">
          <p className="arcpass-panel-label">Matched receipt</p>
          <p>
            ArcPass matched this receipt by invoice id, amount, token, and merchant wallet.
          </p>
          <a href={matchedReceipt.explorerUrl} target="_blank" rel="noreferrer">
            {matchedReceipt.txHash}
          </a>
          <div className="arcpass-detail-list">
            <Detail label="Payer" value={shortAddress(matchedReceipt.payer)} />
            <Detail label="Block" value={matchedReceipt.blockNumber} />
            <Detail label="Paid" value={formatReceiptDate(matchedReceipt.paidAt)} />
          </div>
        </div>
      ) : (
        <p className="arcpass-empty">No verified receipt has been matched to this invoice yet.</p>
      )}
    </div>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-[#191b20]">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="arcpass-detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="arcpass-metric-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PaymentOperationsSummary({ stats }: { stats: InvoiceOperationsSummary }) {
  return (
    <div className="arcpass-ops-summary">
      <MetricPill label="Links" value={String(stats.total)} />
      <MetricPill label="Awaiting" value={String(stats.awaiting)} />
      <MetricPill label="Settled" value={stats.settledValue} />
      <MetricPill label="Open value" value={stats.openValue} />
    </div>
  );
}

function ReceiptList({
  emptyLabel,
  receiptHistory,
}: {
  emptyLabel?: string;
  receiptHistory: SavedReceipt[];
}) {
  if (receiptHistory.length === 0) {
    return <p className="arcpass-empty">{emptyLabel ?? "No verified payments yet."}</p>;
  }

  return (
    <div className="arcpass-receipt-list">
      {receiptHistory.map((receipt) => (
        <article key={receipt.txHash} className="arcpass-receipt-item">
          <div className="arcpass-receipt-item-head">
            <span>
              <strong>
                {receipt.amount} {receipt.token}
              </strong>
              <em>{receipt.description}</em>
            </span>
            <b>verified</b>
          </div>
          <div className="arcpass-detail-list">
            <Detail label="Invoice" value={receipt.invoiceId} />
            <Detail label="Payer" value={shortAddress(receipt.payer)} />
            <Detail label="Merchant" value={shortAddress(receipt.merchant)} />
            <Detail label="Block" value={receipt.blockNumber} />
            <Detail label="Paid" value={formatReceiptDate(receipt.paidAt)} />
          </div>
          <div className="arcpass-receipt-actions">
            <a href={receipt.explorerUrl} target="_blank" rel="noreferrer" className="arcpass-link-preview">
              {receipt.txHash}
            </a>
            <a href={receipt.link} target="_blank" rel="noreferrer" className="arcpass-ghost-button">
              Checkout
            </a>
          </div>
        </article>
      ))}
    </div>
  );
}

function InvoiceList({
  emptyLabel,
  invoiceHistory,
  onSelectInvoice,
  receiptHistory,
  selectedInvoiceId,
}: {
  emptyLabel: string;
  invoiceHistory: SavedInvoice[];
  onSelectInvoice?: (invoice: SavedInvoice) => void;
  receiptHistory: SavedReceipt[];
  selectedInvoiceId?: string | null;
}) {
  if (invoiceHistory.length === 0) {
    return <p className="arcpass-empty">{emptyLabel}</p>;
  }

  return (
    <div className="arcpass-invoice-list">
      {invoiceHistory.map((item) => {
        const status = invoiceStatus(item.invoice, receiptHistory);

        if (onSelectInvoice) {
          const selected = selectedInvoiceId === item.invoice.invoiceId;

          return (
            <article key={item.invoice.invoiceId} className={`arcpass-invoice-list-item${selected ? " is-selected" : ""}`}>
              <button type="button" onClick={() => onSelectInvoice(item)} className="arcpass-invoice-select">
                <span>
                  <strong>{item.invoice.description}</strong>
                  <em>{item.invoice.invoiceId}</em>
                </span>
                <span className="arcpass-invoice-list-meta">
                  <b>
                    {item.invoice.amount} {item.invoice.token}
                  </b>
                  <i data-status={status}>{invoiceStatusLabel(status)}</i>
                </span>
              </button>
              <a href={item.link} target="_blank" rel="noreferrer" className="arcpass-ghost-button">
                Checkout
              </a>
            </article>
          );
        }

        return (
          <a key={item.invoice.invoiceId} href={item.link} target="_blank" rel="noreferrer">
            <span>
              <strong>{item.invoice.description}</strong>
              <em>{item.invoice.invoiceId}</em>
            </span>
            <span className="arcpass-invoice-list-meta">
              <b>
                {item.invoice.amount} {item.invoice.token}
              </b>
              <i data-status={status}>{invoiceStatusLabel(status)}</i>
            </span>
          </a>
        );
      })}
    </div>
  );
}

function summarizeInvoiceOperations(
  invoiceHistory: SavedInvoice[],
  receiptHistory: SavedReceipt[],
): InvoiceOperationsSummary {
  const summary: InvoiceOperationsSummary = {
    awaiting: 0,
    expired: 0,
    openValue: "0.00",
    settledValue: "0.00",
    total: invoiceHistory.length,
    verified: 0,
  };
  const openInvoices: SavedInvoice[] = [];
  const settledInvoices: SavedInvoice[] = [];

  for (const item of invoiceHistory) {
    const status = invoiceStatus(item.invoice, receiptHistory);
    summary[status] += 1;
    if (status === "awaiting") openInvoices.push(item);
    if (status === "verified") settledInvoices.push(item);
  }

  summary.openValue = formatTokenVolume(openInvoices.map((item) => item.invoice));
  summary.settledValue = formatTokenVolume(settledInvoices.map((item) => item.invoice));
  return summary;
}

function summarizeReceiptOperations(receiptHistory: SavedReceipt[]): ReceiptOperationsSummary {
  const latestReceipt = receiptHistory.reduce<SavedReceipt | null>((latest, receipt) => {
    if (!latest) return receipt;
    return new Date(receipt.paidAt).getTime() > new Date(latest.paidAt).getTime() ? receipt : latest;
  }, null);

  return {
    lastPaid: latestReceipt ? formatReceiptDate(latestReceipt.paidAt) : "No payments",
    total: receiptHistory.length,
    uniquePayers: new Set(receiptHistory.map((receipt) => receipt.payer.toLowerCase())).size,
    volume: formatTokenVolume(receiptHistory),
  };
}

function filterInvoices(
  invoiceHistory: SavedInvoice[],
  receiptHistory: SavedReceipt[],
  invoiceFilter: InvoiceFilter,
  invoiceQuery: string,
) {
  const query = normalizeQuery(invoiceQuery);

  return invoiceHistory.filter((item) => {
    const status = invoiceStatus(item.invoice, receiptHistory);
    if (invoiceFilter !== "all" && status !== invoiceFilter) return false;
    if (!query) return true;

    return [
      item.invoice.amount,
      item.invoice.description,
      item.invoice.invoiceId,
      item.invoice.merchant.domain,
      item.invoice.merchant.walletAddress,
      item.invoice.token,
      item.link,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function filterReceipts(receiptHistory: SavedReceipt[], receiptQuery: string) {
  const query = normalizeQuery(receiptQuery);
  if (!query) return receiptHistory;

  return receiptHistory.filter((receipt) =>
    [
      receipt.amount,
      receipt.description,
      receipt.invoiceId,
      receipt.merchant,
      receipt.payer,
      receipt.token,
      receipt.txHash,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}

function invoiceFilterCount(stats: InvoiceOperationsSummary, filter: InvoiceFilter) {
  if (filter === "all") return stats.total;
  return stats[filter];
}

function normalizeQuery(value: string) {
  return value.trim().toLowerCase();
}

function formatTokenVolume(items: Array<{ amount: string; token: ArcPassTokenSymbol }>) {
  const totals = new Map<ArcPassTokenSymbol, number>();

  for (const item of items) {
    const amount = Number.parseFloat(item.amount);
    if (!Number.isFinite(amount)) continue;
    totals.set(item.token, (totals.get(item.token) ?? 0) + amount);
  }

  if (totals.size === 0) return "0.00";

  return Array.from(totals.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([token, amount]) => `${formatVolumeAmount(amount)} ${token}`)
    .join(" + ");
}

function formatVolumeAmount(value: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

function exportInvoiceReport(items: SavedInvoice[], receiptHistory: SavedReceipt[]) {
  const rows = items.map((item) => {
    const receipt = receiptHistory.find((candidate) => candidate.invoiceId === item.invoice.invoiceId);

    return [
      invoiceStatusLabel(invoiceStatus(item.invoice, receiptHistory)),
      item.invoice.createdAt,
      item.invoice.expiresAt,
      item.invoice.invoiceId,
      item.invoice.description,
      item.invoice.amount,
      item.invoice.token,
      item.invoice.merchant.businessName,
      item.invoice.merchant.domain,
      item.invoice.merchant.walletAddress,
      item.link,
      receipt?.txHash ?? "",
    ];
  });

  downloadCsv(`arcpass-invoices-${reportFileDate()}.csv`, [
    [
      "Status",
      "Created At",
      "Expires At",
      "Invoice ID",
      "Description",
      "Amount",
      "Token",
      "Merchant",
      "Domain",
      "Merchant Wallet",
      "Checkout Link",
      "Receipt Transaction",
    ],
    ...rows,
  ]);
}

function exportReceiptReport(receipts: SavedReceipt[]) {
  downloadCsv(`arcpass-receipts-${reportFileDate()}.csv`, [
    [
      "Status",
      "Paid At",
      "Invoice ID",
      "Description",
      "Amount",
      "Token",
      "Payer",
      "Merchant Wallet",
      "Transaction Hash",
      "Block",
      "Explorer URL",
      "Checkout Link",
    ],
    ...receipts.map((receipt) => [
      "Verified",
      receipt.paidAt,
      receipt.invoiceId,
      receipt.description,
      receipt.amount,
      receipt.token,
      receipt.payer,
      receipt.merchant,
      receipt.txHash,
      receipt.blockNumber,
      receipt.explorerUrl,
      receipt.link,
    ]),
  ]);
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}


function reportFileDate() {
  return new Date().toISOString().slice(0, 10);
}

function formatReceiptDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";

  return date.toLocaleString("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

function formatInvoiceDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";

  return date.toLocaleString("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function defaultExpiryInput() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}
