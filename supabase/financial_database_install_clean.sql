-- MedLink Financial Database - CLEAN INSTALL
-- Run after the existing operational schema/migrations.
-- This file is a consolidated installer for the financial layer.
-- It intentionally uses only valid PostgreSQL syntax.

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- 1. Base financial reference data
-- ============================================================
create table if not exists public.financial_currencies (
  code text primary key,
  name text not null,
  symbol text,
  decimal_places smallint not null default 2 check (decimal_places between 0 and 6),
  is_active boolean not null default true
);

insert into public.financial_currencies (code,name,symbol)
values
  ('YER','الريال اليمني','﷼'),
  ('USD','الدولار الأمريكي','$'),
  ('SAR','الريال السعودي','﷼')
on conflict (code) do nothing;

create table if not exists public.financial_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  base_currency_code text not null default 'YER' references public.financial_currencies(code),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.financial_fiscal_years (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.financial_companies(id) on delete cascade,
  year_code text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('open','closed')),
  unique(company_id,year_code),
  check (start_date <= end_date)
);

create table if not exists public.financial_periods (
  id uuid primary key default gen_random_uuid(),
  fiscal_year_id uuid not null references public.financial_fiscal_years(id) on delete cascade,
  period_number smallint not null check (period_number between 1 and 13),
  name text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('open','closed')),
  unique(fiscal_year_id,period_number),
  check (start_date <= end_date)
);

create table if not exists public.financial_cost_centers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.financial_companies(id) on delete cascade,
  code text not null,
  name text not null,
  branch_id uuid references public.branches(id) on delete set null,
  parent_id uuid references public.financial_cost_centers(id) on delete set null,
  is_active boolean not null default true,
  unique(company_id,code)
);

create table if not exists public.financial_exchange_rates (
  id uuid primary key default gen_random_uuid(),
  from_currency_code text not null references public.financial_currencies(code),
  to_currency_code text not null references public.financial_currencies(code),
  rate numeric(20,8) not null check(rate > 0),
  effective_date date not null,
  unique(from_currency_code,to_currency_code,effective_date)
);

-- ============================================================
-- 2. Chart of accounts
-- ============================================================
create table if not exists public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.financial_companies(id) on delete cascade,
  code text not null,
  name text not null,
  account_type text not null check(account_type in ('asset','liability','equity','revenue','cogs','expense')),
  parent_id uuid references public.financial_accounts(id) on delete restrict,
  level smallint not null default 1,
  is_postable boolean not null default true,
  normal_balance text not null check(normal_balance in ('debit','credit')),
  is_active boolean not null default true,
  unique(company_id,code)
);

create index if not exists financial_accounts_parent_idx
on public.financial_accounts(parent_id);

-- ============================================================
-- 3. Cash and banks
-- ============================================================
create table if not exists public.financial_cash_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.financial_companies(id) on delete cascade,
  code text not null,
  name text not null,
  currency_code text not null default 'YER' references public.financial_currencies(code),
  branch_id uuid references public.branches(id) on delete set null,
  gl_account_id uuid references public.financial_accounts(id) on delete restrict,
  is_active boolean not null default true,
  unique(company_id,code)
);

create table if not exists public.financial_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.financial_companies(id) on delete cascade,
  bank_name text not null,
  account_name text not null,
  account_number text,
  iban text,
  currency_code text not null default 'YER' references public.financial_currencies(code),
  branch_id uuid references public.branches(id) on delete set null,
  gl_account_id uuid references public.financial_accounts(id) on delete restrict,
  is_active boolean not null default true
);

-- ============================================================
-- 4. Documents and double-entry journal
-- ============================================================
create table if not exists public.financial_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.financial_companies(id) on delete cascade,
  document_type text not null,
  source_table text,
  source_id uuid,
  document_number text,
  description text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.financial_journal_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.financial_companies(id) on delete cascade,
  entry_number bigint generated always as identity,
  entry_date date not null,
  period_id uuid references public.financial_periods(id) on delete restrict,
  description text not null,
  source_document_id uuid references public.financial_documents(id) on delete set null,
  status text not null default 'draft' check(status in ('draft','posted','voided')),
  created_by uuid references public.users(id) on delete set null,
  posted_by uuid references public.users(id) on delete set null,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  void_reason text
);

create table if not exists public.financial_journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.financial_journal_entries(id) on delete restrict,
  line_number smallint not null,
  account_id uuid not null references public.financial_accounts(id) on delete restrict,
  cost_center_id uuid references public.financial_cost_centers(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  description text,
  debit numeric(18,2) not null default 0 check(debit >= 0),
  credit numeric(18,2) not null default 0 check(credit >= 0),
  currency_code text not null default 'YER' references public.financial_currencies(code),
  exchange_rate numeric(20,8) not null default 1 check(exchange_rate > 0),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0)),
  unique(journal_entry_id,line_number)
);

create or replace function public.post_financial_journal_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_debit numeric(18,2);
  v_credit numeric(18,2);
  v_count integer;
  v_status text;
begin
  select status into v_status
  from public.financial_journal_entries
  where id = p_entry_id
  for update;

  if v_status is null then raise exception 'Journal entry not found'; end if;
  if v_status <> 'draft' then raise exception 'Only draft entries can be posted'; end if;

  select count(*), coalesce(sum(debit),0), coalesce(sum(credit),0)
  into v_count,v_debit,v_credit
  from public.financial_journal_lines
  where journal_entry_id = p_entry_id;

  if v_count < 2 or v_debit <> v_credit then
    raise exception 'Journal entry is not balanced';
  end if;

  update public.financial_journal_entries
  set status='posted', posted_at=now(), posted_by=auth.uid()
  where id=p_entry_id;
end;
$$;

-- ============================================================
-- 5. Audit
-- ============================================================
create table if not exists public.financial_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(id) on delete set null,
  action text not null,
  entity_table text not null,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 6. RLS: enable only. Policies are deliberately explicit.
-- ============================================================
alter table public.financial_currencies enable row level security;
alter table public.financial_companies enable row level security;
alter table public.financial_fiscal_years enable row level security;
alter table public.financial_periods enable row level security;
alter table public.financial_cost_centers enable row level security;
alter table public.financial_exchange_rates enable row level security;
alter table public.financial_accounts enable row level security;
alter table public.financial_cash_accounts enable row level security;
alter table public.financial_bank_accounts enable row level security;
alter table public.financial_documents enable row level security;
alter table public.financial_journal_entries enable row level security;
alter table public.financial_journal_lines enable row level security;
alter table public.financial_audit_logs enable row level security;

-- The existing application should provide the final role-aware policies.
-- Do not grant public write access to financial tables.

commit;

-- End of clean installer
