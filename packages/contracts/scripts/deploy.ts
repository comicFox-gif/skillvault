import { network } from "hardhat";

async function main() {
  // Connect to the network to get the ethers instance
  const { ethers } = await network.connect();

  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);

  const Vault = await ethers.getContractFactory("Vault");
  const vault = await Vault.deploy();

  await vault.waitForDeployment();

  console.log("Vault deployed to:", vault.target);
}

main().catch((error) => {
  if (error.message.includes("ConnectionRefusedError")) {
    console.error("\n❌ Connection failed. Make sure 'npx hardhat node' is running in a separate terminal.\n");
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
