import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();
  const cliNetworkIndex = process.argv.findIndex((arg) => arg === "--network");
  const activeNetwork =
    process.env.HARDHAT_NETWORK ||
    (cliNetworkIndex >= 0 ? process.argv[cliNetworkIndex + 1] : undefined) ||
    "unknown";

  console.log("Deploying MatchEscrow with account:", deployer.address);
  console.log("Network:", activeNetwork);

  const configuredTreasury = process.env.MATCH_ESCROW_TREASURY;
  const treasury =
    configuredTreasury &&
    ethers.isAddress(configuredTreasury) &&
    configuredTreasury.toLowerCase() !== ethers.ZeroAddress.toLowerCase()
      ? configuredTreasury
      : deployer.address;
  console.log("Treasury:", treasury);

  const Contract = await ethers.getContractFactory("SkillVaultMatchEscrow");
  const feeData = await ethers.provider.getFeeData();
  const pendingNonce = await ethers.provider.getTransactionCount(deployer.address, "pending");
  const deployOverrides: Record<string, bigint | number> = { nonce: pendingNonce };

  const baseGas = feeData.gasPrice ?? 1_000_000_000n;
  const priority = feeData.maxPriorityFeePerGas
    ? feeData.maxPriorityFeePerGas * 3n
    : baseGas / 2n;
  const maxFee = feeData.maxFeePerGas
    ? feeData.maxFeePerGas * 3n
    : baseGas * 3n + priority;

  deployOverrides.maxPriorityFeePerGas = priority;
  deployOverrides.maxFeePerGas = maxFee;

  console.log("Deploy nonce:", pendingNonce.toString());
  if (deployOverrides.maxFeePerGas) {
    console.log("maxFeePerGas:", deployOverrides.maxFeePerGas.toString());
  }
  if (deployOverrides.maxPriorityFeePerGas) {
    console.log("maxPriorityFeePerGas:", deployOverrides.maxPriorityFeePerGas.toString());
  }
  console.log("baseGasPrice:", baseGas.toString());

  const contract = await Contract.deploy(treasury, deployOverrides);

  await contract.waitForDeployment();

  console.log("SkillVaultMatchEscrow deployed to:", contract.target);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
