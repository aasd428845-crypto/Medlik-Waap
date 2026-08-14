-- 0008 — الصناديق والبنوك والتحويلات والمطابقة

create table if not exists public.financial_cash_movements (
  id uuid primary key default gen_random_uuid(),
  cash_account_id uuid not null references public.financial_cash_accounts(id) on delete restrict,
  movement_date date not null default current_date,
  movement_type text not null check(movement_type in('receipt','disbursement','transfer_in','transfer_out','adjustment')),
  amount numeric(18,2) not null check(amount>0),
  currency_code text not null default 'YER' references public.financial_currencies(code),
  reference_type text, reference_id uuid, journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict,
  status text not null default 'posted' check(status in('draft','posted','voided')),
  description text, created_by uuid references public.users(id) on delete set null, created_at timestamptz not null default now()
);
create index if not exists financial_cash_movements_account_idx on public.financial_cash_movements(cash_account_id,movement_date);

create table if not exists public.financial_bank_movements (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.financial_bank_accounts(id) on delete restrict,
  movement_date date not null default current_date,
  movement_type text not null check(movement_type in('deposit','withdrawal','transfer_in','transfer_out','fee','adjustment')),
  amount numeric(18,2) not null check(amount>0), currency_code text not null default 'YER' references public.financial_currencies(code),
  reference_number text, reference_type text, reference_id uuid, journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict,
  status text not null default 'posted' check(status in('draft','posted','voided')),
  description text, created_by uuid references public.users(id) on delete set null, created_at timestamptz not null default now()
);
create index if not exists financial_bank_movements_account_idx on public.financial_bank_movements(bank_account_id,movement_date);

create table if not exists public.financial_transfers (
  id uuid primary key default gen_random_uuid(), transfer_number bigint generated always as identity,
  from_cash_account_id uuid references public.financial_cash_accounts(id) on delete restrict,
  to_cash_account_id uuid references public.financial_cash_accounts(id) on delete restrict,
  from_bank_account_id uuid references public.financial_bank_accounts(id) on delete restrict,
  to_bank_account_id uuid references public.financial_bank_accounts(id) on delete restrict,
  amount numeric(18,2) not null check(amount>0), currency_code text not null default 'YER' references public.financial_currencies(code),
  transfer_date date not null default current_date, status text not null default 'posted' check(status in('draft','posted','voided')),
  journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict,
  description text, created_by uuid references public.users(id) on delete set null, created_at timestamptz not null default now(),
  check(((from_cash_account_id is not null)::int + (from_bank_account_id is not null)::int)=1),
  check(((to_cash_account_id is not null)::int + (to_bank_account_id is not null)::int)=1)
);

create table if not exists public.financial_bank_reconciliations (
  id uuid primary key default gen_random_uuid(), bank_account_id uuid not null references public.financial_bank_accounts(id) on delete restrict,
  statement_date date not null, statement_balance numeric(18,2) not null, ledger_balance numeric(18,2) not null,
  difference numeric(18,2) generated always as (statement_balance-ledger_balance) stored,
  status text not null default 'open' check(status in('open','completed','reopened')),
  completed_by uuid references public.users(id) on delete set null, completed_at timestamptz, notes text, created_at timestamptz not null default now()
);
create table if not exists public.financial_bank_reconciliation_items (
  id uuid primary key default gen_random_uuid(), reconciliation_id uuid not null references public.financial_bank_reconciliations(id) on delete cascade,
  movement_id uuid references public.financial_bank_movements(id) on delete restrict,
  statement_reference text, statement_amount numeric(18,2), matched_at timestamptz, matched_by uuid references public.users(id) on delete set null,
  status text not null default 'unmatched' check(status in('unmatched','matched','adjustment')),
  notes text
);

alter table public.financial_cash_movements enable row level security;
alter table public.financial_bank_movements enable row level security;
alter table public.financial_transfers enable row level security;
alter table public.financial_bank_reconciliations enable row level security;
alter table public.financial_bank_reconciliation_items enable row level security;
create policy "financial_cash_movements_rw" on public.financial_cash_movements for all using(public.current_user_role() in('company_director','accountant')) with check(public.current_user_role() in('company_director','accountant'));
create policy "financial_bank_movements_rw" on public.financial_bank_movements for all using(public.current_user_role() in('company_director','accountant')) with check(public.current_user_role() in('company_director','accountant'));
create policy "financial_transfers_rw" on public.financial_transfers for all using(public.current_user_role() in('company_director','accountant')) with check(public.current_user_role() in('company_director','accountant'));
create policy "financial_reconciliations_rw" on public.financial_bank_reconciliations for all using(public.current_user_role() in('company_director','accountant')) with check(public.current_user_role() in('company_director','accountant'));
create policy "financial_reconciliation_items_rw" on public.financial_bank_reconciliation_items for all using(public.current_user_role() in('company_director','accountant')) with check(public.current_user_role() in('company_director','accountant'));
