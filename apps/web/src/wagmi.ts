import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { createConfig } from "wagmi";
import { injected, metaMask } from "wagmi/connectors";
import { http, type Chain } from "viem";

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "1287");
const rpcUrl =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.api.moonbase.moonbeam.network";
const explorerUrl = process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://moonbase.moonscan.io";
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
const hasWalletConnectId =
  Boolean(walletConnectProjectId) &&
  walletConnectProjectId !== "YOUR_WALLETCONNECT_PROJECT_ID" &&
  walletConnectProjectId !== "MISSING_PROJECT_ID";

const chain: Chain = {
  id: chainId,
  name: process.env.NEXT_PUBLIC_CHAIN_NAME ?? "Moonbase Alpha",
  nativeCurrency: {
    name: process.env.NEXT_PUBLIC_NATIVE_NAME ?? "DEV",
    symbol: process.env.NEXT_PUBLIC_NATIVE_SYMBOL ?? "DEV",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [rpcUrl] },
    public: { http: [rpcUrl] },
  },
  blockExplorers: {
    default: { name: "Explorer", url: explorerUrl },
  },
  testnet: process.env.NEXT_PUBLIC_CHAIN_TESTNET !== "false",
};

export const config = hasWalletConnectId
  ? getDefaultConfig({
      appName: "Skill Vault",
      projectId: walletConnectProjectId!,
      chains: [chain],
      ssr: true,
    })
  : createConfig({
      chains: [chain],
      connectors: [
        // Prefer explicit MetaMask connector to reduce injected-provider mismatch issues.
        metaMask(),
        injected({ shimDisconnect: true }),
      ],
      transports: {
        [chain.id]: http(rpcUrl),
      },
      ssr: true,
    });
