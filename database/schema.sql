create table if not exists arcpass_invoices (
  invoice_id text primary key,
  merchant text not null,
  payload text not null unique,
  link text not null,
  invoice jsonb not null,
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists arcpass_invoices_merchant_created_idx
  on arcpass_invoices ((lower(merchant)), created_at desc);

create table if not exists arcpass_receipts (
  tx_hash text primary key,
  invoice_id text not null unique references arcpass_invoices(invoice_id) on delete restrict,
  merchant text not null,
  receipt jsonb not null,
  paid_at timestamptz not null
);

create index if not exists arcpass_receipts_merchant_paid_idx
  on arcpass_receipts ((lower(merchant)), paid_at desc);

create table if not exists arcpass_refund_requests (
  request_id text primary key,
  tx_hash text not null unique references arcpass_receipts(tx_hash) on delete restrict,
  invoice_id text not null references arcpass_invoices(invoice_id) on delete restrict,
  merchant text not null,
  payer text not null,
  status text not null check (status in ('pending', 'approved', 'declined')),
  request jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists arcpass_refunds_merchant_created_idx
  on arcpass_refund_requests ((lower(merchant)), created_at desc);

create table if not exists arcpass_merchant_challenges (
  message_hash text primary key,
  address text not null,
  message text not null,
  expires_at timestamptz not null
);

create index if not exists arcpass_merchant_challenges_expiry_idx
  on arcpass_merchant_challenges (expires_at);

create table if not exists arcpass_merchant_sessions (
  token_hash text primary key,
  address text not null,
  expires_at timestamptz not null
);

create index if not exists arcpass_merchant_sessions_expiry_idx
  on arcpass_merchant_sessions (expires_at);

create table if not exists arcpass_rate_limits (
  rate_key text primary key,
  request_count integer not null,
  reset_at timestamptz not null
);

create index if not exists arcpass_rate_limits_expiry_idx
  on arcpass_rate_limits (reset_at);
-- ArcPass is server-only. Block Supabase Data API roles even if public schema
-- grants are enabled at the project level.
alter table public.arcpass_invoices enable row level security;
alter table public.arcpass_receipts enable row level security;
alter table public.arcpass_refund_requests enable row level security;
alter table public.arcpass_merchant_challenges enable row level security;
alter table public.arcpass_merchant_sessions enable row level security;
alter table public.arcpass_rate_limits enable row level security;

revoke all privileges on table
  public.arcpass_invoices,
  public.arcpass_receipts,
  public.arcpass_refund_requests,
  public.arcpass_merchant_challenges,
  public.arcpass_merchant_sessions,
  public.arcpass_rate_limits
from anon, authenticated, public;
