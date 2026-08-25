"use client";

import { useMemo, useState } from "react";
import {
  createPublicClient,
  formatEther,
  formatUnits,
  http,
  parseUnits,
  type Address,
  type EIP1193Provider,
} from "viem";
import type { BridgeResult, EstimateResult } from "@circle-fin/bridge-kit";
import type { ArcPassInvoice } from "@/lib/arcpass";
import {
  ARC_PAYMENT_GAS_RESERVE_USDC,
  CROSS_CHAIN_SOURCES,
  crossChainCheckoutSupported,
  crossChainFundingAmount,
  crossChainPreflight,
  type CrossChainSourceId,
} from "@/lib/cross-chain-checkout";
import {
  ensurePaymentNetwork,
  getBrowserWalletProvider,
  getConnectedWalletAddress,
  requestVerifiedWalletAddressSelection,
  walletErrorMessage,
} from "@/lib/wallet";
import { shortAddress } from "@/lib/format";
import { UnifiedUsdcBalance } from "@/components/UnifiedUsdcBalance";

const balanceAbi = [{
  inputs: [{ name: "account", type: "address" }],
  name: "balanceOf",
  outputs: [{ name: "", type: "uint256" }],
  stateMutability: "view",
  type: "function",
}] as const;

type CrossChainStatus = "idle" | "checking" | "ready" | "bridging" | "complete" | "error";

