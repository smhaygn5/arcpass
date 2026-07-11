import { createWalletClient, custom, isAddress, type Address } from "viem";
import { ARC_TESTNET_EXPLORER_URL, ARC_TESTNET_NETWORK, ARC_TESTNET_RPC_URL } from "@/lib/arc-chain";

export type EthereumProvider = {
  _metamask?: {
    isUnlocked?: () => Promise<boolean>;
  };
  isBraveWallet?: boolean;
  isCoinbaseBrowser?: boolean;
  isCoinbaseWallet?: boolean;
  isMetaMask?: boolean;
  isPhantom?: boolean;
  isRabby?: boolean;
  isTrust?: boolean;
  on?: (event: WalletEvent, listener: WalletEventListener) => void;
  providers?: EthereumProvider[];
  removeListener?: (event: WalletEvent, listener: WalletEventListener) => void;
  request<T = unknown>(args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }): Promise<T>;
};

type WalletEvent = "accountsChanged" | "chainChanged" | "disconnect";
type WalletEventListener = (...args: unknown[]) => void;
type ProviderSelectionOptions = {
  preferBaseApp?: boolean;
  requireMetaMask?: boolean;
};
type Eip6963ProviderDetail = {
  info: {
    name: string;
    rdns: string;
    uuid: string;
  };
  provider: EthereumProvider;
};

