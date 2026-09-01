# ArcPass

ArcPass combines a merchant passport with buyer-readable stablecoin payment links on Arc Testnet.

## What works now

- Merchant access through an installed EVM wallet or a Circle user-controlled email wallet, both protected by a server-verified signature
- Domain manifest verification at `/.well-known/arcpass.json`
- Verified invoice link generation
- Public checkout page at `/pay/[payload]`
- Arc Testnet ERC-20 transfer flow for USDC/EURC style payments
- Cross-chain USDC checkout preparation from Ethereum, Base, or Arbitrum Sepolia through Circle CCTP Standard Transfer
- Read-only Circle Gateway unified USDC balance with per-chain allocation, pending deposits, and invoice coverage
- Payment Intent Center derived from registered invoices and verified Arc receipts, with action queues and lifecycle visibility
- Partial payments through exact installment schedules, where every stage is a separately locked invoice with its own verified Arc receipt
- Merchant-approved recurring invoice schedules with cycle tracking and no automatic wallet charges
- Wallet-bound team roles and threshold approval policies with gas-free, invoice-specific approval signatures
- Merchant-owned webhook endpoints with signed invoice, payment, refund, dispute, and approval events plus delivery history and manual retries
- Dispute Evidence Rooms with payer and merchant wallet signatures, HTTPS evidence references, optional SHA256 file proofs, and signed final decisions
- Source USDC, native gas, route fee, and invoice-state preflight before any bridge transaction is requested
- Local invoice and receipt cache for fast merchant access
- PostgreSQL-backed invoices, receipts, dispute evidence, team policies, approval signatures, webhooks, merchant sessions, challenges, and rate limits
- Payment blocked until the invoice is confirmed in the ArcPass server registry
- One Arc transaction hash and one verified receipt per invoice
- Verified merchant domains rechecked against public DNS, wallet, and ArcPass manifest data
- Filtered invoice and verified receipt CSV exports

## Database

Set `DATABASE_URL` to the Supabase Transaction Pooler connection in `.env.local`.
Set `ARCPASS_WEBHOOK_ENCRYPTION_KEY` to a random value containing at least 32 characters. ArcPass uses it to encrypt webhook signing secrets at rest.
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

## Circle email wallet onboarding

Set `CIRCLE_API_KEY` and `NEXT_PUBLIC_CIRCLE_APP_ID` to enable the email wallet option. In the Circle Developer Console, configure a user-controlled wallet application, enable email authentication, and add SMTP settings. ArcPass creates EOA wallets on `ARC-TESTNET`, keeps Circle user tokens only in page memory, and never receives a private key, PIN, or recovery material.

Without these values, the Wallet tab keeps browser wallet access available and shows a configuration notice for the email option.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.