export function CrossChainCheckout({
  disabledReason,
  invoice,
  onContinueToArc,
}: {
  disabledReason: string | null;
  invoice: ArcPassInvoice;
  onContinueToArc: () => Promise<void>;
}) {
  const [bridgeResult, setBridgeResult] = useState<BridgeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [sourceAddress, setSourceAddress] = useState<Address | null>(null);
  const [sourceGasBalance, setSourceGasBalance] = useState<bigint | null>(null);
  const [sourceId, setSourceId] = useState<CrossChainSourceId>("ethereum-sepolia");
  const [sourceUsdcBalance, setSourceUsdcBalance] = useState<bigint | null>(null);
  const [status, setStatus] = useState<CrossChainStatus>("idle");
  const source = CROSS_CHAIN_SOURCES[sourceId];
  const supported = crossChainCheckoutSupported(invoice.token);
  const bridgeAmount = supported ? crossChainFundingAmount(invoice.amount) : "0";
  const bridgeAmountRaw = supported ? parseUnits(bridgeAmount, 6) : 0n;
  const sourceGasRequired = useMemo(() => estimateSourceGas(estimate), [estimate]);
  const preflight = crossChainPreflight({ bridgeAmountRaw, sourceGasBalance, sourceGasRequired, sourceUsdcBalance });
  const canBridge = !disabledReason && status === "ready" && preflight.gasReady === true && preflight.tokenReady === true;

  function selectSource(nextSource: CrossChainSourceId) {
    setSourceId(nextSource);
    setSourceAddress(null);
    setSourceGasBalance(null);
    setSourceUsdcBalance(null);
    setEstimate(null);
    setBridgeResult(null);
    setError(null);
    setStatus("idle");
  }

  async function checkRoute() {
    if (!supported || disabledReason) return;
    setStatus("checking");
    setError(null);
    setEstimate(null);
    setBridgeResult(null);

    try {
      await ensurePaymentNetwork(source.network);
      const address = await requestVerifiedWalletAddressSelection();
      const provider = await getBrowserWalletProvider();
      const publicClient = createPublicClient({ chain: source.chain, transport: http(undefined, { timeout: 12_000 }) });
      const [usdcBalance, gasBalance] = await Promise.all([
        publicClient.readContract({ abi: balanceAbi, address: source.usdcAddress, args: [address], functionName: "balanceOf" }),
        publicClient.getBalance({ address }),
      ]);
      setSourceAddress(address);
      setSourceUsdcBalance(usdcBalance);
      setSourceGasBalance(gasBalance);

      const { BridgeKit, TransferSpeed } = await import("@circle-fin/bridge-kit");
      const { createViemAdapterFromProvider } = await import("@circle-fin/adapter-viem-v2");
      const adapter = await createViemAdapterFromProvider({ provider: provider as EIP1193Provider });
      const kit = new BridgeKit({ disableErrorReporting: true });
      const routeEstimate = await kit.estimate({
        amount: bridgeAmount,
        config: { batchTransactions: false, transferSpeed: TransferSpeed.SLOW },
        from: { adapter, chain: source.bridgeChain },
        to: { adapter, chain: "Arc_Testnet" },
        token: "USDC",
      });
      setEstimate(routeEstimate);
      const readiness = crossChainPreflight({
        bridgeAmountRaw,
        sourceGasBalance: gasBalance,
        sourceGasRequired: estimateSourceGas(routeEstimate),
        sourceUsdcBalance: usdcBalance,
      });
      if (readiness.tokenReady !== true) throw new Error(`This wallet needs at least ${bridgeAmount} USDC on ${source.label}.`);
      if (readiness.gasReady !== true) throw new Error(`This wallet needs more ETH on ${source.label} for source-network gas.`);
      setStatus("ready");
    } catch (err) {
      setError(walletErrorMessage(err));
      setStatus("error");
    }
  }

  async function bridgeFunds() {
    if (!canBridge || !sourceAddress) return;
    setStatus("bridging");
    setError(null);
    setBridgeResult(null);

    try {
      await ensurePaymentNetwork(source.network);
      const connectedAddress = await getConnectedWalletAddress();
      if (!connectedAddress || connectedAddress.toLowerCase() !== sourceAddress.toLowerCase()) {
        throw new Error("The connected wallet changed after route estimation. Recheck the route with the wallet that will bridge funds.");
      }
      const provider = await getBrowserWalletProvider();
      const { BridgeKit, TransferSpeed } = await import("@circle-fin/bridge-kit");
      const { createViemAdapterFromProvider } = await import("@circle-fin/adapter-viem-v2");
      const adapter = await createViemAdapterFromProvider({ provider: provider as EIP1193Provider });
      const kit = new BridgeKit({ disableErrorReporting: true });
      const result = await kit.bridge({
        amount: bridgeAmount,
        config: { batchTransactions: false, transferSpeed: TransferSpeed.SLOW },
        from: { adapter, chain: source.bridgeChain },
        to: { adapter, chain: "Arc_Testnet" },
        token: "USDC",
      });
      setBridgeResult(result);
      if (result.state !== "success") {
        const failedStep = result.steps.find((step) => step.state === "error");
        throw new Error(failedStep?.errorMessage || "The CCTP bridge did not complete.");
      }
      setStatus("complete");
    } catch (err) {
      setError(walletErrorMessage(err));
      setStatus("error");
    }
  }

  return (
    <section className="arcpass-panel arcpass-cross-chain-panel">
      <div className="arcpass-cross-chain-heading">
        <div><p className="arcpass-panel-label">Cross-chain checkout</p><h3>Bring USDC to Arc before paying.</h3><p>ArcPass uses Circle CCTP Standard Transfer. Bridge preparation and invoice payment remain two explicit wallet actions.</p></div>
        <span data-state={status}>{status === "complete" ? "Funds prepared" : status === "bridging" ? "Bridging" : "Testnet"}</span>
      </div>
      {!supported ? (
        <p className="arcpass-cross-chain-notice">Cross-chain funding is currently available for USDC invoices. EURC invoices continue through the direct Arc payment path.</p>
      ) : (
        <>
          <UnifiedUsdcBalance requiredAmount={bridgeAmount} />
          <div className="arcpass-source-network-list" aria-label="Source testnet">
            {(Object.entries(CROSS_CHAIN_SOURCES) as [CrossChainSourceId, typeof source][]).map(([id, option]) => (
              <button key={id} type="button" onClick={() => selectSource(id)} aria-pressed={sourceId === id} disabled={status === "checking" || status === "bridging"}>
                <span>{option.shortLabel.slice(0, 1)}</span><strong>{option.shortLabel}</strong><small>Sepolia</small>
              </button>
            ))}
          </div>
          <div className="arcpass-cross-chain-route">
            <div><span>You prepare</span><strong>{bridgeAmount} USDC</strong><small>{invoice.amount} invoice + {ARC_PAYMENT_GAS_RESERVE_USDC} Arc gas reserve</small></div>
            <b aria-hidden="true">→</b>
            <div><span>Destination</span><strong>Arc Testnet</strong><small>Then send exactly {invoice.amount} USDC to the merchant</small></div>
          </div>
          <div className="arcpass-cross-chain-checks">
            <RouteCheck label="Source wallet" value={sourceAddress ? shortAddress(sourceAddress) : "Not checked"} ready={sourceAddress ? true : null} />
            <RouteCheck label={`${source.shortLabel} USDC`} value={sourceUsdcBalance === null ? "Check balance" : `${formatUnits(sourceUsdcBalance, 6)} USDC`} ready={preflight.tokenReady} />
            <RouteCheck label="Source gas" value={sourceGasBalance === null ? "Check ETH" : `${formatBalance(sourceGasBalance)} ETH`} ready={preflight.gasReady} />
            <RouteCheck label="CCTP route" value={estimate ? "Standard route estimated" : "Estimate required"} ready={estimate ? true : null} />
          </div>
          {estimate ? <BridgeEstimateSummary estimate={estimate} /> : null}
          {bridgeResult ? <BridgeStepList result={bridgeResult} /> : null}
          <div className="arcpass-cross-chain-actions">
            <button type="button" className="arcpass-ghost-button" onClick={() => void checkRoute()} disabled={Boolean(disabledReason) || status === "checking" || status === "bridging"}>
              {status === "checking" ? "Checking route" : estimate ? "Recheck route" : "Check wallet & estimate"}
            </button>
            {status === "complete" ? (
              <button type="button" className="arcpass-dark-button" onClick={() => void onContinueToArc()}>Continue to Arc payment</button>
            ) : (
              <button type="button" className="arcpass-dark-button" onClick={() => void bridgeFunds()} disabled={!canBridge}>
                {status === "bridging" ? "Follow wallet steps" : "Bridge USDC to Arc"}
              </button>
            )}
          </div>
          {disabledReason ? <p className="arcpass-cross-chain-notice">{disabledReason}</p> : null}
          {error ? <p className="arcpass-error" role="alert">{error}</p> : null}
          <p className="arcpass-muted">Testnet assets have no financial value. Review every wallet prompt; ArcPass never asks for a private key.</p>
        </>
      )}
    </section>
  );
}

