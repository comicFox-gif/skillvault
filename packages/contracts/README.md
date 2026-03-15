# Skill Vault Contracts

Hardhat 3 workspace for `SkillVaultMatchEscrow` and helper contracts.

## Install

```bash
npm install
```

## Local dev

```bash
npx hardhat compile
npx hardhat test
```

## Polkadot ecosystem EVM deployment (Moonbase Alpha)

1. Copy `.env.example` to `.env` in this folder.
2. Fill `MOONBASE_ALPHA_RPC_URL` and `MOONBASE_PRIVATE_KEY`.
3. Deploy:

```bash
npm run deploy:escrow:moonbase
```

You can also run manually:

```bash
npx hardhat run --network moonbaseAlpha scripts/deploy-match-escrow.ts
```

## Notes

- `MATCH_ESCROW_TREASURY` is optional and defaults to deployer.
- `moonbeam` mainnet network is also configured in `hardhat.config.ts`.

## Keeper bot (anti-stall settlement)

Use the keeper to auto-finalize timed-out result proposals so players cannot stall payouts by refusing to respond.

1. Set `MATCH_ESCROW_ADDRESS` in `.env`.
2. Run one scan:

```bash
npm run keeper:escrow:moonbase
```

3. Run continuously:

```bash
npm run keeper:escrow:moonbase:watch
```

Optional:
- `KEEPER_POLL_MS` controls watch interval (default `5000`).
