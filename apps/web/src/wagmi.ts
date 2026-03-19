import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { createConfig } from "wagmi";
import { injected, metaMask } from "wagmi/connectors";
import { http, type Chain } from "viem";
import { supportedChains } from "@/lib/chains";

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
const hasWalletConnectId =
  Boolean(walletConnectProjectId) &&
  walletConnectProjectId !== "YOUR_WALLETCONNECT_PROJECT_ID" &&
  walletConnectProjectId !== "MISSING_PROJECT_ID";

const chains = supportedChains as [Chain, ...Chain[]];
const transports = Object.fromEntries(
  chains.map((chain) => [chain.id, http(chain.rpcUrls.default.http[0])]),
);

export const config = hasWalletConnectId
  ? getDefaultConfig({
      appName: "Skill Vault",
      projectId: walletConnectProjectId!,
      chains,
      ssr: true,
    })
  : createConfig({
      chains,
      connectors: [
        // Prefer explicit MetaMask connector to reduce injected-provider mismatch issues.
        metaMask(),
        injected({ shimDisconnect: true }),
      ],
      transports,
      ssr: true,
    });
