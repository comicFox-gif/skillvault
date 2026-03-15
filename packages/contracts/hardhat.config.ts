import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig } from "hardhat/config";
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
    moonbaseAlpha: {
      type: "http",
      chainType: "l1",
      url: configVariable("MOONBASE_ALPHA_RPC_URL"),
      accounts: [configVariable("MOONBASE_PRIVATE_KEY")],
    },
    moonbeam: {
      type: "http",
      chainType: "l1",
      url: configVariable("MOONBEAM_RPC_URL"),
      accounts: [configVariable("MOONBEAM_PRIVATE_KEY")],
    },
  },
});
