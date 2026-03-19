# Skill Vault

Skill Vault is a Web3 skill-gaming escrow platform for 1v1 matches and tournaments.

Players lock equal stakes into an on-chain escrow, play a match, and settle outcomes on EVM testnets (Polkadot Hub TestNet + Moonbase Alpha). A keeper bot auto-finalizes timed-out results so one player cannot indefinitely block payouts by going offline.

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
- Multi-chain support for Polkadot Hub TestNet (`PAS`) and Moonbase Alpha (`DEV`)

## Tech Stack

- Frontend: Next.js 16, React 19, Tailwind CSS 4
- Wallet/Web3: wagmi, viem, RainbowKit
- Contracts: Solidity 0.8.28, Hardhat 3, ethers v6
- Monorepo tooling: npm workspaces, Turborepo

## Keeper Bot (Anti-Stall Settlement)

Script: `packages/contracts/scripts/keeper-match-escrow.ts`

Run once (Polkadot):

```bash
npm run keeper:escrow:polkadot -w contracts
```

Run watch mode (Polkadot):

```bash
npm run keeper:escrow:polkadot:watch -w contracts
```

Moonbase equivalents:

```bash
npm run keeper:escrow:moonbase -w contracts
npm run keeper:escrow:moonbase:watch -w contracts
```

On macOS/Linux:

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
POLKADOT_TESTNET_RPC_URL=https://eth-rpc-testnet.polkadot.io/
POLKADOT_TESTNET_PRIVATE_KEY=0xYOUR_PRIVATE_KEY

MOONBASE_ALPHA_RPC_URL=https://rpc.api.moonbase.moonbeam.network
MOONBASE_PRIVATE_KEY=0xYOUR_PRIVATE_KEY

MATCH_ESCROW_TREASURY=0x0000000000000000000000000000000000000000
MATCH_ESCROW_ADDRESS=0x0000000000000000000000000000000000000000
POLKADOT_MATCH_ESCROW_ADDRESS=0x0000000000000000000000000000000000000000
MOONBASE_MATCH_ESCROW_ADDRESS=0x0000000000000000000000000000000000000000
KEEPER_POLL_MS=15000
```

### 3) Configure web env

Create `apps/web/.env.local` from `apps/web/.env.example`:

```env
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=YOUR_WALLETCONNECT_PROJECT_ID
NEXT_PUBLIC_MATCH_ESCROW_ADDRESS=0x0000000000000000000000000000000000000000

NEXT_PUBLIC_POLKADOT_CHAIN_ID=420420417
NEXT_PUBLIC_POLKADOT_CHAIN_NAME=Polkadot Hub TestNet
NEXT_PUBLIC_POLKADOT_NATIVE_NAME=Polkadot Asset Hub TestNet
NEXT_PUBLIC_POLKADOT_NATIVE_SYMBOL=PAS
NEXT_PUBLIC_POLKADOT_RPC_URL=https://eth-rpc-testnet.polkadot.io/
NEXT_PUBLIC_POLKADOT_EXPLORER_URL=https://blockscout-passet-hub.parity-testnet.parity.io/
NEXT_PUBLIC_POLKADOT_CHAIN_TESTNET=true
NEXT_PUBLIC_POLKADOT_MATCH_ESCROW_ADDRESS=0x0000000000000000000000000000000000000000

NEXT_PUBLIC_MOONBASE_CHAIN_ID=1287
NEXT_PUBLIC_MOONBASE_CHAIN_NAME=Moonbase Alpha
NEXT_PUBLIC_MOONBASE_NATIVE_NAME=DEV
NEXT_PUBLIC_MOONBASE_NATIVE_SYMBOL=DEV
NEXT_PUBLIC_MOONBASE_RPC_URL=https://rpc.api.moonbase.moonbeam.network
NEXT_PUBLIC_MOONBASE_EXPLORER_URL=https://moonbase.moonscan.io
NEXT_PUBLIC_MOONBASE_CHAIN_TESTNET=true
NEXT_PUBLIC_MOONBASE_MATCH_ESCROW_ADDRESS=0x0000000000000000000000000000000000000000

NEXT_PUBLIC_ADMIN_PASSWORD=2162
```

### 4) Run app

```bash
npm run dev -w web
```

## Deploy

Deploy to Polkadot:

```bash
npm run deploy:escrow:polkadot -w contracts
```

Deploy to Moonbase:

```bash
npm run deploy:escrow:moonbase -w contracts
```

After deploy:
- Set `NEXT_PUBLIC_POLKADOT_MATCH_ESCROW_ADDRESS` and `NEXT_PUBLIC_MOONBASE_MATCH_ESCROW_ADDRESS`
- Set keeper targets `POLKADOT_MATCH_ESCROW_ADDRESS` and `MOONBASE_MATCH_ESCROW_ADDRESS`

## Admin

- Admin route: `/comicfoxxx`
- `/admin` is disabled (not found)

## License

ISC