export type BrowserEvmSigner = {
  readonly address: Address;
  signTypedData(message: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`>;
};

type WalletLocale = "en" | "tr";

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const eip6963Providers: Eip6963ProviderDetail[] = [];
let selectedProvider: EthereumProvider | null = null;
const EIP6963_ANNOUNCE_EVENT = "eip6963:announceProvider";
const EIP6963_REQUEST_EVENT = "eip6963:requestProvider";
const BASE_MOBILE_DAPP_URL = "https://go.cb-w.com/dapp";
const WALLET_DISCOVERY_TIMEOUT_MS = 1500;
const NON_METAMASK_PROVIDER_IDS = [
  "base",
  "phantom",
  "coinbase",
  "rabby",
  "okx",
  "trust",
  "brave",
  "exodus",
  "rainbow",
  "zerion",
];

if (typeof window !== "undefined") {
  window.addEventListener(EIP6963_ANNOUNCE_EVENT, handleEip6963ProviderAnnouncement);
}

type WalletChain = {
  blockExplorerUrls: string[];
  chainId: string;
  chainName: string;
  nativeCurrency: {
    decimals: number;
    name: string;
    symbol: string;
  };
  rpcUrls: string[];
};

const CHAINS: Record<string, WalletChain> = {
  [ARC_TESTNET_NETWORK]: {
    blockExplorerUrls: [ARC_TESTNET_EXPLORER_URL],
    chainId: "0x4cef52",
    chainName: "Arc Testnet",
    nativeCurrency: { decimals: 18, name: "USDC", symbol: "USDC" },
    rpcUrls: [ARC_TESTNET_RPC_URL],
  },
  "eip155:8453": {
    blockExplorerUrls: ["https://basescan.org"],
    chainId: "0x2105",
    chainName: "Base",
    nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
    rpcUrls: ["https://mainnet.base.org"],
  },
  "eip155:84532": {
    blockExplorerUrls: ["https://sepolia.basescan.org"],
    chainId: "0x14a34",
    chainName: "Base Sepolia",
    nativeCurrency: { decimals: 18, name: "Sepolia Ether", symbol: "ETH" },
    rpcUrls: ["https://sepolia.base.org"],
  },
};

export function hasInjectedWallet() {
  return getInjectedProviders().length > 0;
}

export function isMobileWalletEnvironment() {
  return isMobileDevice();
}

export function shouldOpenBaseMobileWallet() {
  return isMobileDevice() && !hasInjectedWallet();
}

export function openBaseMobileWallet() {
  if (typeof window === "undefined") return false;

  const url = new URL(BASE_MOBILE_DAPP_URL);
  url.searchParams.set("cb_url", window.location.href);
  window.location.href = url.toString();
  return true;
}

export async function requestWalletAddress(provider?: EthereumProvider): Promise<Address> {
  const walletProvider = provider ?? await getProviderAsync(defaultProviderSelection());
  const accounts = await walletProvider.request<string[]>({ method: "eth_requestAccounts" });
  const address = accounts[0];

  if (!address || !isAddress(address)) {
    throw new Error("Wallet did not return a valid EVM address.");
  }

  return address;
}

export async function requestVerifiedWalletAddress(): Promise<Address> {
  const provider = await getProviderAsync(defaultProviderSelection());
  const address = await requestWalletAddress(provider);
  return verifyWalletAddress(provider, address);
}

export async function requestVerifiedWalletAddressSelection(): Promise<Address> {
  const provider = await getProviderAsync(defaultProviderSelection());
  const address = await requestWalletAddressSelection(provider);
  return verifyWalletAddress(provider, address);
}

export async function signWalletMessage(address: Address, message: string): Promise<`0x${string}`> {
  const provider = await getProviderAsync(defaultProviderSelection());
  await assertWalletAccount(provider, address);
  const walletClient = createWalletClient({
    account: address,
    transport: custom(provider),
  });
  const signature = await walletClient.signMessage({
    account: address,
    message,
  });

  if (!signature?.startsWith("0x")) {
    throw new Error("Wallet did not return a valid signature.");
  }

  return signature;
}

async function requestWalletAddressSelection(provider: EthereumProvider): Promise<Address> {
  await provider.request({
    method: "wallet_requestPermissions",
    params: [{ eth_accounts: {} }],
  }).catch(() => null);

  return requestWalletAddress(provider);
}

async function verifyWalletAddress(provider: EthereumProvider, address: Address): Promise<Address> {
  const walletClient = createWalletClient({
    account: address,
    transport: custom(provider),
  });
  const signature = await walletClient.signMessage({
    account: address,
    message: walletConnectionMessage(address),
  });

  if (!signature?.startsWith("0x")) {
    throw new Error("Wallet connection signature was not completed.");
  }

  return address;
}

export async function getConnectedWalletAddress(): Promise<Address | null> {
  const provider = await getProviderAsync({
    ...defaultProviderSelection(),
    lock: false,
  });

  if (!(await isProviderUnlocked(provider))) {
    return null;
  }

  const accounts = await provider.request<string[]>({ method: "eth_accounts" });
  const address = accounts[0];

  return address && isAddress(address) ? address : null;
}

export function subscribeWalletEvents(onChange: () => void) {
  const listener: WalletEventListener = () => onChange();
  const events = ["accountsChanged", "chainChanged", "disconnect"] as const;
  const providers = getInjectedProviders();

  for (const provider of providers) {
    for (const event of events) {
      provider.on?.(event, listener);
    }
  }

  return () => {
    for (const provider of providers) {
      for (const event of events) {
        provider.removeListener?.(event, listener);
      }
    }
  };
}

export async function ensurePaymentNetwork(network: string) {
  const chain = CHAINS[network];
  if (!chain) return;

  const provider = await getProviderAsync(defaultProviderSelection());
  const currentChain = await provider.request<string>({ method: "eth_chainId" });
  if (currentChain.toLowerCase() === chain.chainId.toLowerCase()) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chain.chainId }],
    });
  } catch (err) {
    if (isUnknownChainError(err)) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [chain],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chain.chainId }],
      });
    } else {
      throw err;
    }
  }

  await assertCurrentChain(provider, chain);
}

export function createBrowserEvmSigner(address: Address): BrowserEvmSigner {
  return {
    address,
    async signTypedData(typedData) {
      const provider = getProvider();
      await assertWalletAccount(provider, address);

      const walletClient = createWalletClient({
        account: address,
        transport: custom(provider),
      });

      const signature = await walletClient.signTypedData({
        account: address,
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      } as Parameters<typeof walletClient.signTypedData>[0]);

      if (!signature?.startsWith("0x")) {
        throw new Error("Wallet did not return a valid signature.");
      }

      return signature as `0x${string}`;
    },
  };
}

export async function getBrowserWalletProvider() {
  return getProviderAsync(defaultProviderSelection());
}

export function walletErrorMessage(error: unknown, locale: WalletLocale = "en") {
  const code = walletErrorCode(error);
  if (locale === "tr") {
    if (code === 4001 || code === "4001") return "Cüzdan isteği reddedildi.";
    if (code === 4100 || code === "4100") return "Cüzdan bu siteye izin vermedi. Cüzdandan site iznini kontrol et.";
    if (code === 4902 || code === "4902") return "İstenen Arc ağı cüzdanda bulunamadı ve otomatik eklenemedi.";

    const message = rawWalletMessage(error);
    if (message?.includes("No Base mobile wallet provider")) {
      return "Mobilde cüzdan bulunamadı. Siteyi Base App veya Coinbase Wallet içindeki tarayıcıda aç.";
    }
    if (message?.includes("No browser wallet found")) {
      return "Tarayıcıda cüzdan bulunamadı. EVM cüzdanını yükle veya kilidini aç.";
    }
    if (message?.includes("MetaMask was not detected")) {
      return "MetaMask bu siteye görünmüyor. MetaMask site iznini aç veya Phantom/Coinbase gibi diğer cüzdan eklentilerini geçici kapatıp sayfayı yenile.";
    }
    if (message?.includes("Wallet did not return a valid EVM address")) {
      return "Cüzdan geçerli bir EVM adresi döndürmedi.";
    }
    if (message?.includes("Wallet did not return a valid signature")) {
      return "Cüzdan geçerli bir imza döndürmedi.";
    }
    if (message?.includes("Wallet connection signature was not completed")) {
      return "Cüzdan bağlantı imzası tamamlanmadı.";
    }
    if (message?.includes("Wallet is not on")) {
      return "Cüzdan istenen Arc ağına geçmedi. Ağ seçimini kontrol edip tekrar dene.";
    }
    if (message?.includes("Wallet is locked")) {
      return "Cüzdan kilitli. Cüzdanı açıp tekrar dene.";
    }
    if (message?.includes("Connected wallet account changed")) {
      return "Bağlı cüzdan hesabı değişti. Cüzdanı yeniden bağlayıp tekrar dene.";
    }
    if (message?.includes("Do not know how to serialize a BigInt")) {
      return "Ödeme imzası hazırlanamadı. Sayfayı yenileyip tekrar dene.";
    }

    return message || "Cüzdan isteği başarısız oldu.";
  }

  const message = rawWalletMessage(error);
  if (message) return message;
  if (code === 4001 || code === "4001") return "Wallet request was rejected.";
  if (code === 4100 || code === "4100") return "Wallet has not authorized this site.";
  if (code === 4902 || code === "4902") return "Requested payment network is not available in the wallet.";
  return "Wallet request failed.";
}

function rawWalletMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return null;
}

function walletErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return error.code;
  }

  return null;
}

function getProvider(): EthereumProvider {
  const selection = defaultProviderSelection();
  clearNonMetaMaskSelection(selection.requireMetaMask);
  const providers = getInjectedProviders();
  const provider = selectPreferredProvider(providers, selection);

  if (!provider && !selectedProvider) {
    throw walletProviderError(providers, selection.requireMetaMask);
  }

  if (provider && shouldUseDiscoveredProvider(provider)) {
    selectedProvider = provider;
  }

  const resolvedProvider = selectedProvider ?? provider;
  if (!resolvedProvider) {
    throw walletProviderError(providers, selection.requireMetaMask);
  }

  return resolvedProvider;
}

async function getProviderAsync({
  preferBaseApp = false,
  requireMetaMask = false,
  lock = true,
}: { lock?: boolean } & ProviderSelectionOptions = {}): Promise<EthereumProvider> {
  const selection = { preferBaseApp: preferBaseApp ?? false, requireMetaMask };
  clearNonMetaMaskSelection(selection.requireMetaMask);
  const providers = await discoverInjectedProviders(selection);
  const provider = selectPreferredProvider(providers, selection);

  if (!provider && !selectedProvider) {
    throw walletProviderError(providers, requireMetaMask);
  }

  if (!lock) {
    const resolvedProvider = provider ?? selectedProvider;
    if (!resolvedProvider) {
      throw walletProviderError(providers, requireMetaMask);
    }
    return resolvedProvider;
  }

  if (provider && shouldUseDiscoveredProvider(provider)) {
    selectedProvider = provider;
  }

  const resolvedProvider = selectedProvider ?? provider;
  if (!resolvedProvider) {
    throw walletProviderError(providers, requireMetaMask);
  }

  return resolvedProvider;
}

function getInjectedProviders({ request = true }: { request?: boolean } = {}) {
  if (typeof window === "undefined") return [];

  if (request) requestEip6963Providers();

  const providers = [
    ...eip6963Providers.map((provider) => provider.provider),
    ...legacyProviders(),
  ];

  return uniqueProviders(providers);
}

function legacyProviders() {
  const ethereum = window.ethereum;
  if (!ethereum) return [];

  if (Array.isArray(ethereum.providers) && ethereum.providers.length > 0) {
    return ethereum.providers;
  }

  return [ethereum];
}

function requestEip6963Providers() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EIP6963_REQUEST_EVENT));
}

async function discoverInjectedProviders(selection: ProviderSelectionOptions = {}) {
  if (typeof window === "undefined") return [];

  const immediateProviders = getInjectedProviders();
  if (isProviderSelectionReady(immediateProviders, selection)) {
    return immediateProviders;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener(EIP6963_ANNOUNCE_EVENT, onAnnouncement);
      resolve();
    };
    const onAnnouncement = (event: Event) => {
      handleEip6963ProviderAnnouncement(event);
      if (isProviderSelectionReady(getInjectedProviders({ request: false }), selection)) {
        finish();
      }
    };

    window.addEventListener(EIP6963_ANNOUNCE_EVENT, onAnnouncement);
    window.setTimeout(finish, WALLET_DISCOVERY_TIMEOUT_MS);
    requestEip6963Providers();
  });

  return getInjectedProviders({ request: false });
}

function handleEip6963ProviderAnnouncement(event: Event) {
  const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
  if (!detail?.provider) return;

  const exists = eip6963Providers.some(
    (provider) =>
      provider.info.uuid === detail.info.uuid ||
      provider.provider === detail.provider,
  );
  if (!exists) {
    eip6963Providers.push(detail);
  }
}

function uniqueProviders(providers: EthereumProvider[]) {
  return providers.filter(
    (provider, index) => providers.findIndex((candidate) => candidate === provider) === index,
  );
}

function shouldUseDiscoveredProvider(provider: EthereumProvider) {
  if (!selectedProvider) return true;
  if (isMobileDevice()) {
    if (isBaseAppProvider(provider) && !isBaseAppProvider(selectedProvider)) return true;
    return selectedProvider === provider;
  }
  if (isMetaMaskProvider(provider) && !isMetaMaskProvider(selectedProvider)) return true;
  if (!isCoinbaseProvider(provider) && isCoinbaseProvider(selectedProvider)) return true;
  return selectedProvider === provider;
}

function clearNonMetaMaskSelection(requireMetaMask: boolean) {
  if (requireMetaMask && selectedProvider && !isMetaMaskProvider(selectedProvider)) {
    selectedProvider = null;
  }
}

function walletProviderError(providers: EthereumProvider[], requireMetaMask: boolean) {
  if (requireMetaMask && providers.length > 0) {
    return new Error(
      "MetaMask was not detected. Enable MetaMask for this site or temporarily disable other wallet extensions, then refresh.",
    );
  }

  if (isMobileDevice()) {
    return new Error(
      "No Base mobile wallet provider found. Open this site in Base App or Coinbase Wallet.",
    );
  }

  return new Error("No browser wallet found. Install or unlock an EVM wallet first.");
}

function selectPreferredProvider(
  providers: EthereumProvider[],
  { preferBaseApp = false, requireMetaMask = false }: ProviderSelectionOptions = {},
) {
  if (requireMetaMask) {
    return selectMetaMaskProvider();
  }

  if (preferBaseApp) {
    return (
      providers.find(isBaseAppProvider) ??
      providers.find(isCoinbaseProvider) ??
      providers.find(isMetaMaskProvider) ??
      providers.find((provider) => !isKnownNonMetaMaskProvider(provider)) ??
      providers[0] ??
      null
    );
  }

  return (
    providers.find(isMetaMaskProvider) ??
    providers.find((provider) => !isCoinbaseProvider(provider)) ??
    providers[0] ??
    null
  );
}

function selectMetaMaskProvider() {
  const announcedMetaMask = eip6963Providers.find((detail) =>
    isMetaMaskProviderDetail(detail),
  )?.provider;

  if (announcedMetaMask) {
    return announcedMetaMask;
  }

  return getInjectedProviders({ request: false }).find(isMetaMaskProvider) ?? null;
}

function hasAnnouncedMetaMaskProvider() {
  return eip6963Providers.some(isMetaMaskProviderDetail);
}

function isMetaMaskProvider(provider: EthereumProvider) {
  const detail = eip6963Providers.find((candidate) => candidate.provider === provider);
  if (detail) {
    return isMetaMaskProviderDetail(detail);
  }

  return Boolean((provider._metamask || provider.isMetaMask) && !isKnownNonMetaMaskProvider(provider));
}

function isMetaMaskProviderDetail(detail: Eip6963ProviderDetail) {
  const rdns = detail.info.rdns.toLowerCase();
  const name = detail.info.name.toLowerCase();

  return (
    !hasNonMetaMaskIdentity(detail.provider, detail) &&
    (rdns === "io.metamask" || rdns.endsWith(".metamask") || name === "metamask")
  );
}

function isCoinbaseProvider(provider: EthereumProvider) {
  const { name, rdns } = providerIdentity(provider);

  return (
    provider.isCoinbaseWallet === true ||
    provider.isCoinbaseBrowser === true ||
    rdns.includes("coinbase") ||
    name.includes("coinbase")
  );
}

function isBaseAppProvider(provider: EthereumProvider) {
  const { identity } = providerIdentity(provider);
  return isCoinbaseProvider(provider) || identity.includes("base");
}

function isKnownNonMetaMaskProvider(provider: EthereumProvider) {
  return hasNonMetaMaskIdentity(
    provider,
    eip6963Providers.find((candidate) => candidate.provider === provider),
  );
}

function hasNonMetaMaskIdentity(
  provider: EthereumProvider,
  detail?: Eip6963ProviderDetail,
) {
  const { identity } = providerIdentity(provider, detail);

  return (
    provider.isBraveWallet === true ||
    provider.isCoinbaseBrowser === true ||
    provider.isCoinbaseWallet === true ||
    provider.isPhantom === true ||
    provider.isRabby === true ||
    provider.isTrust === true ||
    NON_METAMASK_PROVIDER_IDS.some((id) => identity.includes(id))
  );
}

function isProviderSelectionReady(
  providers: EthereumProvider[],
  { preferBaseApp = false, requireMetaMask = false }: ProviderSelectionOptions = {},
) {
  if (requireMetaMask) return hasAnnouncedMetaMaskProvider() || providers.some(isMetaMaskProvider);
  if (preferBaseApp) return providers.some(isBaseAppProvider) || providers.length > 0;
  return providers.length > 0;
}

function defaultProviderSelection(): Required<ProviderSelectionOptions> {
  const mobile = isMobileDevice();
  return {
    preferBaseApp: mobile,
    requireMetaMask: !mobile,
  };
}

function isMobileDevice() {
  if (typeof navigator === "undefined") return false;

  const userAgent = navigator.userAgent || "";
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1)
  );
}

function providerIdentity(provider: EthereumProvider, detail?: Eip6963ProviderDetail) {
  const providerDetail = detail ?? eip6963Providers.find((candidate) => candidate.provider === provider);
  const rdns = providerDetail?.info.rdns.toLowerCase() ?? "";
  const name = providerDetail?.info.name.toLowerCase() ?? "";
  return {
    identity: `${rdns} ${name}`,
    name,
    rdns,
  };
}

function walletConnectionMessage(address: Address) {
  const origin = typeof window !== "undefined" ? window.location.origin : "ArcPass";
  return [
    "ArcPass wallet connection",
    "",
    `Site: ${origin}`,
    `Address: ${address}`,
    `Time: ${new Date().toISOString()}`,
    "",
    "This gas-free signature only verifies wallet control. It does not authorize a payment.",
  ].join("\n");
}

async function assertCurrentChain(provider: EthereumProvider, chain: WalletChain) {
  const currentChain = await provider.request<string>({ method: "eth_chainId" });

  if (currentChain.toLowerCase() !== chain.chainId.toLowerCase()) {
    throw new Error(`Wallet is not on ${chain.chainName}. Switch networks and try again.`);
  }
}

async function assertWalletAccount(provider: EthereumProvider, address: Address) {
  if (!(await isProviderUnlocked(provider))) {
    throw new Error("Wallet is locked. Unlock it and try again.");
  }

  const accounts = await provider.request<string[]>({ method: "eth_accounts" });
  const isActiveAccount = accounts.some(
    (account) => account.toLowerCase() === address.toLowerCase(),
  );

  if (!isActiveAccount) {
    throw new Error("Connected wallet account changed. Reconnect wallet and try again.");
  }
}

async function isProviderUnlocked(provider: EthereumProvider) {
  try {
    const unlocked = await provider._metamask?.isUnlocked?.();
    return unlocked !== false;
  } catch {
    return true;
  }
}

function isUnknownChainError(error: unknown) {
  return (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === 4902 || error.code === "4902")
  );
}
