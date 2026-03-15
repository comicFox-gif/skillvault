# Skill Vault

Skill Vault is a Web3 skill-gaming escrow platform for 1v1 matches and tournaments.

Players lock equal stakes into an on-chain escrow, play a match, and settle outcomes on Moonbase Alpha (Polkadot ecosystem EVM). A keeper bot auto-finalizes timed-out results so one player cannot indefinitely block payouts by going offline.

This repo is organized as a monorepo with:
- `apps/web`: Next.js frontend
- `packages/contracts`: Hardhat contracts, tests, deploy scripts, keeper bot

## Highlights

- 1v1 match escrow with on-chain stake locking
- 6-digit room codes for match sharing
- Creator/opponent flow with join-and-lock logic
- 60-second cancel grace window after opponent joins
- Outcome flow: `I won`, `I lost`, accept/cancel to dispute
- Timeout settlement automation via keeper bot
- On-chain player history panel (wins/losses/disputes/no-response flags)
- Moonbase Alpha native token support (`DEV`)

## Tech Stack

- Frontend: Next.js 16, React 19, Tailwind CSS 4
- Wallet/Web3: wagmi, viem, RainbowKit
- Contracts: Solidity 0.8.28, Hardhat 3, ethers v6
- Monorepo tooling: npm workspaces, Turborepo

## Monorepo Structure

```text
skill-vault/
  apps/
    web/                      # Next.js app
  packages/
    contracts/                # Hardhat workspace
      contracts/
        SkillVaultMatchEscrow.sol
      scripts/
        deploy-match-escrow.ts
        keeper-match-escrow.ts
      test/
        SkillVaultMatchEscrow.ts
```

## Escrow Contract Overview

Main contract: `packages/contracts/contracts/SkillVaultMatchEscrow.sol`

Core functions:
- `createMatch(opponent, stake, joinWindow, confirmWindow)` (payable)
- `joinMatch(matchId)` (payable)
- `proposeWinner(matchId, winner)`
- `confirmWinner(matchId)`
- `dispute(matchId)`
- `cancel(matchId)`
- `forfeit(matchId)` (available in contract; UI currently focuses on outcome/dispute flow)
- `finalizeResultAfterTimeout(matchId)` for timed-out result proposals
- `adminResolve(matchId, winner, refundBoth)` for disputed/stuck matches

State progression:
- `Created -> Funded -> ResultProposed -> Resolved`
- `ResultProposed -> Disputed -> Resolved` when conflict/forced dispute
- `Created/Funded -> Cancelled` during valid cancel windows

Payout model:
- Total pot is `stake * 2`
- Platform fee: `2%` (`FEE_BPS = 200`)
- Winner receives `98%` of total pot

## Keeper Bot (Anti-Stall Settlement)

Script: `packages/contracts/scripts/keeper-match-escrow.ts`

What it does:
- Scans all matches up to `nextMatchId`
- Finds matches in `ResultProposed` with expired `confirmBy`
- Calls `finalizeResultAfterTimeout(matchId)`

Why it matters:
- If one player reports result and the other rage quits/offlines, timeout can still settle automatically
- Removes dependency on the non-responsive player to unblock payout

Run once:

```bash
npm run keeper:escrow:moonbase -w contracts
```

Run in watch mode:

```bash
npm run keeper:escrow:moonbase:watch -w contracts
```

Note: the npm watch script uses Windows env syntax (`set KEEPER_WATCH=1&& ...`).  
On macOS/Linux, run:

```bash
cd packages/contracts
KEEPER_WATCH=1 npx hardhat run --network moonbaseAlpha scripts/keeper-match-escrow.ts
```

## Local Setup

### 1) Install dependencies

```bash
npm install
```

### 2) Configure contracts env

Create `packages/contracts/.env` from `packages/contracts/.env.example`:

```env
MOONBASE_ALPHA_RPC_URL=https://rpc.api.moonbase.moonbeam.network
MOONBASE_PRIVATE_KEY=0xYOUR_DEPLOYER_OR_KEEPER_PRIVATE_KEY

MOONBEAM_RPC_URL=https://rpc.api.moonbeam.network
MOONBEAM_PRIVATE_KEY=0xYOUR_MAINNET_KEY

MATCH_ESCROW_TREASURY=0x0000000000000000000000000000000000000000
MATCH_ESCROW_ADDRESS=0x0000000000000000000000000000000000000000
KEEPER_POLL_MS=15000
```

### 3) Configure web env

Create `apps/web/.env.local` from `apps/web/.env.example`:

```env
NEXT_PUBLIC_MATCH_ESCROW_ADDRESS=0x0000000000000000000000000000000000000000
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=YOUR_WALLETCONNECT_PROJECT_ID

NEXT_PUBLIC_CHAIN_ID=1287
NEXT_PUBLIC_CHAIN_NAME=Moonbase Alpha
NEXT_PUBLIC_NATIVE_NAME=DEV
NEXT_PUBLIC_NATIVE_SYMBOL=DEV
NEXT_PUBLIC_RPC_URL=https://rpc.api.moonbase.moonbeam.network
NEXT_PUBLIC_EXPLORER_URL=https://moonbase.moonscan.io
NEXT_PUBLIC_CHAIN_TESTNET=true
```

Optional for admin UI:

```env
NEXT_PUBLIC_ADMIN_PASSWORD=2162
```

### 4) Run the frontend

From repo root:

```bash
npm run dev
```

Or only web workspace:

```bash
npm run dev -w web
```

## Contract Development

Compile:

```bash
npm run compile -w contracts
```

Run tests:

```bash
npm run test -w contracts
```

Escrow-focused tests:

```bash
npm run test:escrow -w contracts
```

Deploy to Moonbase Alpha:

```bash
npm run deploy:escrow:moonbase -w contracts
```

After deploy:
- Copy deployed escrow address to `packages/contracts/.env` as `MATCH_ESCROW_ADDRESS`
- Copy same address to `apps/web/.env.local` as `NEXT_PUBLIC_MATCH_ESCROW_ADDRESS`

## Frontend Feature Notes

- Home page status indicator is online only when wallet is connected
- Create Match flow auto-opens match control center after successful creation
- Match IDs shown as 6-digit room codes (legacy IDs remain compatible)
- If room already has creator+opponent and a third wallet tries to join, UI shows `Room Full`
- Opponent can join and lock stake directly from room page
- Outcome controls unlock only after the 60-second post-join grace window
- Match page shows wallet balance
- Match page shows total stake / possible win panel
- Match page shows timeout countdown for keeper auto-finalization
- Match page shows post-match actions (`Rematch Same Stake`, `Exit + New Amount`)

## Admin and Tournaments

- `/admin`: basic dispute resolution panel (password-gated in frontend)
- `/tournaments/*`: currently mock UI/demo pages, not wired to on-chain tournament contracts yet

## Security and Production Notes

- This repository is currently optimized for hackathon/demo flow
- `NEXT_PUBLIC_ADMIN_PASSWORD` is client-exposed and not production secure
- Frontend reads on-chain history directly by scanning matches; this can become heavy at scale
- For production, use an indexer/database for analytics/history and move admin auth server-side
- Never commit real private keys or funded wallet secrets

## Suggested Roadmap

- Add backend/indexer for scalable match history and reputation
- Implement robust tournament smart contracts and bracket state
- Add server-side admin auth and role-based controls
- Add alerts/monitoring for keeper health and settlement failures
- Add full audit hardening before mainnet use

## License

ISC
