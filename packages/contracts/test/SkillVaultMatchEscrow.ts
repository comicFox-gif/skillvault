import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("SkillVaultMatchEscrow", function () {
  async function deployFixture() {
    const [owner, player1, player2, treasury] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("SkillVaultMatchEscrow");
    const escrow = await Escrow.connect(owner).deploy(treasury.address);
    await escrow.waitForDeployment();
    return { escrow, owner, player1, player2, treasury };
  }

  it("creates a match and locks creator stake", async function () {
    const { escrow, player1, player2 } = await deployFixture();
    const stake = ethers.parseEther("1");

    await expect(
      escrow.connect(player1).createMatch(player2.address, stake, 3600, 600, { value: stake }),
    )
      .to.emit(escrow, "MatchCreated")
      .withArgs(0, player1.address, player2.address, stake);

    await expect(
      escrow.connect(player1).createMatch(player2.address, stake, 3600, 600, { value: stake }),
    )
      .to.emit(escrow, "Deposited")
      .withArgs(1, player1.address, stake);

    const created = await escrow.matches(0);
    expect(created.creator).to.equal(player1.address);
    expect(created.creatorPaid).to.equal(true);
    expect(created.opponentPaid).to.equal(false);
    expect(created.status).to.equal(0n); // Created
  });

  it("runs full flow: create -> join -> matching outcome reports auto-settle", async function () {
    const { escrow, player1, player2, treasury } = await deployFixture();
    const stake = ethers.parseEther("1");
    const totalPot = stake * 2n;
    const fee = (totalPot * 200n) / 10000n;
    const payout = totalPot - fee;

    await escrow.connect(player1).createMatch(player2.address, stake, 3600, 600, { value: stake });
    await escrow.connect(player2).joinMatch(0, { value: stake });

    const funded = await escrow.matches(0);
    expect(funded.status).to.equal(2n); // Funded

    await escrow.connect(player1).proposeWinner(0, player1.address);

    const winnerBefore = await ethers.provider.getBalance(player1.address);
    const treasuryBefore = await ethers.provider.getBalance(treasury.address);

    await expect(escrow.connect(player2).proposeWinner(0, player1.address))
      .to.emit(escrow, "WinnerConfirmed")
      .withArgs(0, player1.address, payout, fee);

    const winnerAfter = await ethers.provider.getBalance(player1.address);
    const treasuryAfter = await ethers.provider.getBalance(treasury.address);
    expect(winnerAfter - winnerBefore).to.equal(payout);
    expect(treasuryAfter - treasuryBefore).to.equal(fee);

    const resolved = await escrow.matches(0);
    expect(resolved.status).to.equal(5n); // Resolved
  });

  it("keeps result pending when only one player reports outcome", async function () {
    const { escrow, player1, player2 } = await deployFixture();
    const stake = ethers.parseEther("0.25");

    await escrow.connect(player1).createMatch(player2.address, stake, 3600, 600, { value: stake });
    await escrow.connect(player2).joinMatch(0, { value: stake });
    await escrow.connect(player1).proposeWinner(0, player1.address);

    const pending = await escrow.matches(0);
    expect(pending.status).to.equal(3n); // ResultProposed

    const escrowAddress = await escrow.getAddress();
    expect(await ethers.provider.getBalance(escrowAddress)).to.equal(stake * 2n);

    await escrow.connect(player2).dispute(0);
    const disputed = await escrow.matches(0);
    expect(disputed.status).to.equal(4n); // Disputed
  });

  it("keeps result pending when players submit conflicting outcomes", async function () {
    const { escrow, player1, player2 } = await deployFixture();
    const stake = ethers.parseEther("0.35");

    await escrow.connect(player1).createMatch(player2.address, stake, 3600, 600, { value: stake });
    await escrow.connect(player2).joinMatch(0, { value: stake });

    await escrow.connect(player1).proposeWinner(0, player1.address);
    await escrow.connect(player2).proposeWinner(0, player2.address);

    const pending = await escrow.matches(0);
    expect(pending.status).to.equal(3n); // ResultProposed
    expect(pending.proposedWinner).to.equal(ethers.ZeroAddress);

    const escrowAddress = await escrow.getAddress();
    expect(await ethers.provider.getBalance(escrowAddress)).to.equal(stake * 2n);
  });

  it("auto-settles immediately when a player reports they lost first", async function () {
    const { escrow, player1, player2, treasury } = await deployFixture();
    const stake = ethers.parseEther("0.45");
    const totalPot = stake * 2n;
    const fee = (totalPot * 200n) / 10000n;
    const payout = totalPot - fee;

    await escrow.connect(player1).createMatch(player2.address, stake, 3600, 600, { value: stake });
    await escrow.connect(player2).joinMatch(0, { value: stake });

    const winnerBefore = await ethers.provider.getBalance(player1.address);
    const treasuryBefore = await ethers.provider.getBalance(treasury.address);

    // Player2 submits "I lost", so winner is player1.
    await expect(escrow.connect(player2).proposeWinner(0, player1.address))
      .to.emit(escrow, "WinnerConfirmed")
      .withArgs(0, player1.address, payout, fee);

    const winnerAfter = await ethers.provider.getBalance(player1.address);
    const treasuryAfter = await ethers.provider.getBalance(treasury.address);
    expect(winnerAfter - winnerBefore).to.equal(payout);
    expect(treasuryAfter - treasuryBefore).to.equal(fee);

    const resolved = await escrow.matches(0);
    expect(resolved.status).to.equal(5n); // Resolved
    expect(resolved.proposedWinner).to.equal(player1.address);
  });

  it("lets a player forfeit and immediately pays the opponent", async function () {
    const { escrow, player1, player2, treasury } = await deployFixture();
    const stake = ethers.parseEther("0.5");
    const totalPot = stake * 2n;
    const fee = (totalPot * 200n) / 10000n;
    const payout = totalPot - fee;

    await escrow.connect(player1).createMatch(player2.address, stake, 3600, 600, { value: stake });
    await escrow.connect(player2).joinMatch(0, { value: stake });

    const opponentBefore = await ethers.provider.getBalance(player2.address);
    const treasuryBefore = await ethers.provider.getBalance(treasury.address);

    await expect(escrow.connect(player1).forfeit(0))
      .to.emit(escrow, "Forfeited")
      .withArgs(0, player1.address, player2.address);

    const opponentAfter = await ethers.provider.getBalance(player2.address);
    const treasuryAfter = await ethers.provider.getBalance(treasury.address);
    expect(opponentAfter - opponentBefore).to.equal(payout);
    expect(treasuryAfter - treasuryBefore).to.equal(fee);

    const resolved = await escrow.matches(0);
    expect(resolved.status).to.equal(5n); // Resolved
    expect(resolved.proposedWinner).to.equal(player2.address);
  });

  it("supports open matches where opponent is set on join", async function () {
    const { escrow, player1, player2 } = await deployFixture();
    const stake = ethers.parseEther("0.25");

    await escrow
      .connect(player1)
      .createMatch(ethers.ZeroAddress, stake, 3600, 600, { value: stake });
    await escrow.connect(player2).joinMatch(0, { value: stake });

    const matchState = await escrow.matches(0);
    expect(matchState.opponent).to.equal(player2.address);
    expect(matchState.status).to.equal(2n); // Funded
  });

  it("allows cancel during funded grace period and refunds both players", async function () {
    const { escrow, player1, player2 } = await deployFixture();
    const stake = ethers.parseEther("0.4");

    await escrow.connect(player1).createMatch(player2.address, stake, 3600, 600, { value: stake });
    await escrow.connect(player2).joinMatch(0, { value: stake });

    const escrowAddress = await escrow.getAddress();
    expect(await ethers.provider.getBalance(escrowAddress)).to.equal(stake * 2n);

    await escrow.connect(player1).cancel(0);

    const cancelled = await escrow.matches(0);
    expect(cancelled.status).to.equal(6n); // Cancelled
    expect(await ethers.provider.getBalance(escrowAddress)).to.equal(0n);
  });

  it("prevents cancel after 60-second grace period", async function () {
    const { escrow, player1, player2 } = await deployFixture();
    const stake = ethers.parseEther("0.2");

    await escrow.connect(player1).createMatch(player2.address, stake, 3600, 600, { value: stake });
    await escrow.connect(player2).joinMatch(0, { value: stake });

    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine", []);

    await expect(escrow.connect(player1).cancel(0)).to.be.revertedWith("Cancel window passed");
  });

  it("moves stale result proposals to dispute after confirm deadline", async function () {
    const { escrow, player1, player2 } = await deployFixture();
    const stake = ethers.parseEther("0.1");

    await escrow.connect(player1).createMatch(player2.address, stake, 3600, 10, { value: stake });
    await escrow.connect(player2).joinMatch(0, { value: stake });
    await escrow.connect(player1).proposeWinner(0, player1.address);

    await ethers.provider.send("evm_increaseTime", [11]);
    await ethers.provider.send("evm_mine", []);

    await expect(escrow.connect(player2).resolveProposalTimeout(0))
      .to.emit(escrow, "ProposalExpired")
      .withArgs(0);

    const disputed = await escrow.matches(0);
    expect(disputed.status).to.equal(4n); // Disputed
  });

  it("auto-finalizes uncontested winner after confirm deadline", async function () {
    const { escrow, player1, player2, treasury } = await deployFixture();
    const stake = ethers.parseEther("0.2");
    const totalPot = stake * 2n;
    const fee = (totalPot * 200n) / 10000n;
    const payout = totalPot - fee;

    await escrow.connect(player1).createMatch(player2.address, stake, 3600, 10, { value: stake });
    await escrow.connect(player2).joinMatch(0, { value: stake });
    await escrow.connect(player1).proposeWinner(0, player1.address);

    await ethers.provider.send("evm_increaseTime", [11]);
    await ethers.provider.send("evm_mine", []);

    const winnerBefore = await ethers.provider.getBalance(player1.address);
    const treasuryBefore = await ethers.provider.getBalance(treasury.address);

    await expect(escrow.connect(player2).finalizeResultAfterTimeout(0))
      .to.emit(escrow, "WinnerConfirmed")
      .withArgs(0, player1.address, payout, fee);

    const winnerAfter = await ethers.provider.getBalance(player1.address);
    const treasuryAfter = await ethers.provider.getBalance(treasury.address);
    expect(winnerAfter - winnerBefore).to.equal(payout);
    expect(treasuryAfter - treasuryBefore).to.equal(fee);

    const resolved = await escrow.matches(0);
    expect(resolved.status).to.equal(5n); // Resolved
  });

  it("auto-finalize sends conflicting timed-out result to dispute", async function () {
    const { escrow, player1, player2 } = await deployFixture();
    const stake = ethers.parseEther("0.2");

    await escrow.connect(player1).createMatch(player2.address, stake, 3600, 10, { value: stake });
    await escrow.connect(player2).joinMatch(0, { value: stake });
    await escrow.connect(player1).proposeWinner(0, player1.address);
    await escrow.connect(player2).proposeWinner(0, player2.address);

    await ethers.provider.send("evm_increaseTime", [11]);
    await ethers.provider.send("evm_mine", []);

    await expect(escrow.connect(player1).finalizeResultAfterTimeout(0))
      .to.emit(escrow, "Disputed")
      .withArgs(0);

    const disputed = await escrow.matches(0);
    expect(disputed.status).to.equal(4n); // Disputed
  });

  it("only allows admin to resolve disputes", async function () {
    const { escrow, owner, player1, player2 } = await deployFixture();
    const stake = ethers.parseEther("0.3");

    await escrow.connect(player1).createMatch(player2.address, stake, 3600, 600, { value: stake });
    await escrow.connect(player2).joinMatch(0, { value: stake });
    await escrow.connect(player1).dispute(0);

    await expect(
      escrow.connect(player1).adminResolve(0, ethers.ZeroAddress, true),
    ).to.be.revertedWith("Only admin");

    await escrow.connect(owner).adminResolve(0, ethers.ZeroAddress, true);
    const resolved = await escrow.matches(0);
    expect(resolved.status).to.equal(5n); // Resolved
  });

  it("rejects forfeit from non-players", async function () {
    const { escrow, owner, player1, player2 } = await deployFixture();
    const stake = ethers.parseEther("0.25");

    await escrow.connect(player1).createMatch(player2.address, stake, 3600, 600, { value: stake });
    await escrow.connect(player2).joinMatch(0, { value: stake });

    await expect(escrow.connect(owner).forfeit(0)).to.be.revertedWith("Not player");
  });
});
