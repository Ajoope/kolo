# Kolo — Communal Savings on Solana

Decentralized rotating savings circles (Ajo / ROSCA) with collateral protection, built on Solana Devnet with Anchor.

## What is Kolo?

Kolo lets communities run rotating savings circles on-chain. Members lock 1× their contribution as collateral, pay a fixed amount each round, and the smart vault automatically releases the full collected pot to one member per round. Defaulters are skipped ahead and charged a late fee; the protocol enforces the rules so no trusted middleman is needed.

- **Program:** Anchor (Rust), deployed to devnet at `BVNGa6bQ7xPoiXd3Gz1JANVBVugbXD1Q5WQaAYAZ2y5c`
- **Frontend:** Next.js 16 + React 19 + TypeScript + Tailwind CSS v4
- **Solana client:** `@solana/kit` + wallet-standard (Privy embedded wallets + Phantom)
- **Program client:** Codama-generated TypeScript client

## Getting Started

```shell
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), connect a wallet (or use email login to create a seedless wallet), and interact with the ledger.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run anchor-build` | Build the Anchor program (`--ignore-keys`) |
| `npm run anchor-test` | Run Anchor tests via LiteSVM |
| `npm run setup` | Build program + regenerate Codama client |
| `node scripts/setup-wallets.mjs` | Airdrop SOL to a fresh wallet 2 |
| `node scripts/create-devnet-circle.ts` | Create a test circle on devnet |
| `node scripts/verify-accounts.mjs` | Decode all Kolo program accounts from devnet |

## Local Development

To test against a local validator instead of devnet:

1. **Start a local validator**

   ```bash
   solana-test-validator
   ```

2. **Deploy the program locally**

   ```bash
   solana config set --url localhost
   cd anchor
   anchor build
   anchor deploy
   cd ..
   npm run codama:js   # Regenerate client with local program ID
   ```

3. **Switch to localnet** in the app using the cluster selector in the header.

## Deploy Your Own Program

1. **Configure Solana CLI for devnet**

   ```bash
   solana config set --url devnet
   ```

2. **Create a wallet (if needed) and fund it**

   ```bash
   solana-keygen new
   solana airdrop 2
   ```

3. **Build and deploy the program**

   ```bash
   cd anchor
   anchor build
   anchor keys sync    # Updates program ID in source
   anchor build        # Rebuild with new ID
   anchor deploy
   cd ..
   ```

4. **Regenerate the client and restart**

   ```bash
   npm run setup   # Rebuilds program and regenerates client
   npm run dev
   ```

## Testing

Tests use [LiteSVM](https://github.com/LiteSVM/litesvm), a fast lightweight Solana VM for testing.

```bash
npm run anchor-build   # Build the program first
npm run anchor-test    # Run tests
```

The tests are in `anchor/programs/vault/src/tests.rs` and automatically use the program ID from `declare_id!`.

## Project Structure

```
├── app/
│   ├── components/
│   │   ├── circle-view.tsx         # Full create/join/contribute/release UI
│   │   ├── create-circle-modal.tsx # Circle creation form
│   │   ├── dashboard-view.tsx      # Ledger overview + member list
│   │   ├── onboarding-modal.tsx    # Email (Privy) + wallet connect flow
│   │   ├── providers.tsx           # Wallet + theme providers
│   │   └── wallet-button.tsx       # Wallet connect/disconnect dropdown
│   ├── generated/vault/           # Codama-generated program client
│   ├── lib/
│   │   ├── hooks/
│   │   │   ├── use-balance.ts      # SWR-based balance fetching (direct RPC + timeout)
│   │   │   ├── use-circles.ts      # SWR fetcher for all circle accounts
│   │   │   └── use-send-transaction.ts  # Transaction send + confirmation polling
│   │   ├── kolo/                   # Program helpers (PDAs, constants, decoders)
│   │   └── wallet/                 # Wallet-standard connection layer
│   └── page.tsx                    # Landing page
├── anchor/
│   └── programs/vault/             # Anchor program (Rust)
│       ├── src/
│       │   ├── lib.rs              # Instructions: create/join/contribute/release/complete
│       │   └── tests.rs            # LiteSVM tests (10 passing)
└── scripts/                        # Devnet helper scripts
```

## Learn More

- [Solana Docs](https://solana.com/docs) — core concepts and guides
- [Anchor Docs](https://www.anchor-lang.com/docs/introduction) — program development framework
- [Deploying Programs](https://solana.com/docs/programs/deploying) — deployment guide
- [@solana/kit](https://github.com/anza-xyz/kit) — Solana JavaScript SDK
- [Codama](https://github.com/codama-idl/codama) — client generation from IDL