"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  type Address,
  type Hash,
} from "viem";
import {
  arcTestnet,
  arcTestnetTransport,
  ARC_TESTNET_NETWORK,
} from "@/lib/arc-chain";
import {
  ARCPASS_TOKENS,
  formatInvoiceAmount,
  invoiceAmountRaw,
  invoiceExpired,
  invoiceHash,
  merchantExplorerUrl,
  paymentReceiptUrl,
  trustLabel,
  trustScore,
  type ArcPassInvoice,
  type ArcPassTokenSymbol,
} from "@/lib/arcpass";
import { saveVerifiedReceipt } from "@/lib/receipts";
import {
  ensurePaymentNetwork,
  getBrowserWalletProvider,
  requestVerifiedWalletAddressSelection,
  subscribeWalletEvents,
  walletErrorMessage,
} from "@/lib/wallet";
import { ArcPassMark } from "@/components/ArcPassMark";
import { shortAddress } from "@/lib/format";

const erc20Abi = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: arcTestnetTransport(),
});
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

type PaymentStatus = "idle" | "connecting" | "ready" | "paying" | "verifying" | "paid" | "error";
type VerifiedReceipt = {
  amount: string;
  blockNumber: string;
  explorerUrl: string;
  invoiceId: string;
  merchant: Address;
  payer: Address;
  token: ArcPassTokenSymbol;
  txHash: Hash;
  verified: true;
};

