import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();

  console.log("Deploying MatchEscrow with account:", deployer.address);
  console.log("Network:", network.name);

  const configuredTreasury = process.env.MATCH_ESCROW_TREASURY;
  const treasury =
    configuredTreasury &&
    ethers.isAddress(configuredTreasury) &&
    configuredTreasury.toLowerCase() !== ethers.ZeroAddress.toLowerCase()
      ? configuredTreasury
      : deployer.address;
  console.log("Treasury:", treasury);

  const Contract = await ethers.getContractFactory("SkillVaultMatchEscrow");
  const contract = await Contract.deploy(treasury);

  await contract.waitForDeployment();

  console.log("SkillVaultMatchEscrow deployed to:", contract.target);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
