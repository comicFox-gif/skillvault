import { network } from "hardhat";

const WATCH_MODE = process.env.KEEPER_WATCH === "1" || process.argv.includes("--watch");
const POLL_MS = Number(process.env.KEEPER_POLL_MS || "5000");
const CLI_NETWORK = (() => {
  const idx = process.argv.findIndex((arg) => arg === "--network");
  return idx >= 0 ? process.argv[idx + 1] : undefined;
})();
const ACTIVE_NETWORK = process.env.HARDHAT_NETWORK || CLI_NETWORK || "unknown";

function resolveEscrowAddress() {
  const normalized = ACTIVE_NETWORK.toLowerCase();
  if (normalized.includes("polkadot")) {
    return process.env.POLKADOT_MATCH_ESCROW_ADDRESS || process.env.MATCH_ESCROW_ADDRESS;
  }
  if (normalized.includes("moonbase")) {
    return process.env.MOONBASE_MATCH_ESCROW_ADDRESS || process.env.MATCH_ESCROW_ADDRESS;
  }
  return process.env.MATCH_ESCROW_ADDRESS;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOnce() {
  const { ethers } = await network.connect();
  const [keeper] = await ethers.getSigners();

  const escrowAddress = resolveEscrowAddress();
  if (
    !escrowAddress ||
    !ethers.isAddress(escrowAddress) ||
    escrowAddress.toLowerCase() === ethers.ZeroAddress.toLowerCase()
  ) {
    throw new Error(
      "Set a valid escrow address in .env (network-specific key or MATCH_ESCROW_ADDRESS).",
    );
  }

  const escrow = await ethers.getContractAt("SkillVaultMatchEscrow", escrowAddress, keeper);
  const nextMatchId = await escrow.nextMatchId();
  const latestBlock = await ethers.provider.getBlock("latest");
  if (!latestBlock || latestBlock.timestamp == null) {
    throw new Error("Unable to read latest block timestamp");
  }
  const now = BigInt(latestBlock.timestamp);

  let finalized = 0;
  let skipped = 0;
  let errors = 0;

  for (let id = 0n; id < nextMatchId; id += 1n) {
    const m = await escrow.matches(id);
    const status = Number(m.status);
    const confirmBy = BigInt(m.confirmBy);

    // ResultProposed only.
    if (status !== 3) {
      skipped += 1;
      continue;
    }

    // Wait until confirm deadline has passed.
    if (now <= confirmBy) {
      skipped += 1;
      continue;
    }

    try {
      const creatorVote = await escrow.creatorReportedWinner(id);
      const opponentVote = await escrow.opponentReportedWinner(id);
      const creatorSet = creatorVote !== ethers.ZeroAddress;
      const opponentSet = opponentVote !== ethers.ZeroAddress;
      const likelyPayout = (creatorSet && !opponentSet) || (!creatorSet && opponentSet) || (creatorSet && opponentSet && creatorVote === opponentVote);
      console.log(
        `[keeper] match ${id} timed out (confirmBy=${confirmBy}, now=${now}) | creatorVote=${creatorVote} opponentVote=${opponentVote} -> ${likelyPayout ? "payout" : "dispute"}`,
      );

      const tx = await escrow.finalizeResultAfterTimeout(id);
      console.log(`[keeper] finalizeResultAfterTimeout(${id}) submitted: ${tx.hash}`);
      await tx.wait();
      finalized += 1;
    } catch (error: any) {
      errors += 1;
      console.log(`[keeper] skip match ${id}: ${error?.shortMessage || error?.message || String(error)}`);
    }
  }

  console.log(
    `[keeper] scan complete on ${ACTIVE_NETWORK} with ${nextMatchId} matches: finalized=${finalized}, skipped=${skipped}, errors=${errors}`,
  );
}

async function main() {
  console.log(`[keeper] starting on network=${ACTIVE_NETWORK}, watch=${WATCH_MODE}, poll=${POLL_MS}ms`);
  do {
    await runOnce();
    if (!WATCH_MODE) break;
    await sleep(POLL_MS);
  } while (true);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
