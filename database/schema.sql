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