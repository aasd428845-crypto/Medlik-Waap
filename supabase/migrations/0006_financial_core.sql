-- =============================================================
-- Migration 0006 — Financial Core (النواة المالية)
-- مشروع ويب Medlik-Waap (لوحة تحكم المدير العام)
--
-- إعادة تنظيم المرحلة 7: النواة الكاملة للنظام المالي
-- (أُعيد تنظيمها من الملفات المندمجة 0006/0007/0008 + مُثبّت
--  financial_database_install_clean.sql الذي حُذف).
--
-- يشمل هذا الملف: البيانات المرجعية، شجرة الحسابات، الصناديق
-- والبنوك، المستندات، دفتر اليومية والأسطر + دالة الترحيل،
-- السندات، الموردين، الحركات النقدية والبنكية، حركة المخزون،
-- الجرد، المصروفات، الأصول، الميزانيات، Views التقارير،
-- سجل التدقيق، وتفعيل RLS (السياسات في 0007).
-- نفِّذه من Supabase Dashboard → SQL Editor
-- =============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- 1. البيانات المرجعية
-- ============================================================
create table if not exists public.financial_currencies (
  code text primary key,
  name text not null,
  symbol text,
  decimal_places smallint not null default 2 check (decimal_places between 0 and 6),
  is_active boolean not null default true
);

insert into public.financial_currencies (code, name, symbol)
values
  ('YER', 'الريال اليمني', '﷼'),
  ('USD', 'الدولار الأمريكي', '$'),
  ('SAR', 'الريال السعودي', '﷼')
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
  status text not null default 'open' check (status in ('open', 'closed')),
  unique (company_id, year_code),
  check (start_date <= end_date)
);

create table if not exists public.financial_periods (
  id uuid primary key default gen_random_uuid(),
  fiscal_year_id uuid not null references public.financial_fiscal_years(id) on delete cascade,
  period_number smallint not null check (period_number between 1 and 13),
  name text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  unique (fiscal_year_id, period_number),
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
  unique (company_id, code)
);

create table if not exists public.financial_exchange_rates (
  id uuid primary key default gen_random_uuid(),
  from_currency_code text not null references public.financial_currencies(code),
  to_currency_code text not null references public.financial_currencies(code),
  rate numeric(20,8) not null check (rate > 0),
  effective_date date not null,
  unique (from_currency_code, to_currency_code, effective_date)
);

-- ============================================================
-- 2. شجرة الحسابات
-- ============================================================
create table if not exists public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.financial_companies(id) on delete cascade,
  code text not null,
  name text not null,
  account_type text not null check (account_type in ('asset', 'liability', 'equity', 'revenue', 'cogs', 'expense')),
  parent_id uuid references public.financial_accounts(id) on delete restrict,
  level smallint not null default 1,
  is_postable boolean not null default true,
  normal_balance text not null check (normal_balance in ('debit', 'credit')),
  is_active boolean not null default true,
  unique (company_id, code)
);

create index if not exists financial_accounts_parent_idx
  on public.financial_accounts (parent_id);

-- ============================================================
-- 3. الصناديق والبنوك
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
  unique (company_id, code)
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
-- 4. المستندات ودفتر اليومية (القيد المزدوج)
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
  status text not null default 'draft' check (status in ('draft', 'posted', 'voided')),
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
  debit numeric(18,2) not null default 0 check (debit >= 0),
  credit numeric(18,2) not null default 0 check (credit >= 0),
  currency_code text not null default 'YER' references public.financial_currencies(code),
  exchange_rate numeric(20,8) not null default 1 check (exchange_rate > 0),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0)),
  unique (journal_entry_id, line_number)
);

-- دالة ترحيل القيد (عبر واجهة "دفتر اليومية" وتفعيل القيود المسودة)
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
  v_period_status text;
begin
  select status into v_status
  from public.financial_journal_entries
  where id = p_entry_id
  for update;

  if v_status is null then raise exception 'Journal entry not found'; end if;
  if v_status <> 'draft' then raise exception 'Only draft entries can be posted'; end if;

  select status into v_period_status
  from public.financial_periods p
  join public.financial_journal_entries e on e.period_id = p.id
  where e.id = p_entry_id;
  if v_period_status is null or v_period_status <> 'open' then
    raise exception 'Period is closed or missing';
  end if;

  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
  into v_count, v_debit, v_credit
  from public.financial_journal_lines
  where journal_entry_id = p_entry_id;

  if v_count < 2 or v_debit <> v_credit then
    raise exception 'Journal entry is not balanced';
  end if;

  update public.financial_journal_entries
  set status = 'posted', posted_at = now(), posted_by = auth.uid()
  where id = p_entry_id;
