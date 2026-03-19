import { type Chain } from "viem";

type ChainRuntimeConfig = {
  id: number;
  name: string;
  nativeName: string;
  nativeSymbol: string;
  rpcUrl: string;
  explorerUrl: string;
  testnet: boolean;
  escrowAddress?: `0x${string}`;
};

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
  rpcUrl: process.env.NEXT_PUBLIC_POLKADOT_RPC_URL || "https://eth-rpc-testnet.polkadot.io/",
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
  rpcUrl:
    process.env.NEXT_PUBLIC_MOONBASE_RPC_URL || "https://rpc.api.moonbase.moonbeam.network",
  explorerUrl: process.env.NEXT_PUBLIC_MOONBASE_EXPLORER_URL || "https://moonbase.moonscan.io",
  testnet: process.env.NEXT_PUBLIC_MOONBASE_CHAIN_TESTNET !== "false",
  escrowAddress: process.env.NEXT_PUBLIC_MOONBASE_MATCH_ESCROW_ADDRESS as
    | `0x${string}`
    | undefined,
};

export const supportedChainConfigs: ChainRuntimeConfig[] = [polkadot, moonbase];

export const supportedChains: Chain[] = supportedChainConfigs.map((config) => ({
  id: config.id,
  name: config.name,
  nativeCurrency: {
    name: config.nativeName,
    symbol: config.nativeSymbol,
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [config.rpcUrl] },
    public: { http: [config.rpcUrl] },
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
