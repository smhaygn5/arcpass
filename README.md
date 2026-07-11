# ArcPass

ArcPass combines a merchant passport with buyer-readable stablecoin payment links on Arc Testnet.

## What works now

- Merchant wallet connection with a server-verified signature
- Domain manifest verification at `/.well-known/arcpass.json`
- Verified invoice link generation
- Public checkout page at `/pay/[payload]`
- Arc Testnet ERC-20 transfer flow for USDC/EURC style payments
- Local invoice and receipt cache for fast merchant access
- PostgreSQL-backed invoices, receipts, merchant sessions, challenges, and rate limits
- Payment blocked until the invoice is confirmed in the ArcPass server registry
- One Arc transaction hash and one verified receipt per invoice
- Verified merchant domains rechecked against public DNS, wallet, and ArcPass manifest data
- Filtered invoice and verified receipt CSV exports

## Database

Set `DATABASE_URL` to the Supabase Transaction Pooler connection in `.env.local`.
The migration enables RLS and revokes Supabase Data API access for every ArcPass table; database access is server-only.
`DIRECT_URL` may be set to a Session Pooler connection for maintenance, but migrations use the working transaction connection by default.

```bash
npm run db:migrate
npm run db:check
```

With the local development server running, verify the complete signature and invoice persistence flow:

```bash
npm run db:smoke
```

When `DATABASE_URL` is absent, ArcPass falls back to the git-ignored `.arcpass-data` JSON ledgers for local tests and offline development.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.