end;
$$;

revoke all on function public.post_financial_journal_entry(uuid) from public;

-- ============================================================
-- 5. السندات والموردون
-- ============================================================
create table if not exists public.financial_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number bigint generated always as identity,
  client_id uuid not null references public.users(id) on delete restrict,
  invoice_id uuid references public.invoices(id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  currency_code text not null default 'YER' references public.financial_currencies(code),
  cash_account_id uuid references public.financial_cash_accounts(id) on delete restrict,
  bank_account_id uuid references public.financial_bank_accounts(id) on delete restrict,
  receipt_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft', 'posted', 'voided')),
  journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict,
  created_by uuid references public.users(id) on delete set null,
  check (((cash_account_id is not null)::int + (bank_account_id is not null)::int) = 1)
);

create table if not exists public.financial_suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.financial_companies(id) on delete cascade,
  supplier_code text not null,
  name text not null,
  phone text,
  credit_limit numeric(18,2) not null default 0,
  payable_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  is_active boolean not null default true,
  unique (company_id, supplier_code)
);

create table if not exists public.financial_supplier_bills (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.financial_suppliers(id) on delete restrict,
  bill_number text not null,
  bill_date date not null default current_date,
  due_date date,
  amount numeric(18,2) not null check (amount > 0),
  status text not null default 'open' check (status in ('draft', 'open', 'partially_paid', 'paid', 'cancelled')),
  journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict,
  unique (supplier_id, bill_number)
);

create table if not exists public.financial_supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.financial_suppliers(id) on delete restrict,
  bill_id uuid references public.financial_supplier_bills(id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  payment_date date not null default current_date,
  cash_account_id uuid references public.financial_cash_accounts(id) on delete restrict,
  bank_account_id uuid references public.financial_bank_accounts(id) on delete restrict,
  journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict,
  check (((cash_account_id is not null)::int + (bank_account_id is not null)::int) = 1)
);

-- ============================================================
-- 6. الحركات النقدية والبنكية
-- ============================================================
create table if not exists public.financial_cash_movements (
  id uuid primary key default gen_random_uuid(),
  cash_account_id uuid not null references public.financial_cash_accounts(id) on delete restrict,
  movement_date date not null default current_date,
  movement_type text not null check (movement_type in ('receipt', 'disbursement', 'transfer_in', 'transfer_out', 'adjustment')),
  amount numeric(18,2) not null check (amount > 0),
  reference_type text,
  reference_id uuid,
  journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict,
  status text not null default 'posted',
  description text
);

create table if not exists public.financial_bank_movements (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.financial_bank_accounts(id) on delete restrict,
  movement_date date not null default current_date,
  movement_type text not null check (movement_type in ('deposit', 'withdrawal', 'transfer_in', 'transfer_out', 'fee', 'adjustment')),
  amount numeric(18,2) not null check (amount > 0),
  reference_number text,
  journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict,
  status text not null default 'posted',
  description text
);

create table if not exists public.financial_bank_reconciliations (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.financial_bank_accounts(id) on delete restrict,
  statement_date date not null,
  statement_balance numeric(18,2) not null,
  ledger_balance numeric(18,2) not null,
  status text not null default 'open' check (status in ('open', 'completed', 'reopened')),
  completed_by uuid references public.users(id) on delete set null,
  completed_at timestamptz,
  notes text
);

-- ============================================================
-- 7. حركة المخزون والجرد
-- ============================================================
create table if not exists public.financial_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid references public.warehouse_inventory(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null check (movement_type in ('receipt', 'sale', 'return_in', 'return_out', 'transfer_in', 'transfer_out', 'adjustment', 'damage', 'expired', 'sample')),
  quantity numeric(18,3) not null check (quantity <> 0),
  unit_cost numeric(18,4) not null default 0,
  reference_type text,
  reference_id uuid,
  journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict,
  movement_date timestamptz not null default now()
);

create table if not exists public.financial_stock_counts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  count_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft', 'approved', 'posted', 'cancelled')),
  journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict,
  notes text
);

