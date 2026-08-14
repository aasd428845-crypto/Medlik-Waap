-- 0012 — الموردون والذمم الدائنة

create table if not exists public.financial_suppliers (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.financial_companies(id) on delete cascade,
  supplier_code text not null, name text not null, phone text, tax_number text, credit_limit numeric(18,2) not null default 0,
  currency_code text not null default 'YER' references public.financial_currencies(code), payable_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  is_active boolean not null default true, created_at timestamptz not null default now(), unique(company_id,supplier_code)
);
create table if not exists public.financial_supplier_bills (
  id uuid primary key default gen_random_uuid(), supplier_id uuid not null references public.financial_suppliers(id) on delete restrict,
  bill_number text not null, bill_date date not null default current_date, due_date date, amount numeric(18,2) not null check(amount>0),
  currency_code text not null default 'YER' references public.financial_currencies(code), status text not null default 'open' check(status in('draft','open','partially_paid','paid','cancelled')),
  journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict, created_by uuid references public.users(id) on delete set null, created_at timestamptz not null default now(), unique(supplier_id,bill_number)
);
create table if not exists public.financial_supplier_payments (
  id uuid primary key default gen_random_uuid(), supplier_id uuid not null references public.financial_suppliers(id) on delete restrict,
  bill_id uuid references public.financial_supplier_bills(id) on delete restrict, amount numeric(18,2) not null check(amount>0), payment_date date not null default current_date,
  cash_account_id uuid references public.financial_cash_accounts(id) on delete restrict, bank_account_id uuid references public.financial_bank_accounts(id) on delete restrict,
  journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict, status text not null default 'posted' check(status in('draft','posted','voided')),
  created_by uuid references public.users(id) on delete set null, created_at timestamptz not null default now(),
  check(((cash_account_id is not null)::int+(bank_account_id is not null)::int)=1)
);

alter table public.financial_suppliers enable row level security;
alter table public.financial_supplier_bills enable row level security;
alter table public.financial_supplier_payments enable row level security;
create policy "financial_suppliers_rw" on public.financial_suppliers for all using(public.current_user_role() in('company_director','accountant')) with check(public.current_user_role() in('company_director','accountant'));
create policy "financial_supplier_bills_rw" on public.financial_supplier_bills for all using(public.current_user_role() in('company_director','accountant')) with check(public.current_user_role() in('company_director','accountant'));
create policy "financial_supplier_payments_rw" on public.financial_supplier_payments for all using(public.current_user_role() in('company_director','accountant')) with check(public.current_user_role() in('company_director','accountant'));
