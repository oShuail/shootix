-- ==========================================================
--  SHOOTIX — Supabase schema
--  Run once in  Supabase Dashboard → SQL Editor → New query.
--  Safe to re-run: every statement is idempotent.
--
--  Everything the site stores lives here, so nothing is ever
--  lost when the app restarts or redeploys.
-- ==========================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------
--  TEAM MEMBERS
-- ----------------------------------------------------------
create table if not exists shootix_users (
    id             uuid primary key default gen_random_uuid(),
    username       text unique not null,
    name           text not null,
    role           text not null default 'employee' check (role in ('admin', 'employee')),
    password_hash  text not null,
    email          text,
    phone          text,
    job_title      text,
    active         boolean not null default true,
    -- bumped on password change / forced logout so old cookies stop working
    token_version  integer not null default 0,
    created_at     timestamptz not null default now(),
    last_login_at  timestamptz
);

create index if not exists shootix_users_username_idx on shootix_users (username);

-- ----------------------------------------------------------
--  PORTFOLIO IMAGES  (files live in Supabase Storage)
-- ----------------------------------------------------------
create table if not exists shootix_gallery (
    id            uuid primary key default gen_random_uuid(),
    category      text not null,
    title         text not null default '',
    title_en      text not null default '',
    storage_path  text not null,
    url           text not null,
    bytes         integer,
    featured      boolean not null default false,
    sort_order    integer not null default 0,
    uploaded_by   text,
    created_at    timestamptz not null default now()
);

create index if not exists shootix_gallery_category_idx on shootix_gallery (category, sort_order, created_at);

-- ----------------------------------------------------------
--  RECEIPTS
-- ----------------------------------------------------------
create table if not exists shootix_receipts (
    id             uuid primary key default gen_random_uuid(),
    number         text unique not null,
    seq            bigint,
    date           date not null default current_date,
    client_name    text not null,
    client_phone   text default '',
    client_email   text default '',
    project        text default '',
    payment_method text default '',
    status         text not null default 'paid' check (status in ('paid', 'partial', 'unpaid')),
    notes          text default '',
    items          jsonb not null default '[]'::jsonb,
    subtotal       numeric(12, 2) not null default 0,
    discount       numeric(12, 2) not null default 0,
    vat_enabled    boolean not null default true,
    vat            numeric(12, 2) not null default 0,
    total          numeric(12, 2) not null default 0,
    created_by     text,
    created_by_id  uuid references shootix_users (id) on delete set null,
    created_at     timestamptz not null default now()
);

create index if not exists shootix_receipts_created_idx on shootix_receipts (created_at desc);
create index if not exists shootix_receipts_owner_idx   on shootix_receipts (created_by_id, created_at desc);

-- ----------------------------------------------------------
--  COUNTERS  →  gap-free, race-free receipt numbers
-- ----------------------------------------------------------
create table if not exists shootix_counters (
    key   text primary key,
    value bigint not null default 0
);

-- Atomically reserves the next number for the given year.
-- Two people hitting "save" at the same instant can never collide.
create or replace function shootix_next_receipt_number(p_year integer)
returns table (next_seq bigint, next_number text)
language plpgsql
as $$
declare
    v bigint;
begin
    insert into shootix_counters (key, value)
         values ('receipt:' || p_year, 1)
    on conflict (key)
      do update set value = shootix_counters.value + 1
      returning value into v;

    return query select v, 'SHX-' || p_year || '-' || lpad(v::text, 4, '0');
end;
$$;

-- ----------------------------------------------------------
--  ROW LEVEL SECURITY
--  RLS on with no policies = no anonymous access at all.
--  The server talks to these tables with the service-role key,
--  which bypasses RLS, so the API stays the only way in.
-- ----------------------------------------------------------
alter table shootix_users    enable row level security;
alter table shootix_gallery  enable row level security;
alter table shootix_receipts enable row level security;
alter table shootix_counters enable row level security;

-- ----------------------------------------------------------
--  STORAGE BUCKETS
--  shootix-gallery : public   (portfolio images shown on the site)
--  shootix-private : private  (the Excel ledger)
-- ----------------------------------------------------------
insert into storage.buckets (id, name, public)
     values ('shootix-gallery', 'shootix-gallery', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
     values ('shootix-private', 'shootix-private', false)
on conflict (id) do nothing;

-- Anyone may read the portfolio images (they are on the public site).
drop policy if exists "shootix gallery public read" on storage.objects;
create policy "shootix gallery public read"
    on storage.objects for select
    using (bucket_id = 'shootix-gallery');

-- ==========================================================
--  Done. The first admin account is created automatically by
--  the app on first boot (see SHOOTIX_ADMIN_PASSWORD).
-- ==========================================================
