import { expect } from "chai";
import { network } from "hardhat";

// Connect to the network to get the ethers instance
const { ethers } = await network.connect();

describe("Vault", function () {
  it("allows deposit and withdraw", async function () {
    const [user] = await ethers.getSigners();

    const Vault = await ethers.getContractFactory("Vault");
    const vault = await Vault.deploy();

    const amount = ethers.parseEther("1");

    await vault.connect(user).deposit({ value: amount });

    expect(await vault.balances(user.address)).to.equal(amount);

    await vault.connect(user).withdraw(amount);

    expect(await vault.balances(user.address)).to.equal(0n);
  });
});
