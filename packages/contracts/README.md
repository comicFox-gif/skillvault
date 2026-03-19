# Skill Vault Contracts

Hardhat 3 workspace for `SkillVaultMatchEscrow`.

## Install

```bash
npm install
```

## Local Dev

```bash
npx hardhat compile
npx hardhat test
```

## Deploy

### Polkadot Hub TestNet

```bash
npm run deploy:escrow:polkadot
```

Manual:

```bash
npx hardhat run --network polkadotHubTestnet scripts/deploy-match-escrow.ts
```

### Moonbase Alpha

```bash
npm run deploy:escrow:moonbase
```

Manual:

```bash
npx hardhat run --network moonbaseAlpha scripts/deploy-match-escrow.ts
```

## Keeper

Set one of these in `.env` before running keeper:
- `POLKADOT_MATCH_ESCROW_ADDRESS`
- `MOONBASE_MATCH_ESCROW_ADDRESS`
- or fallback `MATCH_ESCROW_ADDRESS`

Run once:

```bash
npm run keeper:escrow:polkadot
npm run keeper:escrow:moonbase
```

Run watch mode:

```bash
npm run keeper:escrow:polkadot:watch
npm run keeper:escrow:moonbase:watch
```

## Notes

- `MATCH_ESCROW_TREASURY` is optional and defaults to deployer.
- `KEEPER_POLL_MS` default is `5000`.
