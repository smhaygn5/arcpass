"use client";

import { useMemo, useState } from "react";
import type { Address } from "viem";
import {
  summarizeUnifiedUsdcBalance,
  type GatewayBalanceRecord,
  type GatewayDepositRecord,
} from "@/lib/unified-usdc-balance";
import {
  getConnectedWalletAddress,
  requestVerifiedWalletAddressSelection,
  walletErrorMessage,
} from "@/lib/wallet";
import { shortAddress } from "@/lib/format";

type BalanceStatus = "idle" | "loading" | "ready" | "error";

type GatewayBalanceApiResponse = {
  address?: Address;
  balances?: GatewayBalanceRecord[];
  error?: string;
  pendingDeposits?: GatewayDepositRecord[];
};

export function UnifiedUsdcBalance({ requiredAmount }: { requiredAmount: string }) {
  const [address, setAddress] = useState<Address | null>(null);
  const [balances, setBalances] = useState<GatewayBalanceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeposits, setPendingDeposits] = useState<GatewayDepositRecord[]>([]);
  const [status, setStatus] = useState<BalanceStatus>("idle");
  const summary = useMemo(() => summarizeUnifiedUsdcBalance({ balances, pendingDeposits, requiredAmount }), [balances, pendingDeposits, requiredAmount]);

  async function loadBalance() {
    setStatus("loading");
    setError(null);

    try {
      const walletAddress = await getConnectedWalletAddress() ?? await requestVerifiedWalletAddressSelection();
      const response = await fetch("/api/gateway-balances", {
        body: JSON.stringify({ address: walletAddress }),
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = (await response.json().catch(() => null)) as GatewayBalanceApiResponse | null;
      if (!response.ok) throw new Error(data?.error || "The Gateway balance could not be loaded.");

      setAddress(walletAddress);
      setBalances(Array.isArray(data?.balances) ? data.balances : []);
      setPendingDeposits(Array.isArray(data?.pendingDeposits) ? data.pendingDeposits : []);
      setStatus("ready");
    } catch (err) {
      setError(walletErrorMessage(err));
      setStatus("error");
    }
  }

  return (
    <div className="arcpass-unified-balance" data-status={status}>
      <div className="arcpass-unified-heading">
        <div className="arcpass-unified-title">
          <span aria-hidden="true">U</span>
          <div>
            <strong>Unified USDC balance</strong>
            <small>{address ? `${shortAddress(address)} · Circle Gateway` : "Circle Gateway · four testnets"}</small>
          </div>
        </div>
        <button type="button" className="arcpass-unified-refresh" onClick={() => void loadBalance()} disabled={status === "loading"}>
          {status === "loading" ? "Reading Gateway" : status === "ready" ? "Refresh" : "Load balance"}
        </button>
      </div>

      {status === "ready" ? (
        <>
          <div className="arcpass-unified-overview">
            <div>
              <span>Gateway available</span>
              <strong>{summary.total} <small>USDC</small></strong>
            </div>
            <div>
              <span>Checkout target</span>
              <strong>{summary.required} <small>USDC</small></strong>
            </div>
            <div className="arcpass-unified-readiness" data-ready={summary.coversRequired}>
              <span>{summary.coversRequired ? "Ready balance" : "Balance gap"}</span>
              <strong>{summary.coversRequired ? "Covered" : `${summary.shortfall} USDC short`}</strong>
            </div>
          </div>
          <div className="arcpass-unified-progress" aria-label={`${summary.coveragePercentage}% of checkout target available`}>
            <span style={{ width: `${summary.coveragePercentage}%` }} />
          </div>
          <div className="arcpass-unified-allocations">
            {summary.allocations.map((allocation) => (
              <div key={allocation.domain}>
                <span className="arcpass-unified-chain-mark" data-chain={allocation.id}>{allocation.shortLabel.slice(0, 1)}</span>
                <div><strong>{allocation.shortLabel}</strong><small>{allocation.label}</small></div>
                <span className="arcpass-unified-chain-bar"><i style={{ width: `${allocation.percentage}%` }} /></span>
                <b>{allocation.amount} USDC</b>
              </div>
            ))}
          </div>
          {summary.pendingRaw > 0n ? <p className="arcpass-unified-pending">{summary.pending} USDC is pending Gateway finality and is not included in the available total yet.</p> : null}
        </>
      ) : (
        <div className="arcpass-unified-empty">
          <div><span>ETH</span><span>BASE</span><span>ARB</span><span>ARC</span></div>
          <p>Connect an EVM wallet to read the USDC it has already deposited into Circle Gateway across supported testnets.</p>
        </div>
      )}

      {error ? <p className="arcpass-error" role="alert">{error}</p> : null}
      <p className="arcpass-unified-disclosure">Gateway-deposited USDC only — this does not include ordinary wallet balances. This view is read-only; direct Arc payment and CCTP checkout remain available below.</p>
    </div>
  );
}