export function ArcPaymentPanel({
  invoice,
  payload,
}: {
  invoice: ArcPassInvoice;
  payload: string;
}) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualTxHash, setManualTxHash] = useState("");
  const [payer, setPayer] = useState<Address | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [status, setStatus] = useState<PaymentStatus>("idle");
  const [txHash, setTxHash] = useState<Hash | null>(null);
  const [verifiedReceipt, setVerifiedReceipt] = useState<VerifiedReceipt | null>(null);
  const [publicReceipt, setPublicReceipt] = useState<VerifiedReceipt | null>(null);
  const [publicStateError, setPublicStateError] = useState<string | null>(null);
  const [isLoadingPublicState, setIsLoadingPublicState] = useState(true);
  const [isRegistered, setIsRegistered] = useState<boolean | null>(null);
  const amountRaw = useMemo(() => invoiceAmountRaw(invoice), [invoice]);
  const merchantAddress = invoice.merchant.walletAddress;
  const token = ARCPASS_TOKENS[invoice.token];
  const score = trustScore(invoice.merchant);
  const expired = invoiceExpired(invoice);
  const hasEnoughBalance = balance == null ? null : balance >= amountRaw;

  useEffect(() => {
    async function loadPublicInvoiceState() {
      setIsLoadingPublicState(true);
      setPublicStateError(null);

      try {
        const res = await fetch(`/api/public-invoice-state?payload=${encodeURIComponent(payload)}`, {
          cache: "no-store",
        });
        const body = (await res.json().catch(() => null)) as
          | { error?: string; paid?: boolean; receipt?: VerifiedReceipt | null; registered?: boolean }
          | null;

        if (!res.ok) {
          throw new Error(body?.error || "Invoice state could not be checked.");
        }

        setIsRegistered(body?.registered === true);

        if (body?.paid && body.receipt) {
          setPublicReceipt(body.receipt);
          setVerifiedReceipt(body.receipt);
          setStatus("paid");
        }
      } catch (err) {
        setPublicStateError(err instanceof Error ? err.message : "Invoice state could not be checked.");
      } finally {
        setIsLoadingPublicState(false);
      }
    }

    void loadPublicInvoiceState();
  }, [payload]);

  useEffect(() => {
    if (!payer) return;
    void refreshBalance(payer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payer, invoice.token]);

  useEffect(() => {
    return subscribeWalletEvents(() => {
      setBalance(null);
      setError(null);
      setPayer(null);
      setReceiptError(null);
      setStatus("idle");
    });
  }, []);

  async function connectWallet() {
    setStatus("connecting");
    setError(null);

    try {
      await ensurePaymentNetwork(ARC_TESTNET_NETWORK);
      const address = await requestVerifiedWalletAddressSelection();
      setPayer(address);
      setStatus("ready");
      await refreshBalance(address);
    } catch (err) {
      setError(walletErrorMessage(err));
      setStatus("error");
    }
  }

  async function refreshBalance(address: Address) {
    const value = await publicClient.readContract({
      abi: erc20Abi,
      address: token.address,
      args: [address],
      functionName: "balanceOf",
    });
    setBalance(value);
  }

  async function payInvoice() {
    if (isRegistered !== true) {
      setError("ArcPass could not confirm this invoice registration. Do not send a payment.");
      setStatus("error");
      return;
    }

    if (publicReceipt) {
      setError("This invoice already has a verified receipt. Do not pay the same link again.");
      setStatus("paid");
      return;
    }

    if (expired) {
      setError("This invoice is expired.");
      setStatus("error");
      return;
    }

    setStatus("paying");
    setError(null);
    setReceiptError(null);
    setVerifiedReceipt(null);

    try {
      await ensurePaymentNetwork(ARC_TESTNET_NETWORK);
      const address = await requestVerifiedWalletAddressSelection();
      setPayer(address);

      if (address.toLowerCase() === merchantAddress.toLowerCase()) {
        throw new Error("Buyer wallet cannot be the same as the merchant wallet. Use a different wallet for a real checkout test.");
      }

      const provider = await getBrowserWalletProvider();
      const walletClient = createWalletClient({
        account: address,
        chain: arcTestnet,
        transport: custom(provider),
      });

      const hash = await walletClient.writeContract({
        abi: erc20Abi,
        address: token.address,
        args: [merchantAddress, amountRaw],
        functionName: "transfer",
      });
      setTxHash(hash);
      setManualTxHash(hash);

      const receipt = await publicClient.waitForTransactionReceipt({
        confirmations: 2,
        hash,
      });
      if (receipt.status !== "success") {
        throw new Error("The transaction was mined but did not succeed.");
      }

      setStatus("verifying");
      const verified = await verifyPayment(hash, address);
      await refreshBalance(address);
      setVerifiedReceipt(verified);
      setPublicReceipt(verified);
      saveVerifiedReceipt({ invoice, payload, receipt: verified });
      setStatus("paid");
    } catch (err) {
      setError(walletErrorMessage(err));
      setStatus("error");
    }
  }

  async function verifyExistingReceipt() {
    if (isRegistered !== true) {
      setReceiptError("ArcPass could not confirm this invoice registration.");
      setStatus("error");
      return;
    }

    const hash = manualTxHash.trim();

    if (!TX_HASH_PATTERN.test(hash)) {
      setReceiptError("Paste a valid Arc transaction hash.");
      return;
    }

    setStatus("verifying");
    setError(null);
    setReceiptError(null);
    setTxHash(hash as Hash);
    setVerifiedReceipt(null);

    try {
      const verified = await verifyPayment(hash as Hash, payer ?? undefined);
      setVerifiedReceipt(verified);
      setPublicReceipt(verified);
      saveVerifiedReceipt({ invoice, payload, receipt: verified });
      setStatus("paid");
    } catch (err) {
      setError(walletErrorMessage(err));
      setStatus("error");
    }
  }

  async function verifyPayment(hash: Hash, payerAddress?: Address) {
    const res = await fetch("/api/payments/verify", {
      body: JSON.stringify({ ...(payerAddress ? { payer: payerAddress } : {}), payload, txHash: hash }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body = await res.json();

    if (!res.ok || !body.verified) {
      const message = body.error || "Payment was submitted, but ArcPass could not verify the receipt.";
      setReceiptError(message);
      throw new Error(message);
    }

    return body as VerifiedReceipt;
  }

  return (
    <section className="arcpass-page arcpass-checkout-page">
      <div className="arcpass-checkout-shell">
        <div className="arcpass-checkout-hero">
          <div className="arcpass-hero-background" aria-hidden="true" />
          <nav className="arcpass-checkout-nav">
            <ArcPassMark />
            <span>
              {expired
                ? "Expired"
                : status === "paid"
                  ? "Receipt verified"
                  : status === "verifying"
                    ? "Verifying receipt"
                    : "Awaiting payment"}
            </span>
          </nav>

          <div className="arcpass-checkout-content">
            <div className="arcpass-checkout-copy">
              <p className="arcpass-eyebrow">Verified invoice</p>
              <h1>{invoice.description}</h1>
              <p>
                Pay {invoice.amount} {invoice.token} to a merchant passport linked with{" "}
                {invoice.merchant.domain}. The invoice hash below locks the amount, token, merchant, and expiry.
              </p>
            </div>

            <aside className="arcpass-checkout-paybox">
              <p className="arcpass-panel-label">Amount due</p>
              <strong>
                {invoice.amount} {invoice.token}
              </strong>
              <div className="arcpass-pay-actions">
                <button
                  type="button"
                  onClick={connectWallet}
                  disabled={status === "connecting" || status === "paying"}
                  className="arcpass-ghost-button"
                >
                  {status === "connecting" ? "Connecting" : payer ? `Switch ${shortAddress(payer)}` : "Connect wallet"}
                </button>
                <button
                  type="button"
                  onClick={payInvoice}
                  disabled={isRegistered !== true || expired || Boolean(publicReceipt) || status === "paying" || status === "verifying" || status === "paid"}
                  className="arcpass-dark-button"
                >
                  {status === "paying"
                    ? "Waiting for wallet"
                    : status === "verifying"
                      ? "Verifying"
                      : status === "paid"
                        ? "Verified"
                        : "Pay now"}
                </button>
              </div>
              {publicReceipt ? (
                <p className="arcpass-checkout-warning">This invoice already has a verified receipt.</p>
              ) : null}
              {isLoadingPublicState ? (
                <p className="arcpass-muted">Confirming ArcPass invoice registration.</p>
              ) : isRegistered !== true ? (
                <p className="arcpass-checkout-warning" role="alert">Payment is disabled because this invoice is not registered by ArcPass.</p>
              ) : null}
            </aside>
          </div>

          <ArcPassMark compact className="arcpass-corner-logo" />
        </div>

        <div className="arcpass-checkout-grid">
          <div className="arcpass-panel">
            <p className="arcpass-panel-label">Invoice lock</p>
            <h3>{invoice.invoiceId}</h3>
            <p className="arcpass-hash">{invoiceHash(invoice)}</p>
            <div className="arcpass-detail-list">
              <Detail label="Network" value="Arc Testnet" />
              <Detail
                label="Status"
                value={
                  expired
                    ? "Expired"
                    : status === "paid"
                      ? "Receipt verified"
                      : status === "verifying"
                        ? "Verifying receipt"
                        : "Awaiting payment"
                }
              />
              <Detail label="Token" value={invoice.token} />
            </div>
          </div>

          <aside className="arcpass-panel">
            <p className="arcpass-panel-label">Merchant Passport</p>
            <h3>{invoice.merchant.businessName}</h3>
            <div className="arcpass-detail-list">
              <Detail label="Trust score" value={`${score}/100`} />
              <Detail label="Signal" value={trustLabel(score)} />
              <Detail label="Domain" value={invoice.merchant.domain} />
              <Detail label="Refund" value={invoice.merchant.refundPolicy} />
              <Detail label="Wallet" value={shortAddress(invoice.merchant.walletAddress)} />
            </div>
            <a href={merchantExplorerUrl(invoice.merchant)} target="_blank" rel="noreferrer" className="arcpass-link-preview">
              View merchant wallet
            </a>
          </aside>
        </div>

        <div className="arcpass-checkout-grid">
          <div className="arcpass-panel arcpass-panel-large">
            <p className="arcpass-panel-label">Buyer trust preview</p>
            <h3>Review the merchant and invoice before signing anything.</h3>
            <div className="arcpass-trust-preview">
              <TrustPreviewItem label="ArcPass registry" value={isLoadingPublicState ? "Checking" : isRegistered ? "Server-issued" : "Not registered"} />
              <TrustPreviewItem label="Business" value={invoice.merchant.businessName} />
              <TrustPreviewItem label="Domain" value={invoice.merchant.domain} />
              <TrustPreviewItem label="Wallet" value={shortAddress(invoice.merchant.walletAddress)} />
              <TrustPreviewItem label="Refund policy" value={invoice.merchant.refundPolicy} />
              <TrustPreviewItem label="Trust score" value={`${score}/100 ${trustLabel(score)}`} />
              <TrustPreviewItem label="Invoice hash" value={invoiceHash(invoice)} mono />
            </div>
          </div>

          <aside className="arcpass-panel">
            <p className="arcpass-panel-label">Payment timeline</p>
            <PaymentTimeline
              connected={Boolean(payer)}
              hasPublicReceipt={Boolean(publicReceipt)}
              isCheckingPublicState={isLoadingPublicState}
              isRegistered={isRegistered}
              status={status}
              txHash={txHash}
            />
            {publicStateError ? (
              <p className="arcpass-error" role="alert">
                {publicStateError}
              </p>
            ) : null}
          </aside>
        </div>

        <div className="arcpass-panel">
          <p className="arcpass-panel-label">Payment state</p>
          <p className="arcpass-muted">
            Payment sends exactly {formatInvoiceAmount(amountRaw, invoice.token)} {invoice.token} to the verified merchant wallet.
          </p>

          {payer ? (
            <p className="arcpass-muted">
              Wallet balance:{" "}
              <span className="arcpass-code">
                {balance == null ? "Loading" : `${formatInvoiceAmount(balance, invoice.token)} ${invoice.token}`}
              </span>
              {hasEnoughBalance === false ? " - balance is below the invoice amount." : ""}
            </p>
          ) : null}

          <div className="arcpass-wallet-compare">
            <Detail label="Buyer wallet" value={payer ? shortAddress(payer) : "Not selected"} />
            <Detail label="Merchant wallet" value={shortAddress(merchantAddress)} />
          </div>

          {!verifiedReceipt ? (
            <div className="arcpass-receipt-check">
              <label>
                <span>Verify existing transaction hash</span>
                <input
                  value={manualTxHash}
                  onChange={(event) => setManualTxHash(event.target.value)}
                  placeholder="0x..."
                />
              </label>
              <button
                type="button"
                onClick={verifyExistingReceipt}
                disabled={isRegistered !== true || status === "verifying"}
                className="arcpass-ghost-button"
              >
                {status === "verifying" ? "Verifying" : "Verify receipt"}
              </button>
            </div>
          ) : null}

          {txHash && !verifiedReceipt ? (
            <p className={receiptError ? "arcpass-error" : "arcpass-success"}>
              Transaction submitted:{" "}
              <a href={paymentReceiptUrl(txHash)} target="_blank" rel="noreferrer">
                {txHash}
              </a>
            </p>
          ) : null}

          {verifiedReceipt ? (
            <div className="arcpass-success">
              <p className="arcpass-panel-label">Verified receipt</p>
              <p>
                ArcPass matched this transaction to the locked invoice amount, token, and merchant wallet.
              </p>
              <a href={verifiedReceipt.explorerUrl} target="_blank" rel="noreferrer">
                {verifiedReceipt.txHash}
              </a>
              <div className="arcpass-detail-list">
                <Detail label="Invoice" value={verifiedReceipt.invoiceId} />
                <Detail label="Amount" value={`${verifiedReceipt.amount} ${verifiedReceipt.token}`} />
                <Detail label="Payer" value={shortAddress(verifiedReceipt.payer)} />
                <Detail label="Merchant" value={shortAddress(verifiedReceipt.merchant)} />
                <Detail label="Block" value={verifiedReceipt.blockNumber} />
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="arcpass-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
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

function TrustPreviewItem({
  label,
  mono = false,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div className="arcpass-trust-preview-item">
      <span>{label}</span>
      <strong className={mono ? "is-mono" : ""}>{value}</strong>
    </div>
  );
}

function PaymentTimeline({
  connected,
  hasPublicReceipt,
  isCheckingPublicState,
  isRegistered,
  status,
  txHash,
}: {
  connected: boolean;
  hasPublicReceipt: boolean;
  isCheckingPublicState: boolean;
  isRegistered: boolean | null;
  status: PaymentStatus;
  txHash: Hash | null;
}) {
  const submitted = Boolean(txHash) || status === "verifying" || status === "paid";
  const verified = hasPublicReceipt || status === "paid";
  const steps = [
    {
      active: !isCheckingPublicState && isRegistered === true,
      detail: isCheckingPublicState ? "Checking ArcPass registry" : isRegistered !== true ? "Invoice registration failed" : hasPublicReceipt ? "Existing receipt found" : "Server-issued invoice confirmed",
      label: "Invoice opened",
    },
    {
      active: connected,
      detail: connected ? "Buyer wallet selected" : "Waiting for buyer wallet",
      label: "Wallet connected",
    },
    {
      active: submitted,
      detail: txHash ? "Transaction submitted on Arc" : "Waiting for payment",
      label: "Payment submitted",
    },
    {
      active: verified,
      detail: verified ? "Receipt matched" : "Waiting for ArcPass verification",
      label: "Receipt verified",
    },
  ];

  return (
    <ol className="arcpass-payment-timeline">
      {steps.map((step) => (
        <li key={step.label} className={step.active ? "is-active" : ""}>
          <span aria-hidden="true" />
          <div>
            <strong>{step.label}</strong>
            <em>{step.detail}</em>
          </div>
        </li>
      ))}
    </ol>
  );
}
