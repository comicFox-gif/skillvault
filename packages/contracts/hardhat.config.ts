import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig } from "hardhat/config";
import fs from "node:fs";
import path from "node:path";

const envFile = path.join(process.cwd(), ".env");
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const splitIndex = line.indexOf("=");
    if (splitIndex <= 0) continue;
    const key = line.slice(0, splitIndex).trim();
    const value = line.slice(splitIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
}

function asRpcUrl(...values: Array<string | undefined>) {
  for (const value of values) {
    if (value && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function asAccounts(...values: Array<string | undefined>) {
  for (const value of values) {
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    return [trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`];
  }
  return [];
}

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    polkadotHubTestnet: {
      type: "http",
      chainType: "l1",
      url:
        asRpcUrl(
          process.env.POLKADOT_TESTNET_RPC_URL,
          "https://eth-rpc-testnet.polkadot.io/",
        ) ?? "https://eth-rpc-testnet.polkadot.io/",
      accounts: asAccounts(
        process.env.POLKADOT_TESTNET_PRIVATE_KEY,
      ),
    },
    moonbaseAlpha: {
      type: "http",
      chainType: "l1",
      url:
        asRpcUrl(
          process.env.MOONBASE_ALPHA_RPC_URL,
          "https://rpc.api.moonbase.moonbeam.network",
        ) ?? "https://rpc.api.moonbase.moonbeam.network",
      accounts: asAccounts(
        process.env.MOONBASE_PRIVATE_KEY,
        process.env.POLKADOT_TESTNET_PRIVATE_KEY,
      ),
    },
    moonbeam: {
      type: "http",
      chainType: "l1",
      url:
        asRpcUrl(process.env.MOONBEAM_RPC_URL, process.env.POLKADOT_MAINNET_RPC_URL) ??
        "https://rpc.api.moonbeam.network",
      accounts: asAccounts(
        process.env.MOONBEAM_PRIVATE_KEY,
        process.env.POLKADOT_MAINNET_PRIVATE_KEY,
      ),
    },
  },
});
