import { type Chain } from "viem";

type ChainRuntimeConfig = {
  id: number;
  name: string;
  nativeName: string;
  nativeSymbol: string;
  rpcUrls: string[];
  explorerUrl: string;
  testnet: boolean;
  escrowAddress?: `0x${string}`;
};

function parseRpcUrls(csv: string | undefined, ...fallbacks: string[]) {
  const list = String(csv ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (list.length > 0) return Array.from(new Set(list));
  return fallbacks.length > 0 ? fallbacks : [];
}

const fallbackEscrowAddress = process.env.NEXT_PUBLIC_MATCH_ESCROW_ADDRESS as
  | `0x${string}`
  | undefined;
const fallbackNativeSymbol = process.env.NEXT_PUBLIC_NATIVE_SYMBOL || "ETH";
const fallbackExplorer = process.env.NEXT_PUBLIC_EXPLORER_URL || "";

const polkadot: ChainRuntimeConfig = {
  id: Number(process.env.NEXT_PUBLIC_POLKADOT_CHAIN_ID || "420420417"),
  name: process.env.NEXT_PUBLIC_POLKADOT_CHAIN_NAME || "Polkadot Hub TestNet",
  nativeName: process.env.NEXT_PUBLIC_POLKADOT_NATIVE_NAME || "Polkadot Asset Hub TestNet",
  nativeSymbol: process.env.NEXT_PUBLIC_POLKADOT_NATIVE_SYMBOL || "PAS",
  rpcUrls: parseRpcUrls(
    process.env.NEXT_PUBLIC_POLKADOT_RPC_URLS || process.env.NEXT_PUBLIC_POLKADOT_RPC_URL,
    "https://eth-rpc-testnet.polkadot.io/",
    "https://westend-asset-hub-eth-rpc.polkadot.io",
  ),
  explorerUrl:
    process.env.NEXT_PUBLIC_POLKADOT_EXPLORER_URL ||
    "https://blockscout-passet-hub.parity-testnet.parity.io/",
  testnet: process.env.NEXT_PUBLIC_POLKADOT_CHAIN_TESTNET !== "false",
  escrowAddress: process.env.NEXT_PUBLIC_POLKADOT_MATCH_ESCROW_ADDRESS as `0x${string}` | undefined,
};

const moonbase: ChainRuntimeConfig = {
  id: Number(process.env.NEXT_PUBLIC_MOONBASE_CHAIN_ID || "1287"),
  name: process.env.NEXT_PUBLIC_MOONBASE_CHAIN_NAME || "Moonbase Alpha",
  nativeName: process.env.NEXT_PUBLIC_MOONBASE_NATIVE_NAME || "DEV",
  nativeSymbol: process.env.NEXT_PUBLIC_MOONBASE_NATIVE_SYMBOL || "DEV",
  rpcUrls: parseRpcUrls(
    process.env.NEXT_PUBLIC_MOONBASE_RPC_URLS || process.env.NEXT_PUBLIC_MOONBASE_RPC_URL,
    "https://rpc.api.moonbase.moonbeam.network",
    "https://moonbase-alpha.public.blastapi.io",
    "https://moonbeam-alpha.api.onfinality.io/public",
  ),
  explorerUrl: process.env.NEXT_PUBLIC_MOONBASE_EXPLORER_URL || "https://moonbase.moonscan.io",
  testnet: process.env.NEXT_PUBLIC_MOONBASE_CHAIN_TESTNET !== "false",
  escrowAddress: process.env.NEXT_PUBLIC_MOONBASE_MATCH_ESCROW_ADDRESS as
    | `0x${string}`
    | undefined,
};

const baseSepolia: ChainRuntimeConfig = {
  id: Number(process.env.NEXT_PUBLIC_BASE_SEPOLIA_CHAIN_ID || "84532"),
  name: process.env.NEXT_PUBLIC_BASE_SEPOLIA_CHAIN_NAME || "Base Sepolia",
  nativeName: process.env.NEXT_PUBLIC_BASE_SEPOLIA_NATIVE_NAME || "Ether",
  nativeSymbol: process.env.NEXT_PUBLIC_BASE_SEPOLIA_NATIVE_SYMBOL || "ETH",
  rpcUrls: parseRpcUrls(
    process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URLS || process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL,
    "https://sepolia.base.org",
    "https://base-sepolia-rpc.publicnode.com",
    "https://base-sepolia.blockpi.network/v1/rpc/public",
  ),
  explorerUrl: process.env.NEXT_PUBLIC_BASE_SEPOLIA_EXPLORER_URL || "https://sepolia.basescan.org",
  testnet: process.env.NEXT_PUBLIC_BASE_SEPOLIA_CHAIN_TESTNET !== "false",
  escrowAddress: process.env.NEXT_PUBLIC_BASE_SEPOLIA_MATCH_ESCROW_ADDRESS as
    | `0x${string}`
    | undefined,
};

const arbitrumSepolia: ChainRuntimeConfig = {
  id: Number(process.env.NEXT_PUBLIC_ARB_SEPOLIA_CHAIN_ID || "421614"),
  name: process.env.NEXT_PUBLIC_ARB_SEPOLIA_CHAIN_NAME || "Arbitrum Sepolia",
  nativeName: process.env.NEXT_PUBLIC_ARB_SEPOLIA_NATIVE_NAME || "Ether",
  nativeSymbol: process.env.NEXT_PUBLIC_ARB_SEPOLIA_NATIVE_SYMBOL || "ETH",
  rpcUrls: parseRpcUrls(
    process.env.NEXT_PUBLIC_ARB_SEPOLIA_RPC_URLS || process.env.NEXT_PUBLIC_ARB_SEPOLIA_RPC_URL,
    "https://sepolia-rollup.arbitrum.io/rpc",
    "https://arbitrum-sepolia-rpc.publicnode.com",
    "https://arbitrum-sepolia.blockpi.network/v1/rpc/public",
  ),
  explorerUrl: process.env.NEXT_PUBLIC_ARB_SEPOLIA_EXPLORER_URL || "https://sepolia.arbiscan.io",
  testnet: process.env.NEXT_PUBLIC_ARB_SEPOLIA_CHAIN_TESTNET !== "false",
  escrowAddress: process.env.NEXT_PUBLIC_ARB_SEPOLIA_MATCH_ESCROW_ADDRESS as
    | `0x${string}`
    | undefined,
};

export const supportedChainConfigs: ChainRuntimeConfig[] = [
  polkadot,
  moonbase,
  baseSepolia,
  arbitrumSepolia,
];

export const supportedChains: Chain[] = supportedChainConfigs.map((config) => ({
  id: config.id,
  name: config.name,
  nativeCurrency: {
    name: config.nativeName,
    symbol: config.nativeSymbol,
    decimals: 18,
  },
  rpcUrls: {
    default: { http: config.rpcUrls },
    public: { http: config.rpcUrls },
  },
  blockExplorers: {
    default: { name: "Explorer", url: config.explorerUrl },
  },
  testnet: config.testnet,
}));

export function getChainConfig(chainId?: number) {
  if (!chainId) return undefined;
  return supportedChainConfigs.find((config) => config.id === chainId);
}

export function isSupportedChainId(chainId?: number) {
  return Boolean(getChainConfig(chainId));
}

export function getEscrowAddressForChain(chainId?: number) {
  if (chainId === undefined || chainId === null) return fallbackEscrowAddress;
  const byChain = getChainConfig(chainId)?.escrowAddress;
  return byChain;
}

export function getNativeSymbolForChain(chainId?: number) {
  if (chainId === undefined || chainId === null) return fallbackNativeSymbol;
  return getChainConfig(chainId)?.nativeSymbol || fallbackNativeSymbol;
}

export function getExplorerUrlForChain(chainId?: number) {
  if (chainId === undefined || chainId === null) return fallbackExplorer;
  return getChainConfig(chainId)?.explorerUrl || fallbackExplorer;
}

export function getSupportedChainNames() {
  return supportedChainConfigs.map((config) => config.name).join(", ");
}

export function getRpcUrlsForChain(chainId?: number) {
  if (chainId === undefined || chainId === null) return [];
  return getChainConfig(chainId)?.rpcUrls ?? [];
}
