import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { createConfig } from "wagmi";
import { injected, metaMask } from "wagmi/connectors";
import { fallback, http, type Chain } from "viem";
import { getRpcUrlsForChain, supportedChains } from "@/lib/chains";

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
const hasWalletConnectId =
  Boolean(walletConnectProjectId) &&
  walletConnectProjectId !== "YOUR_WALLETCONNECT_PROJECT_ID" &&
  walletConnectProjectId !== "MISSING_PROJECT_ID";

const chains = supportedChains as [Chain, ...Chain[]];

function buildTransport(chain: Chain) {
  const urls = getRpcUrlsForChain(chain.id);
  const transports = (urls.length ? urls : chain.rpcUrls.default.http).map((url) =>
    http(url, { retryCount: 1, timeout: 15_000 }),
  );
  if (transports.length <= 1) return transports[0];
  return fallback(transports, { rank: false });
}

const transports = Object.fromEntries(
  chains.map((chain) => [chain.id, buildTransport(chain)]),
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
