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

create table if not exists arcpass_dispute_evidence (
  evidence_id text primary key,
  request_id text not null references arcpass_refund_requests(request_id) on delete cascade,
  role text not null check (role in ('payer', 'merchant')),
  signer text not null,
  signature text not null,
  evidence jsonb not null,
  created_at timestamptz not null,
  unique (request_id, signature)
);

create index if not exists arcpass_dispute_evidence_request_created_idx
  on arcpass_dispute_evidence (request_id, created_at asc);

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

create table if not exists arcpass_team_workspaces (
  merchant text primary key,
  workspace jsonb not null,
  updated_at timestamptz not null
);

create table if not exists arcpass_approval_requests (
  request_id text primary key,
  merchant text not null,
  status text not null check (status in ('pending', 'approved', 'expired')),
  request jsonb not null,
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists arcpass_approvals_merchant_created_idx
  on arcpass_approval_requests ((lower(merchant)), created_at desc);

create table if not exists arcpass_approval_signatures (
  request_id text not null references arcpass_approval_requests(request_id) on delete cascade,
  approver text not null,
  signature text not null,
  approved_at timestamptz not null,
  primary key (request_id, approver)
);

create table if not exists arcpass_webhook_endpoints (
  endpoint_id text primary key,
  merchant text not null,
  url text not null,
  events text[] not null,
  status text not null check (status in ('active', 'paused')),
  secret_ciphertext text not null,
  secret_hint text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (merchant, url)
);

create index if not exists arcpass_webhook_endpoints_merchant_created_idx
  on arcpass_webhook_endpoints ((lower(merchant)), created_at desc);

create table if not exists arcpass_webhook_deliveries (
  delivery_id text primary key,
  endpoint_id text not null references arcpass_webhook_endpoints(endpoint_id) on delete cascade,
  event_id text not null,
  event_type text not null,
  status text not null check (status in ('pending', 'delivered', 'failed')),
  event jsonb not null,
  attempt_count integer not null default 0,
  response_status integer,
  last_error text,
  created_at timestamptz not null,
  delivered_at timestamptz,
  unique (endpoint_id, event_id)
);

create index if not exists arcpass_webhook_deliveries_endpoint_created_idx
  on arcpass_webhook_deliveries (endpoint_id, created_at desc);

-- ArcPass is server-only. Block Supabase Data API roles even if public schema
-- grants are enabled at the project level.
alter table public.arcpass_invoices enable row level security;
alter table public.arcpass_receipts enable row level security;
alter table public.arcpass_refund_requests enable row level security;
alter table public.arcpass_dispute_evidence enable row level security;
alter table public.arcpass_merchant_challenges enable row level security;
alter table public.arcpass_merchant_sessions enable row level security;
alter table public.arcpass_rate_limits enable row level security;
alter table public.arcpass_team_workspaces enable row level security;
alter table public.arcpass_approval_requests enable row level security;
alter table public.arcpass_approval_signatures enable row level security;
alter table public.arcpass_webhook_endpoints enable row level security;
alter table public.arcpass_webhook_deliveries enable row level security;

revoke all privileges on table
  public.arcpass_invoices,
  public.arcpass_receipts,
  public.arcpass_refund_requests,
  public.arcpass_dispute_evidence,
  public.arcpass_merchant_challenges,
  public.arcpass_merchant_sessions,
  public.arcpass_rate_limits,
  public.arcpass_team_workspaces,
  public.arcpass_approval_requests,
  public.arcpass_approval_signatures,
  public.arcpass_webhook_endpoints,
  public.arcpass_webhook_deliveries
from anon, authenticated, public;
