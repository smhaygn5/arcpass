"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import type { Address, Hex } from "viem";
import type { CircleEmbeddedWallet } from "@/lib/embedded-wallet";
import { shortAddress } from "@/lib/format";

type WalletMode = "browser" | "embedded";
type CircleAuthentication = { encryptionKey: string; userToken: string };
type LoginResult = CircleAuthentication & { refreshToken?: string };
type CircleConfig = { appId: string | null; custody: string; enabled: boolean; network: string };
type CircleChallengeResult = { data?: { signature?: string }; status?: string; type?: string };

export function EmbeddedWalletOnboarding({
  onBrowserConnect,
  onDisconnect,
  onEmbeddedConnect,
  walletAddress,
  walletMode,
}: {
  onBrowserConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onEmbeddedConnect: (address: Address, signer: (message: string) => Promise<Hex>) => Promise<void>;
  walletAddress: Address | null;
  walletMode: WalletMode | null;
}) {
  const sdkRef = useRef<W3SSdk | null>(null);
  const authRef = useRef<CircleAuthentication | null>(null);
  const [config, setConfig] = useState<CircleConfig | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [phase, setPhase] = useState<"email" | "otp" | "authenticated" | "wallet" | "connected">("email");
  const [wallet, setWallet] = useState<CircleEmbeddedWallet | null>(null);

  const handleLoginComplete = useCallback((sdkError: { message?: string } | undefined, result: LoginResult | undefined) => {
    setIsBusy(false);
    if (sdkError || !result?.userToken || !result.encryptionKey) {
      setError(sdkError?.message || "The email code could not be verified. Try again.");
      return;
    }

    const authentication = { encryptionKey: result.encryptionKey, userToken: result.userToken };
    authRef.current = authentication;
    sdkRef.current?.setAuthentication(authentication);
    setError(null);
    setNotice("Email verified. Create or open your Arc Testnet wallet next.");
    setPhase("authenticated");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/embedded-wallet", { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as CircleConfig | null;
        if (!res.ok || !body) throw new Error("Email wallet configuration could not be loaded.");
        if (cancelled) return;
        setConfig(body);
        if (!body.enabled || !body.appId) return;

        const { W3SSdk: CircleSdk } = await import("@circle-fin/w3s-pw-web-sdk");
        if (cancelled) return;
        const sdk = new CircleSdk({ appSettings: { appId: body.appId } }, handleLoginComplete);
        sdkRef.current = sdk;
        const nextDeviceId = await sdk.getDeviceId();
        if (cancelled) return;
        setDeviceId(nextDeviceId);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Email wallet onboarding could not start.");
      });
    return () => { cancelled = true; };
  }, [handleLoginComplete]);

  async function connectBrowser() {
    setError(null);
    setNotice(null);
    setIsBusy(true);
    try {
      await onBrowserConnect();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The browser wallet could not be connected.");
    } finally {
      setIsBusy(false);
    }
  }

  async function requestEmailCode() {
    if (!sdkRef.current || !config?.appId || !deviceId) {
      setError("The secure email wallet is still loading. Try again in a moment.");
      return;
    }
    setError(null);
    setNotice(null);
    setIsBusy(true);
    try {
      const session = await callEmbeddedApi<{
        deviceEncryptionKey: string;
        deviceToken: string;
        email: string;
        otpToken: string;
      }>({ action: "requestEmailOtp", deviceId, email });
      sdkRef.current.updateConfigs({
        appSettings: { appId: config.appId },
        loginConfigs: {
          deviceEncryptionKey: session.deviceEncryptionKey,
          deviceToken: session.deviceToken,
          otpToken: session.otpToken,
        },
      }, handleLoginComplete);
      setEmail(session.email);
      setPhase("otp");
      setNotice(`Circle sent a one time code to ${session.email}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The email code could not be sent.");
    } finally {
      setIsBusy(false);
    }
  }

  function verifyEmailCode() {
    if (!sdkRef.current) return;
    setError(null);
    setNotice("Enter the code in Circle's secure verification window.");
    setIsBusy(true);
    sdkRef.current.verifyOtp();
  }

  async function prepareWallet() {
    const authentication = authRef.current;
    if (!authentication || !sdkRef.current) {
      setError("Verify your email again before creating the wallet.");
      setPhase("email");
      return;
    }
    setError(null);
    setNotice(null);
    setIsBusy(true);
    try {
      const initialization = await callEmbeddedApi<{
        alreadyInitialized?: boolean;
        challengeId?: string;
        wallets?: CircleEmbeddedWallet[];
      }>({ action: "initializeUser", userToken: authentication.userToken });

      let nextWallet = initialization.wallets?.[0] ?? null;
      let challengeId = initialization.challengeId;
      if (!nextWallet && initialization.alreadyInitialized) {
        const created = await callEmbeddedApi<{ challengeId: string }>({
          action: "createWallet",
          userToken: authentication.userToken,
        });
        challengeId = created.challengeId;
      }
      if (challengeId) {
        await executeCircleChallenge(sdkRef.current, challengeId);
        nextWallet = await loadArcWallet(authentication.userToken);
      }
      if (!nextWallet) throw new Error("Your Arc Testnet wallet is not ready yet. Try again.");
      setWallet(nextWallet);
      setPhase("wallet");
      setNotice("Arc Testnet wallet ready. One final signature links it to ArcPass.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Arc Testnet wallet could not be prepared.");
    } finally {
      setIsBusy(false);
    }
  }

  async function connectEmbeddedWallet() {
    const authentication = authRef.current;
    if (!authentication || !wallet || !sdkRef.current) return;
    setError(null);
    setNotice(null);
    setIsBusy(true);
    try {
      const sdk = sdkRef.current;
      const signer = async (message: string): Promise<Hex> => {
        const challenge = await callEmbeddedApi<{ challengeId: string }>({
          action: "signMessage",
          message,
          userToken: authentication.userToken,
          walletId: wallet.id,
        });
        const result = await executeCircleChallenge(sdk, challenge.challengeId);
        const signature = result.data?.signature;
        if (!signature || !/^0x[0-9a-fA-F]+$/.test(signature)) {
          throw new Error("Circle did not return a valid wallet signature.");
        }
        return signature as Hex;
      };
      await onEmbeddedConnect(wallet.address, signer);
      setPhase("connected");
      setNotice("Email wallet connected to the ArcPass merchant workspace.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The email wallet could not be connected.");
    } finally {
      setIsBusy(false);
    }
  }

  async function disconnect() {
    setError(null);
    setNotice(null);
    setIsBusy(true);
    try {
      await onDisconnect();
      authRef.current = null;
      setWallet(null);
      setEmail("");
      setPhase("email");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The wallet could not be disconnected.");
    } finally {
      setIsBusy(false);
    }
  }

  async function loadArcWallet(userToken: string) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await callEmbeddedApi<{ wallets?: CircleEmbeddedWallet[] }>({ action: "listWallets", userToken });
      const nextWallet = result.wallets?.[0];
      if (nextWallet) return nextWallet;
      await new Promise((resolve) => setTimeout(resolve, 650));
    }
    return null;
  }

  const emailEnabled = Boolean(config?.enabled && config.appId);
  const emailStep = phase === "email" || phase === "otp" ? 1 : phase === "authenticated" ? 2 : 3;

  return (
    <div className="arcpass-wallet-onboarding">
      <section className="arcpass-panel arcpass-wallet-intro">
        <div>
          <p className="arcpass-panel-label">Merchant access</p>
          <h3>Choose how you want to enter ArcPass.</h3>
          <p>Use an installed EVM wallet or create a Circle user controlled wallet with email. Both paths finish with the same gas free ArcPass session signature.</p>
        </div>
        <div className="arcpass-wallet-trust">
          <span aria-hidden="true">✓</span>
          <div><strong>Keys stay with you</strong><small>ArcPass never receives or stores a private key, PIN, or recovery material.</small></div>
        </div>
      </section>

      {walletAddress ? (
        <section className="arcpass-panel arcpass-connected-wallet">
          <div className="arcpass-connected-wallet-icon" aria-hidden="true">✓</div>
          <div>
            <p className="arcpass-panel-label">Connected merchant</p>
            <h3>{shortAddress(walletAddress)}</h3>
            <div className="arcpass-wallet-badges"><span>Arc Testnet</span><span>{walletMode === "embedded" ? "Circle email wallet" : "Browser wallet"}</span><span>Signed session</span></div>
          </div>
          <button type="button" className="arcpass-ghost-button" onClick={disconnect} disabled={isBusy}>Disconnect</button>
        </section>
      ) : (
        <div className="arcpass-wallet-methods">
          <section className="arcpass-panel arcpass-wallet-method">
            <div className="arcpass-wallet-method-heading"><span aria-hidden="true">01</span><div><p className="arcpass-panel-label">Browser wallet</p><h3>Connect an installed EVM wallet.</h3></div></div>
            <p>Choose MetaMask, OKX, Coinbase Wallet, or another installed provider. ArcPass switches it to Arc Testnet before requesting a session signature.</p>
            <ul><li>No account setup</li><li>Use an existing Arc address</li><li>Approve in your wallet extension</li></ul>
            <button type="button" className="arcpass-dark-button" onClick={connectBrowser} disabled={isBusy}>{isBusy ? "Waiting for approval" : "Choose browser wallet"}</button>
          </section>

          <section className="arcpass-panel arcpass-wallet-method arcpass-wallet-method-email">
            <div className="arcpass-wallet-method-heading"><span aria-hidden="true">02</span><div><p className="arcpass-panel-label">Email wallet</p><h3>Create a user controlled Arc wallet.</h3></div></div>
            <p>Circle verifies your email and opens a secure approval window for wallet creation and signatures. No browser extension is required.</p>

            <ol className="arcpass-wallet-steps">
              {["Verify email", "Create Arc wallet", "Link signed session"].map((label, index) => (
                <li key={label} data-state={index + 1 < emailStep ? "complete" : index + 1 === emailStep ? "active" : "pending"}>
                  <span>{index + 1 < emailStep ? "✓" : index + 1}</span><strong>{label}</strong>
                </li>
              ))}
            </ol>

            {!emailEnabled ? (
              <div className="arcpass-wallet-config-note"><strong>Email wallet setup required</strong><p>Add a Circle API key and App ID, then enable email authentication and SMTP in the Circle console. Browser wallet access remains available.</p></div>
            ) : null}
            {emailEnabled && phase === "email" ? (
              <div className="arcpass-wallet-email-form">
                <label><span>Work email</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></label>
                <button type="button" className="arcpass-dark-button" onClick={requestEmailCode} disabled={isBusy || !deviceId}>{isBusy ? "Sending code" : deviceId ? "Send one time code" : "Loading secure wallet"}</button>
              </div>
            ) : null}
            {emailEnabled && phase === "otp" ? <button type="button" className="arcpass-dark-button" onClick={verifyEmailCode} disabled={isBusy}>{isBusy ? "Waiting for code" : "Enter verification code"}</button> : null}
            {emailEnabled && phase === "authenticated" ? <button type="button" className="arcpass-dark-button" onClick={prepareWallet} disabled={isBusy}>{isBusy ? "Opening Circle" : "Create or open Arc wallet"}</button> : null}
            {emailEnabled && phase === "wallet" && wallet ? (
              <div className="arcpass-wallet-ready"><div><span>Arc wallet ready</span><strong>{shortAddress(wallet.address)}</strong></div><button type="button" className="arcpass-dark-button" onClick={connectEmbeddedWallet} disabled={isBusy}>{isBusy ? "Waiting for signature" : "Sign and enter ArcPass"}</button></div>
            ) : null}
          </section>
        </div>
      )}

      {notice ? <p className="arcpass-wallet-notice" role="status">{notice}</p> : null}
      {error ? <p className="arcpass-error" role="alert">{error}</p> : null}
    </div>
  );
}

async function callEmbeddedApi<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/embedded-wallet", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const payload = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !payload) throw new Error(payload?.error || "The email wallet request could not be completed.");
  return payload;
}

function executeCircleChallenge(sdk: W3SSdk, challengeId: string): Promise<CircleChallengeResult> {
  return new Promise((resolve, reject) => {
    sdk.execute(challengeId, (error, result) => {
      if (error || !result || result.status !== "COMPLETE") {
        reject(new Error(error?.message || "The Circle wallet action was not completed."));
        return;
      }
      resolve(result as CircleChallengeResult);
    });
  });
}