create table if not exists public.financial_stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  stock_count_id uuid not null references public.financial_stock_counts(id) on delete cascade,
  inventory_id uuid references public.warehouse_inventory(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  system_quantity numeric(18,3) not null default 0,
  counted_quantity numeric(18,3) not null default 0,
  unit_cost numeric(18,4) not null default 0,
  difference_quantity numeric(18,3) generated always as (counted_quantity - system_quantity) stored
);

-- ============================================================
-- 8. المصروفات والأصول والميزانيات
-- ============================================================
create table if not exists public.financial_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_number bigint generated always as identity,
  expense_date date not null default current_date,
  category_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  branch_id uuid references public.branches(id) on delete set null,
  cost_center_id uuid references public.financial_cost_centers(id) on delete set null,
  cash_account_id uuid references public.financial_cash_accounts(id) on delete restrict,
  bank_account_id uuid references public.financial_bank_accounts(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'approved', 'posted', 'voided')),
  journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict,
  description text,
  check (((cash_account_id is not null)::int + (bank_account_id is not null)::int) = 1)
);

create table if not exists public.financial_fixed_assets (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null unique,
  name text not null,
  acquisition_date date not null,
  acquisition_cost numeric(18,2) not null,
  useful_life_months int not null check (useful_life_months > 0),
  salvage_value numeric(18,2) not null default 0,
  asset_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  accumulated_depreciation_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  depreciation_expense_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  branch_id uuid references public.branches(id) on delete set null,
  status text not null default 'active'
);

create table if not exists public.financial_budgets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.financial_companies(id) on delete cascade,
  fiscal_year_id uuid not null references public.financial_fiscal_years(id) on delete restrict,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'closed'))
);

create table if not exists public.financial_budget_lines (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.financial_budgets(id) on delete cascade,
  period_id uuid not null references public.financial_periods(id) on delete restrict,
  account_id uuid not null references public.financial_accounts(id) on delete restrict,
  branch_id uuid references public.branches(id) on delete set null,
  cost_center_id uuid references public.financial_cost_centers(id) on delete set null,
  amount numeric(18,2) not null default 0
);

-- ============================================================
-- 9. Views التقارير (للأستاذ العام وميزان المراجعة وربحية الفروع)
-- ============================================================
create or replace view public.financial_general_ledger as
  select e.company_id, e.entry_number, e.entry_date, e.status, e.description,
         l.account_id, a.code account_code, a.name account_name,
         l.branch_id, l.cost_center_id, l.debit, l.credit, l.currency_code
  from public.financial_journal_entries e
  join public.financial_journal_lines l on l.journal_entry_id = e.id
  join public.financial_accounts a on a.id = l.account_id
  where e.status = 'posted';

create or replace view public.financial_trial_balance as
  select e.company_id, l.account_id, a.code account_code, a.name account_name,
         sum(l.debit) total_debit, sum(l.credit) total_credit,
         sum(l.debit - l.credit) net_balance
  from public.financial_journal_entries e
  join public.financial_journal_lines l on l.journal_entry_id = e.id
  join public.financial_accounts a on a.id = l.account_id
  where e.status = 'posted'
  group by e.company_id, l.account_id, a.code, a.name;

create or replace view public.financial_branch_profitability as
  select e.company_id, l.branch_id,
         sum(case when a.account_type = 'revenue' then l.credit - l.debit else 0 end) revenue,
         sum(case when a.account_type = 'cogs' then l.debit - l.credit else 0 end) cogs,
         sum(case when a.account_type = 'expense' then l.debit - l.credit else 0 end) expenses
  from public.financial_journal_entries e
  join public.financial_journal_lines l on l.journal_entry_id = e.id
  join public.financial_accounts a on a.id = l.account_id
  where e.status = 'posted'
  group by e.company_id, l.branch_id;

-- ============================================================
-- 10. سجل التدقيق
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
-- 11. تفعيل RLS (السياسات في 0007)
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
alter table public.financial_receipts enable row level security;
alter table public.financial_suppliers enable row level security;
alter table public.financial_supplier_bills enable row level security;
alter table public.financial_supplier_payments enable row level security;
alter table public.financial_cash_movements enable row level security;
alter table public.financial_bank_movements enable row level security;
alter table public.financial_bank_reconciliations enable row level security;
alter table public.financial_inventory_movements enable row level security;
alter table public.financial_stock_counts enable row level security;
alter table public.financial_stock_count_lines enable row level security;
alter table public.financial_expenses enable row level security;
alter table public.financial_fixed_assets enable row level security;
alter table public.financial_budgets enable row level security;
alter table public.financial_budget_lines enable row level security;
alter table public.financial_audit_logs enable row level security;