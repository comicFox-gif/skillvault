import { network } from "hardhat";

const WATCH_MODE = process.env.KEEPER_WATCH === "1" || process.argv.includes("--watch");
const POLL_MS = Number(process.env.KEEPER_POLL_MS || "5000");
const MATCH_SCAN_LIMIT = Math.max(0, Number(process.env.KEEPER_MATCH_SCAN_LIMIT || "0"));
const FINALIZE_RETRIES = Math.max(0, Number(process.env.KEEPER_FINALIZE_RETRIES || "2"));
const TX_CONFIRMATIONS = Math.max(1, Number(process.env.KEEPER_TX_CONFIRMATIONS || "1"));
const DRY_RUN = process.env.KEEPER_DRY_RUN === "1";
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

function summarizeError(error: any) {
  return error?.shortMessage || error?.reason || error?.message || String(error);
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
  const keeperBalance = await ethers.provider.getBalance(keeper.address);
  const latestBlock = await ethers.provider.getBlock("latest");
  if (!latestBlock || latestBlock.timestamp == null) {
    throw new Error("Unable to read latest block timestamp");
  }
  const now = BigInt(latestBlock.timestamp);
  const scanLimitBig = MATCH_SCAN_LIMIT > 0 ? BigInt(MATCH_SCAN_LIMIT) : 0n;
  const startId = scanLimitBig > 0n && nextMatchId > scanLimitBig ? nextMatchId - scanLimitBig : 0n;

  let finalized = 0;
  let skipped = 0;
  let errors = 0;
  let scanned = 0;

  console.log(
    `[keeper] signer=${keeper.address} balance=${ethers.formatEther(keeperBalance)} | scan=${startId}..${nextMatchId - 1n}`,
  );

  for (let id = startId; id < nextMatchId; id += 1n) {
    scanned += 1;
    let m: any;
    try {
      m = await escrow.matches(id);
    } catch (error: any) {
      errors += 1;
      console.log(`[keeper] read matches(${id}) failed: ${summarizeError(error)}`);
      continue;
    }
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
      const likelyPayout =
        (creatorSet && !opponentSet) ||
        (!creatorSet && opponentSet) ||
        (creatorSet && opponentSet && creatorVote === opponentVote);
      console.log(
        `[keeper] match ${id} timed out (confirmBy=${confirmBy}, now=${now}) | creatorVote=${creatorVote} opponentVote=${opponentVote} -> ${likelyPayout ? "payout" : "dispute"}`,
      );

      if (DRY_RUN) {
        console.log(`[keeper] dry-run: would call finalizeResultAfterTimeout(${id})`);
        finalized += 1;
        continue;
      }

      let success = false;
      for (let attempt = 0; attempt <= FINALIZE_RETRIES; attempt += 1) {
        try {
          const tx = await escrow.finalizeResultAfterTimeout(id);
          console.log(`[keeper] finalizeResultAfterTimeout(${id}) submitted: ${tx.hash}`);
          await tx.wait(TX_CONFIRMATIONS);
          finalized += 1;
          success = true;
          break;
        } catch (error: any) {
          const message = summarizeError(error);
          const isFinalAttempt = attempt >= FINALIZE_RETRIES;
          if (isFinalAttempt) {
            throw error;
          }
          console.log(
            `[keeper] retry ${attempt + 1}/${FINALIZE_RETRIES} for match ${id} after error: ${message}`,
          );
          await sleep(1200 * (attempt + 1));
        }
      }
      if (!success) {
        skipped += 1;
      }
    } catch (error: any) {
      errors += 1;
      console.log(`[keeper] skip match ${id}: ${summarizeError(error)}`);
    }
  }

  console.log(
    `[keeper] scan complete on ${ACTIVE_NETWORK}: scanned=${scanned}, total=${nextMatchId}, finalized=${finalized}, skipped=${skipped}, errors=${errors}`,
  );
}

async function main() {
  console.log(
    `[keeper] starting on network=${ACTIVE_NETWORK}, watch=${WATCH_MODE}, poll=${POLL_MS}ms, scanLimit=${MATCH_SCAN_LIMIT || "all"}, retries=${FINALIZE_RETRIES}, confirmations=${TX_CONFIRMATIONS}, dryRun=${DRY_RUN}`,
  );
  do {
    try {
      await runOnce();
    } catch (error: any) {
      console.log(`[keeper] run failed: ${summarizeError(error)}`);
      if (!WATCH_MODE) throw error;
    }
    if (!WATCH_MODE) break;
    await sleep(POLL_MS);
  } while (true);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