function RouteCheck({ label, ready, value }: { label: string; ready: boolean | null; value: string }) {
  return <div data-ready={ready === true} data-blocked={ready === false}><span>{ready === true ? "✓" : ready === false ? "!" : "·"}</span><strong>{label}</strong><small>{value}</small></div>;
}

function BridgeEstimateSummary({ estimate }: { estimate: EstimateResult }) {
  const protocolFees = estimate.fees.map((fee) => `${fee.amount ?? "Pending"} ${fee.token}`).join(" · ") || "0 USDC";
  const gasFees = estimate.gasFees.map((fee) => fee.fees ? `${formatGasFee(fee.fees.fee)} ${fee.token}` : `${fee.token} pending`).join(" · ") || "Wallet estimate";
  return <div className="arcpass-cross-chain-estimate"><div><span>Protocol fee</span><strong>{protocolFees}</strong></div><div><span>Estimated network gas</span><strong>{gasFees}</strong></div><div><span>Transfer mode</span><strong>Standard CCTP · exact amount</strong></div></div>;
}

function BridgeStepList({ result }: { result: BridgeResult }) {
  return <div className="arcpass-bridge-steps">{result.steps.map((step, index) => <div key={`${step.name}-${index}`} data-state={step.state}><span>{step.state === "success" || step.state === "noop" ? "✓" : step.state === "error" ? "!" : "·"}</span><div><strong>{step.name}</strong><small>{step.state}</small></div>{step.explorerUrl ? <a href={step.explorerUrl} target="_blank" rel="noreferrer">Explorer</a> : null}</div>)}</div>;
}

function estimateSourceGas(estimate: EstimateResult | null) {
  if (!estimate) return null;
  const sourceFees = estimate.gasFees.filter((item) => item.token === "ETH" && item.fees?.fee);
  return sourceFees.reduce((sum, item) => sum + BigInt(item.fees?.fee ?? "0"), 0n);
}

function formatBalance(value: bigint) {
  return Number.parseFloat(formatEther(value)).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function formatGasFee(value: string) {
  try {
    return Number.parseFloat(formatEther(BigInt(value))).toLocaleString("en-US", { maximumFractionDigits: 6 });
  } catch {
    return "Pending";
  }
}
