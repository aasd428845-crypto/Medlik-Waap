-- =============================================================
-- المثبّت المالي الموحّد — Medlik-Waap
-- =============================================================
-- يجمع بالترتيب الصحيح: 0006 (النواة) → 0007 (الصلاحيات)
-- → 0008 (الحصانة) → 0009 (التلقائي) → 0010 (المبسّط) → 0011 (الأطباء)
-- جميع الأوامر محمية (if not exists / or replace / drop if exists)
-- فالتشغيل المتكرر آمن تماماً. شغّله ملفاً واحداً من SQL Editor.
-- =============================================================


-- ────────────────────────────────────────────────
-- الملف الكامل: 0006_financial_core.sql
-- ────────────────────────────────────────────────

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

-- ────────────────────────────────────────────────
-- الملف الكامل: 0007_financial_setup_rls.sql
-- ────────────────────────────────────────────────

-- =============================================================
-- Migration 0007 — Financial Setup + RLS (تهيئة وسياسات الأمان)
-- مشروع ويب Medlik-Waap (لوحة تحكم المدير العام)
--
-- البذور: شركة MedLink، السنة المالية 2026، 12 فترة شهرية،
-- دليل حسابات ابتدائي مرقّم — ثم جميع سياسات RLS للطبقة المالية
-- (المدير العام والمحاسب، مع تقييد التدقيق للمدير العام).
-- نفِّذه من Supabase Dashboard → SQL Editor
-- =============================================================

-- 1) البذور ----------------------------------------------------
insert into public.financial_companies (name, legal_name, base_currency_code)
select 'MedLink', 'MedLink', 'YER' where not exists (select 1 from public.financial_companies);

insert into public.financial_fiscal_years (company_id, year_code, start_date, end_date)
select c.id, '2026', '2026-01-01', '2026-12-31' from public.financial_companies c
where not exists (
  select 1 from public.financial_fiscal_years y
  where y.company_id = c.id and y.year_code = '2026'
);

insert into public.financial_periods (fiscal_year_id, period_number, name, start_date, end_date)
select y.id, m.n, m.name,
       make_date(2026, m.n, 1),
       case when m.n = 12 then date '2026-12-31' else (make_date(2026, m.n + 1, 1) - 1) end
from public.financial_fiscal_years y
cross join (values
  (1, 'يناير'), (2, 'فبراير'), (3, 'مارس'), (4, 'أبريل'), (5, 'مايو'), (6, 'يونيو'),
  (7, 'يوليو'), (8, 'أغسطس'), (9, 'سبتمبر'), (10, 'أكتوبر'), (11, 'نوفمبر'), (12, 'ديسمبر')
) m (n, name)
where y.year_code = '2026'
  and not exists (
    select 1 from public.financial_periods p
    where p.fiscal_year_id = y.id and p.period_number = m.n
  );

-- دليل حسابات ابتدائي قابل للتوسعة (المحاسب يضيف الحسابات منه)
insert into public.financial_accounts (company_id, code, name, account_type, level, is_postable, normal_balance)
select c.id, x.code, x.name, x.t, x.level, x.postable, x.balance
from public.financial_companies c
cross join (values
  ('1000', 'الأصول', 'asset', 1, false, 'debit'),
  ('1100', 'الأصول المتداولة', 'asset', 2, false, 'debit'),
  ('1110', 'الصندوق', 'asset', 3, true, 'debit'),
  ('1120', 'البنوك', 'asset', 3, true, 'debit'),
  ('1130', 'العملاء والذمم المدينة', 'asset', 3, true, 'debit'),
  ('1140', 'المخزون', 'asset', 3, true, 'debit'),
  ('1200', 'الأصول الثابتة', 'asset', 2, false, 'debit'),
  ('2000', 'الالتزامات', 'liability', 1, false, 'credit'),
  ('2100', 'الموردون والذمم الدائنة', 'liability', 2, true, 'credit'),
  ('3000', 'حقوق الملكية', 'equity', 1, true, 'credit'),
  ('4000', 'الإيرادات', 'revenue', 1, true, 'credit'),
  ('5000', 'تكلفة المبيعات', 'cogs', 1, true, 'debit'),
  ('6000', 'المصروفات', 'expense', 1, true, 'debit')
) x (code, name, t, level, postable, balance)
where not exists (
  select 1 from public.financial_accounts a
  where a.company_id = c.id and a.code = x.code
);

-- 2) سياسات RLS -------------------------------------------------
-- سياسات قابلة لإعادة التشغيل بأمان: drop + create.
-- المدير العام والمحاسب يديران الطبقة المالية؛ التدقيق للمدير العام.

drop policy if exists "financial_companies_access" on public.financial_companies;
create policy "financial_companies_access"
  on public.financial_companies
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_read_director_accountant" on public.financial_accounts;
create policy "financial_read_director_accountant"
  on public.financial_accounts
  for select using (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_write_director_accountant" on public.financial_accounts;
create policy "financial_write_director_accountant"
  on public.financial_accounts
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_years_access" on public.financial_fiscal_years;
create policy "financial_years_access"
  on public.financial_fiscal_years
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_periods_access" on public.financial_periods;
create policy "financial_periods_access"
  on public.financial_periods
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_cost_centers_access" on public.financial_cost_centers;
create policy "financial_cost_centers_access"
  on public.financial_cost_centers
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_cash_access" on public.financial_cash_accounts;
create policy "financial_cash_access"
  on public.financial_cash_accounts
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_bank_access" on public.financial_bank_accounts;
create policy "financial_bank_access"
  on public.financial_bank_accounts
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_documents_access" on public.financial_documents;
create policy "financial_documents_access"
  on public.financial_documents
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_journal_access" on public.financial_journal_entries;
create policy "financial_journal_access"
  on public.financial_journal_entries
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_journal_lines_access" on public.financial_journal_lines;
create policy "financial_journal_lines_access"
  on public.financial_journal_lines
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_receipts_access" on public.financial_receipts;
create policy "financial_receipts_access"
  on public.financial_receipts
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_suppliers_access" on public.financial_suppliers;
create policy "financial_suppliers_access"
  on public.financial_suppliers
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_supplier_bills_access" on public.financial_supplier_bills;
create policy "financial_supplier_bills_access"
  on public.financial_supplier_bills
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_supplier_payments_access" on public.financial_supplier_payments;
create policy "financial_supplier_payments_access"
  on public.financial_supplier_payments
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_cash_movements_access" on public.financial_cash_movements;
create policy "financial_cash_movements_access"
  on public.financial_cash_movements
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_bank_movements_access" on public.financial_bank_movements;
create policy "financial_bank_movements_access"
  on public.financial_bank_movements
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_reconciliation_access" on public.financial_bank_reconciliations;
create policy "financial_reconciliation_access"
  on public.financial_bank_reconciliations
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_inventory_access" on public.financial_inventory_movements;
create policy "financial_inventory_access"
  on public.financial_inventory_movements
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_stock_counts_access" on public.financial_stock_counts;
create policy "financial_stock_counts_access"
  on public.financial_stock_counts
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_stock_count_lines_access" on public.financial_stock_count_lines;
create policy "financial_stock_count_lines_access"
  on public.financial_stock_count_lines
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_expenses_access" on public.financial_expenses;
create policy "financial_expenses_access"
  on public.financial_expenses
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_assets_access" on public.financial_fixed_assets;
create policy "financial_assets_access"
  on public.financial_fixed_assets
  for all using (public.current_user_role() in ('company_director', 'accountant'))
  with check (public.current_user_role() in ('company_director', 'accountant'));

drop policy if exists "financial_budgets_access" on public.financial_budgets;
create policy "financial_budgets_access"
  on public.financial_budgets
  for all using (public.current_user_role() = 'company_director')
  with check (public.current_user_role() = 'company_director');

drop policy if exists "financial_budget_lines_access" on public.financial_budget_lines;
create policy "financial_budget_lines_access"
  on public.financial_budget_lines
  for all using (public.current_user_role() = 'company_director')
  with check (public.current_user_role() = 'company_director');

drop policy if exists "financial_audit_access" on public.financial_audit_logs;
create policy "financial_audit_access"
  on public.financial_audit_logs
  for select using (public.current_user_role() = 'company_director');

-- ────────────────────────────────────────────────
-- الملف الكامل: 0008_financial_audit_immutability.sql
-- ────────────────────────────────────────────────

-- =============================================================
-- Migration 0008 — Financial Audit + Immutability
-- (حماية القيود المرحّلة، أمان Views التقارير، الفهارس)
-- مشروع ويب Medlik-Waap (لوحة تحكم المدير العام)
--
-- 1) حصانة القيود المرحّلة: لا تعديل ولا حذف لأي قيد posted
--    أو سطر من أسطره — الاستثناء الوحيد هو القيد العكسي.
-- 2) أمان Views التقارير عبر security_invoker: تُفحص شروط
--    RLS لحساب المستدعي وليس منشئ الـView.
-- 3) فهارس داعمة للترحيل والتقارير.
-- نفِّذه من Supabase Dashboard → SQL Editor
-- =============================================================

-- 1) حصانة اليومية ---------------------------------------------
create or replace function public.prevent_posted_journal_line_mutation()
returns trigger
language plpgsql
as $$
declare
  s text;
begin
  select status into s from public.financial_journal_entries
  where id = old.journal_entry_id;
  if s = 'posted' then raise exception 'Posted journal lines are immutable'; end if;
  return old;
end;
$$;

create or replace function public.prevent_posted_journal_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'posted' then
    raise exception 'Posted journal entries are immutable; use a reversal';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_financial_journal_immutable on public.financial_journal_entries;
create trigger trg_financial_journal_immutable
  before update or delete on public.financial_journal_entries
  for each row execute function public.prevent_posted_journal_mutation();

drop trigger if exists trg_financial_journal_line_immutable on public.financial_journal_lines;
create trigger trg_financial_journal_line_immutable
  before update or delete on public.financial_journal_lines
  for each row execute function public.prevent_posted_journal_line_mutation();

-- 2) أمان Views التقارير (security_invoker) ---------------------
alter view public.financial_general_ledger set (security_invoker = true);
alter view public.financial_trial_balance set (security_invoker = true);
alter view public.financial_branch_profitability set (security_invoker = true);

-- 3) فهارس داعمة ------------------------------------------------
create index if not exists financial_journal_entries_period_idx
  on public.financial_journal_entries (period_id, status);

create index if not exists financial_journal_lines_account_idx
  on public.financial_journal_lines (account_id);

create index if not exists financial_receipts_client_idx
  on public.financial_receipts (client_id, receipt_date);

create index if not exists financial_inventory_product_idx
  on public.financial_inventory_movements (product_id, movement_date);

-- ────────────────────────────────────────────────
-- الملف الكامل: 0009_financial_auto_posting.sql
-- ────────────────────────────────────────────────

-- =============================================================
-- Migration 0009 — Financial Auto Posting (القيود التلقائية)
-- مشروع ويب Medlik-Waap (لوحة تحكم المدير العام)
--
-- 1) حساب مصروف العمولات (6110) يُضاف إلى دليل الحسابات.
-- 2) تعديل قيد movement_type في حركة المخزون لإضافة 'bonus'.
-- 3) دالة مساعدة fn_financial_auto_entry تُنشئ مستنداً + قيداً
--    (draft — يحتاج ترحيلاً يدوياً من دفتر اليومية) بأسطر متوازنة.
-- 4) Triggers تلقائية:
--    - invoices          → مدين 1130 (ذمم العملاء) / دائن 4000 (الإيرادات)
--    - driver_commissions → عند status='paid' → مدين 6110 (عمولات) / دائن 1110 (الصندوق)
--    - order_items        → عند is_bonus=true → حركة مخزون بنوع 'bonus' (كمية سالبة)
-- 5) أي فشل يُسجَّل في financial_audit_logs ولا يُسقط العملية الأصلية.
-- نفِّذه من Supabase Dashboard → SQL Editor
-- =============================================================

-- 1) حساب مصروفات عمولات المندوبين -----------------------------
insert into public.financial_accounts (company_id, code, name, account_type, level, is_postable, normal_balance)
select c.id, '6110', 'مصروفات عمولات المندوبين', 'expense', 3, true, 'debit'
from public.financial_companies c
where not exists (
  select 1 from public.financial_accounts a
  where a.company_id = c.id and a.code = '6110'
);

-- 2) إضافة نوع حركة 'bonus' إلى حركة المخزون --------------------
alter table public.financial_inventory_movements
  drop constraint if exists financial_inventory_movements_movement_type_check;

alter table public.financial_inventory_movements
  add constraint financial_inventory_movements_movement_type_check
  check (movement_type in ('receipt', 'sale', 'return_in', 'return_out', 'transfer_in', 'transfer_out', 'adjustment', 'damage', 'expired', 'sample', 'bonus'));

-- 3) دالة القيد التلقائي ----------------------------------------
create or replace function public.fn_financial_auto_entry(
  p_entry_date date,
  p_description text default null,
  p_document_type text default 'auto',
  p_source_table text default null,
  p_source_id uuid default null,
  p_lines jsonb default '[]'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_period_id uuid;
  v_doc_id uuid;
  v_entry_id uuid;
  v_line jsonb;
  v_account_id uuid;
  v_sequence integer := 0;
begin
  select c.id into v_company_id
  from public.financial_companies c
  order by c.created_at limit 1;
  if v_company_id is null then raise exception 'No financial company configured'; end if;

  select p.id into v_period_id
  from public.financial_periods p
  where p.start_date <= p_entry_date and p.end_date >= p_entry_date
  order by p.start_date desc limit 1;

  insert into public.financial_documents
    (company_id, document_type, source_table, source_id, description, document_number, created_by)
  values
    (v_company_id, p_document_type, p_source_table, p_source_id, p_description,
     coalesce(p_document_type, 'auto') || '-' || to_char(now(), 'YYYYMMDD-HH24MISS'), auth.uid())
  returning id into v_doc_id;

  insert into public.financial_journal_entries
    (company_id, entry_date, period_id, description, status, source_document_id, created_by)
  values
    (v_company_id, p_entry_date, v_period_id, coalesce(p_description, 'قيد تلقائي'), 'draft', v_doc_id, auth.uid())
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_sequence := v_sequence + 1;

    select a.id into v_account_id
    from public.financial_accounts a
    where a.company_id = v_company_id and a.code = v_line->>'account_code';

    if v_account_id is null then
      raise exception 'Account code "%" not found for auto entry', v_line->>'account_code';
    end if;

    insert into public.financial_journal_lines
      (journal_entry_id, line_number, account_id, description, debit, credit)
    values
      (v_entry_id, v_sequence, v_account_id, v_line->>'description',
       coalesce((v_line->>'debit')::numeric, 0),
       coalesce((v_line->>'credit')::numeric, 0));
  end loop;

  return v_entry_id;
end;
$$;

revoke all on function public.fn_financial_auto_entry(date, text, text, text, uuid, jsonb) from public;

-- 4) Trigger 1: فاتورة → قيد ذمم/إيرادات (draft) -----------------
create or replace function public.trg_financial_invoice_auto_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status = 'cancelled' or NEW.amount <= 0 then return NEW; end if;

  begin
    perform public.fn_financial_auto_entry(
      coalesce(NEW.due_date, NEW.created_at::date),
      'إشعار فاتورة عميل رقم ' || NEW.id::text,
      'invoice', 'invoices', NEW.id,
      jsonb_build_array(
        jsonb_build_object('account_code', '1130', 'debit', NEW.amount, 'credit', 0, 'description', 'فاتورة عميل — ذمم مدينة'),
        jsonb_build_object('account_code', '4000', 'debit', 0, 'credit', NEW.amount, 'description', 'فاتورة عميل — إيرادات مبيعات')
      ));
  exception when others then
    insert into public.financial_audit_logs (actor_user_id, action, entity_table, entity_id, new_data, reason)
    values (auth.uid(), 'auto_journal_failed', 'invoices', NEW.id, row_to_json(NEW)::jsonb,
            'فشل قيد الفاتورة التلقائي: ' || SQLERRM);
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_financial_invoice_auto_journal on public.invoices;
create trigger trg_financial_invoice_auto_journal
  after insert on public.invoices
  for each row
  execute function public.trg_financial_invoice_auto_journal();

-- 5) Trigger 2: عمولة مندوب تصل لـ paid → قيد (draft) ------------
create or replace function public.trg_financial_commission_auto_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status <> 'paid' then return NEW; end if;

  begin
    perform public.fn_financial_auto_entry(
      current_date,
      'عمولة مندوب توصيل — معاملة ' || NEW.order_id::text,
      'driver_commission', 'driver_commissions', NEW.id,
      jsonb_build_array(
        jsonb_build_object('account_code', '6110', 'debit', NEW.amount, 'credit', 0, 'description', 'مصروف عمولة مندوب'),
        jsonb_build_object('account_code', '1110', 'debit', 0, 'credit', NEW.amount, 'description', 'صرف من الصندوق')
      ));
  exception when others then
    insert into public.financial_audit_logs (actor_user_id, action, entity_table, entity_id, new_data, reason)
    values (auth.uid(), 'auto_journal_failed', 'driver_commissions', NEW.id, row_to_json(NEW)::jsonb,
            'فشل قيد العمولة التلقائي: ' || SQLERRM);
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_financial_commission_auto_journal on public.driver_commissions;
create trigger trg_financial_commission_auto_journal
  after insert on public.driver_commissions
  for each row
  when (NEW.status = 'paid')
  execute function public.trg_financial_commission_auto_journal();

drop trigger if exists trg_financial_commission_auto_journal_update on public.driver_commissions;
create trigger trg_financial_commission_auto_journal_update
  after update on public.driver_commissions
  for each row
  when (NEW.status = 'paid' and OLD.status is distinct from 'paid')
  execute function public.trg_financial_commission_auto_journal();

-- 6) Trigger 3: بند طلب بونصي → حركة مخزون (bonus) --------------
create or replace function public.trg_financial_bonus_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
  v_unit_cost numeric(18,4) := 0;
begin
  select o.branch_id into v_branch_id from public.orders o where o.id = NEW.order_id;
  if v_branch_id is null then return NEW; end if;

  select coalesce(p.unit_price, 0) into v_unit_cost
  from public.products p where p.id = NEW.product_id;

  begin
    insert into public.financial_inventory_movements
      (branch_id, product_id, movement_type, quantity, unit_cost, reference_type, reference_id, movement_date)
    values
      (v_branch_id, NEW.product_id, 'bonus', -NEW.quantity, v_unit_cost, 'order_items', NEW.id, now());
  exception when others then
    insert into public.financial_audit_logs (actor_user_id, action, entity_table, entity_id, new_data, reason)
    values (auth.uid(), 'bonus_movement_failed', 'order_items', NEW.id, row_to_json(NEW)::jsonb,
            'فشل تسجيل حركة البونص في المخزون: ' || SQLERRM);
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_financial_bonus_inventory on public.order_items;
create trigger trg_financial_bonus_inventory
  after insert on public.order_items
  for each row
  when (NEW.is_bonus)
  execute function public.trg_financial_bonus_inventory();

-- ────────────────────────────────────────────────
-- الملف الكامل: 0010_financial_simple_entries.sql
-- ────────────────────────────────────────────────

-- =============================================================
-- Migration 0010 — Financial Simple Entries (إدخالات مبسّطة)
-- مشروع ويب Medlik-Waap (لوحة تحكم المدير العام)
--
-- دوال محمية (security definer + فحص دور المدير العام) تُنشئ
-- الصف التشغيلي + قيده المحاسبي معاً خلف الكواليس، بحيث لا يرى
-- المستخدم "مدين/دائن" أبداً:
--   1) create_financial_expense      → مصروف + قيد مرتجل (posted)
--   2) create_financial_receipt      → سند قبض + قيد + payments
--   3) create_financial_disbursement → صرف (صناديق/بنوك) + قيد
--   4) create_financial_journal_entry→ قيد يدوي مسودة (لدفتر اليومية)
--   5) post_financial_journal_entry  → تُعاد كتابته مع فحص الدور
-- بذور: الصندوق الرئيسي + البنك الرئيسي (رهناك ربط GL 1110/1120).
-- نفِّذه من Supabase Dashboard → SQL Editor
-- =============================================================

-- 1) بذور الصندوق والبنك الرئيسيين ------------------------------
insert into public.financial_cash_accounts (company_id, code, name, currency_code, gl_account_id, is_active)
select c.id, 'CASH-001', 'الصندوق الرئيسي', 'YER', a.id, true
from public.financial_companies c
join public.financial_accounts a on a.company_id = c.id and a.code = '1110'
where not exists (select 1 from public.financial_cash_accounts ca where ca.company_id = c.id and ca.code = 'CASH-001');

insert into public.financial_bank_accounts (company_id, bank_name, account_name, account_number, currency_code, gl_account_id, is_active)
select c.id, 'البنك الرئيسي', 'الحساب الرئيسي', null, 'YER', a.id, true
from public.financial_companies c
join public.financial_accounts a on a.company_id = c.id and a.code = '1120'
where not exists (select 1 from public.financial_bank_accounts ba where ba.company_id = c.id and ba.account_name = 'الحساب الرئيسي');

-- 2) دوال مساعدة (حماية من التنفيذ العام) -----------------------
revoke all on function public.fn_financial_auto_entry(date, text, text, text, uuid, jsonb) from public;
revoke all on function public.post_financial_journal_entry(uuid) from public;

-- 3) مصروف مبسّط: صف + قيد مرتجل (posted) -----------------------
create or replace function public.create_financial_expense(
  p_amount numeric,
  p_category_account_id uuid default null,
  p_branch_id uuid default null,
  p_payment_method text default 'cash',
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_category uuid;
  v_gl_account_id uuid;
  v_pay_account_id uuid;
  v_expense_id uuid;
  v_entry_id uuid;
begin
  if public.current_user_role() <> 'company_director' then
    raise exception 'غير مصرح لك — مطلوب دور المدير العام';
  end if;
  if p_amount <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  if p_payment_method not in ('cash', 'bank') then
    raise exception 'طريقة الدفع يجب أن تكون cash أو bank';
  end if;

  select c.id into v_company_id from public.financial_companies c order by c.created_at limit 1;
  if v_company_id is null then raise exception 'لا توجد شركة مالية مفعّلة'; end if;

  if p_category_account_id is null then
    select a.id into v_category from public.financial_accounts a
    where a.company_id = v_company_id and a.code = '6000';
  else
    v_category := p_category_account_id;
  end if;

  if p_payment_method = 'bank' then
    select ga.gl_account_id, ga.id into v_gl_account_id, v_pay_account_id
    from public.financial_bank_accounts ga
    where ga.is_active = true order by ga.created_at limit 1;
  else
    select ga.gl_account_id, ga.id into v_gl_account_id, v_pay_account_id
    from public.financial_cash_accounts ga
    where ga.is_active = true order by ga.created_at limit 1;
  end if;
  if v_gl_account_id is null then
    raise exception 'لا يوجد حساب % مفعّل — نفّذ بذور الصندوق/البنك أولاً', p_payment_method;
  end if;

  insert into public.financial_expenses
    (expense_date, category_account_id, amount, branch_id, cash_account_id, bank_account_id, status, description)
  values
    (current_date, v_category, p_amount, p_branch_id,
     case when p_payment_method = 'cash' then v_pay_account_id end,
     case when p_payment_method = 'bank' then v_pay_account_id end,
     'posted', p_description)
  returning id into v_expense_id;

  v_entry_id := public.fn_financial_auto_entry(
    current_date,
    coalesce(p_description, 'مصروف نقدي/بنكي'),
    'expense', 'financial_expenses', v_expense_id,
    jsonb_build_array(
      jsonb_build_object('account_code', (select a.code from public.financial_accounts a where a.id = v_category), 'debit', p_amount, 'credit', 0, 'description', 'مصروف'),
      jsonb_build_object('account_code', (select a.code from public.financial_accounts a where a.id = v_gl_account_id), 'debit', 0, 'credit', p_amount, 'description', case when p_payment_method = 'bank' then 'دفع من البنك' else 'دفع نقداً' end)
    ));
  perform public.post_financial_journal_entry(v_entry_id);

  update public.financial_expenses set journal_entry_id = v_entry_id where id = v_expense_id;

  return v_expense_id;
end;
$$;

grant execute on function public.create_financial_expense(numeric, uuid, uuid, text, text) to authenticated;

-- 4) سند قبض مبسّط: سند + قيد + تخفيض رصيد العميل --------------
create or replace function public.create_financial_receipt(
  p_client_id uuid,
  p_amount numeric,
  p_payment_method text default 'cash',
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_gl_account_id uuid;
  v_pay_account_id uuid;
  v_receipt_id uuid;
  v_entry_id uuid;
begin
  if public.current_user_role() <> 'company_director' then
    raise exception 'غير مصرح لك — مطلوب دور المدير العام';
  end if;
  if p_amount <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  if p_payment_method not in ('cash', 'bank') then
    raise exception 'طريقة الدفع يجب أن تكون cash أو bank';
  end if;

  if p_payment_method = 'bank' then
    select ga.gl_account_id, ga.id into v_gl_account_id, v_pay_account_id
    from public.financial_bank_accounts ga
    where ga.is_active = true order by ga.created_at limit 1;
  else
    select ga.gl_account_id, ga.id into v_gl_account_id, v_pay_account_id
    from public.financial_cash_accounts ga
    where ga.is_active = true order by ga.created_at limit 1;
  end if;
  if v_gl_account_id is null then
    raise exception 'لا يوجد حساب % مفعّل — نفّذ بذور الصندوق/البنك أولاً', p_payment_method;
  end if;

  -- سند القبض
  insert into public.financial_receipts
    (client_id, amount, cash_account_id, bank_account_id, receipt_date, status, description)
  values
    (p_client_id, p_amount,
     case when p_payment_method = 'cash' then v_pay_account_id end,
     case when p_payment_method = 'bank' then v_pay_account_id end,
     current_date, 'posted', p_description)
  returning id into v_receipt_id;

  -- القيد المرتبط (نقد/بنك ← ذمم العميل)
  v_entry_id := public.fn_financial_auto_entry(
    current_date,
    coalesce(p_description, 'سند قبض من عميل'),
    'receipt', 'financial_receipts', v_receipt_id,
    jsonb_build_array(
      jsonb_build_object('account_code', (select a.code from public.financial_accounts a where a.id = v_gl_account_id), 'debit', p_amount, 'credit', 0, 'description', case when p_payment_method = 'bank' then 'إيداع بنكي' else 'قبض نقدي' end),
      jsonb_build_object('account_code', '1130', 'debit', 0, 'credit', p_amount, 'description', 'تحصيل ذمم عميل')
    ));
  perform public.post_financial_journal_entry(v_entry_id);

  -- تنفيذ Trigger المرحلة 4: خفض current_balance تلقائياً
  insert into public.payments (client_id, amount, created_at)
  values (p_client_id, p_amount, now());

  update public.financial_receipts set journal_entry_id = v_entry_id where id = v_receipt_id;

  return v_receipt_id;
end;
$$;

grant execute on function public.create_financial_receipt(uuid, numeric, text, text) to authenticated;

-- 5) سند صرف مبسّط: حركة صندوق/بنك + قيد (posted) ----------------
create or replace function public.create_financial_disbursement(
  p_amount numeric,
  p_category_account_id uuid default null,
  p_payment_method text default 'cash',
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_category uuid;
  v_gl_account_id uuid;
  v_pay_account_id uuid;
  v_movement_id uuid;
  v_entry_id uuid;
begin
  if public.current_user_role() <> 'company_director' then
    raise exception 'غير مصرح لك — مطلوب دور المدير العام';
  end if;
  if p_amount <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  if p_payment_method not in ('cash', 'bank') then
    raise exception 'طريقة الدفع يجب أن تكون cash أو bank';
  end if;

  select c.id into v_company_id from public.financial_companies c order by c.created_at limit 1;
  if v_company_id is null then raise exception 'لا توجد شركة مالية مفعّلة'; end if;

  if p_category_account_id is null then
    select a.id into v_category from public.financial_accounts a
    where a.company_id = v_company_id and a.code = '6000';
  else
    v_category := p_category_account_id;
  end if;

  if p_payment_method = 'bank' then
    select ga.gl_account_id, ga.id into v_gl_account_id, v_pay_account_id
    from public.financial_bank_accounts ga
    where ga.is_active = true order by ga.created_at limit 1;
  else
    select ga.gl_account_id, ga.id into v_gl_account_id, v_pay_account_id
    from public.financial_cash_accounts ga
    where ga.is_active = true order by ga.created_at limit 1;
  end if;
  if v_gl_account_id is null then
    raise exception 'لا يوجد حساب % مفعّل — نفّذ بذور الصندوق/البنك أولاً', p_payment_method;
  end if;

  -- حركة الصرف (نقداً → cash_movements / بنكياً → bank_movements)
  if p_payment_method = 'cash' then
    insert into public.financial_cash_movements
      (cash_account_id, movement_date, movement_type, amount, status, description)
    values
      (v_pay_account_id, current_date, 'disbursement', p_amount, 'posted', p_description)
    returning id into v_movement_id;
  else
    insert into public.financial_bank_movements
      (bank_account_id, movement_date, movement_type, amount, status, description)
    values
      (v_pay_account_id, current_date, 'withdrawal', p_amount, 'posted', p_description)
    returning id into v_movement_id;
  end if;

  -- القيد المرتبط (مصروف/فئة ← نقد/بنك)
  v_entry_id := public.fn_financial_auto_entry(
    current_date,
    coalesce(p_description, 'سند صرف'),
    'disbursement',
    case when p_payment_method = 'cash' then 'financial_cash_movements' else 'financial_bank_movements' end,
    v_movement_id,
    jsonb_build_array(
      jsonb_build_object('account_code', (select a.code from public.financial_accounts a where a.id = v_category), 'debit', p_amount, 'credit', 0, 'description', 'مصروف بموجب سند صرف'),
      jsonb_build_object('account_code', (select a.code from public.financial_accounts a where a.id = v_gl_account_id), 'debit', 0, 'credit', p_amount, 'description', case when p_payment_method = 'bank' then 'سحب من البنك' else 'صرف نقدي' end)
    ));
  perform public.post_financial_journal_entry(v_entry_id);

  if p_payment_method = 'cash' then
    update public.financial_cash_movements set journal_entry_id = v_entry_id where id = v_movement_id;
  else
    update public.financial_bank_movements set journal_entry_id = v_entry_id where id = v_movement_id;
  end if;

  return v_movement_id;
end;
$$;

grant execute on function public.create_financial_disbursement(numeric, uuid, text, text) to authenticated;

-- 6) قيد يدوي مسودة (لدفتر اليومية — المحاسب المتخصص) ------------
create or replace function public.create_financial_journal_entry(
  p_entry_date date,
  p_description text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
begin
  if public.current_user_role() <> 'company_director' then
    raise exception 'غير مصرح لك — دفتر اليومية للمدير العام فقط';
  end if;
  if p_description is null or btrim(p_description) = '' then
    raise exception 'الوصف مطلوب';
  end if;

  v_entry_id := public.fn_financial_auto_entry(
    p_entry_date, p_description, 'manual', null, null, p_lines);

  return v_entry_id;
end;
$$;

grant execute on function public.create_financial_journal_entry(date, text, jsonb) to authenticated;

-- 7) دالة الترحيل: إعادة كتابتها مع فحص الدور ثم منح التنفيذ ----
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
  if public.current_user_role() <> 'company_director' then
    raise exception 'غير مصرح لك — مطلوب دور المدير العام';
  end if;

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

grant execute on function public.post_financial_journal_entry(uuid) to authenticated;

-- ────────────────────────────────────────────────
-- الملف الكامل: 0011_financial_doctors_payouts.sql
-- ────────────────────────────────────────────────

-- =============================================================
-- Migration 0011 — Doctor Payouts (دفع عمولات الأطباء دفعة واحدة)
-- مشروع ويب Medlik-Waap (لوحة تحكم المدير العام — النظام المالي)
--
-- 1) حساب "عمولات الأطباء المستحقة" (126000) في دليل الحسابات إن غاب.
-- 2) جداول كشوف الدفع payout_documents + payout_line_items مع RLS.
-- 3) get_doctors_payables(): رصيد كل طبيب من القيود المرحّلة
--    (ناتج: مدين 6110 عمولات / دائن 126000 عند الاستحقاق،
--     ثم مدين 126000 / دائن صندوق عند الدفع — فتنخفض تلقائياً).
-- 4) create_doctors_payouts_entries(uuid[], text): دفع كل المبالغ
--    المستحقة دفعة واحدة: كشف + بنود + قيد مرحَّل فوراً (دون مسودات).
-- 5) الحماية: revoke public / grant authenticated + فحص دور المدير.
-- نفِّذه من Supabase Dashboard → SQL Editor
-- =============================================================

-- 1) حساب عمولات الأطباء المستحقة (التزام لحين الدفع) -------------
insert into public.financial_accounts (company_id, code, name, account_type, level, is_postable, is_active, normal_balance)
select c.id, '126000', 'عمولات الأطباء المستحقة الدفع', 'liability', 3, true, true, 'credit'
from public.financial_companies c
where not exists (
  select 1 from public.financial_accounts a
  where a.company_id = c.id and a.code = '126000'
);

-- 2) جدول كشوف الدفع -------------------------------------------
create table if not exists public.payout_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.financial_companies(id),
  payout_number bigint generated always as identity (start with 1001),
  payout_date date not null default current_date,
  payment_method text not null default 'cash' check (payment_method in ('cash','bank')),
  total_amount numeric(18,4) not null default 0,
  status text not null default 'posted' check (status in ('posted','voided')),
  journal_entry_id uuid references public.financial_journal_entries(id),
  description text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.payout_line_items (
  id uuid primary key default gen_random_uuid(),
  payout_document_id uuid not null references public.payout_documents(id) on delete cascade,
  doctor_user_id uuid not null references public.users(id),
  amount numeric(18,4) not null default 0 check (amount >= 0),
  created_at timestamptz not null default now()
);

alter table public.payout_documents enable row level security;
alter table public.payout_line_items enable row level security;

create policy "director payout_documents all"
  on public.payout_documents for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'company_director'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'company_director'));

create policy "director payout_line_items all"
  on public.payout_line_items for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'company_director'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'company_director'));

-- 3) رصيد الطبيب المستحق من القيود المرحّلة ---------------------
create or replace function public.fn_doctor_payables(v_doctor_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(jl.debit - jl.credit), 0)
  from public.financial_journal_lines jl
  join public.financial_journal_entries je on je.id = jl.journal_entry_id
  join public.financial_accounts a on a.id = jl.account_id
  where je.status = 'posted'
    and a.code = '126000'
    and jl.description like '%' || v_doctor_id::text || '%';
$$;

revoke all on function public.fn_doctor_payables(uuid) from public;

create or replace function public.get_doctors_payables()
returns table (doctor_id uuid, doctor_name text, payables numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select u.id,
           coalesce(u.name, u.phone::text, 'طبيب بدون اسم'),
           coalesce(public.fn_doctor_payables(u.id), 0)
    from public.users u
    where u.role = 'doctor'
    order by 3 desc;
end;
$$;

revoke all on function public.get_doctors_payables() from public;
grant execute on function public.get_doctors_payables() to authenticated;

-- 4) دفع عمولات الأطباء دفعة واحدة (كشف + بنود + قيد مرحَّل) ------
create or replace function public.create_doctors_payouts_entries(
  p_doctor_ids uuid[] default null,
  p_payment_method text default 'cash'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_period_id uuid;
  v_doc_id uuid;
  v_entry_id uuid;
  v_doctor_id uuid;
  v_amount numeric(18,4);
  v_paid integer := 0;
  v_skipped integer := 0;
  v_total numeric(18,4) := 0;
  v_debit numeric(18,2);
  v_credit numeric(18,2);
  v_count integer;
  v_period_status text;
  v_cash_code text := '1110';
  v_bank_code text := '1120';
begin
  if public.current_user_role() <> 'company_director' then
    raise exception 'غير مصرح لك — مطلوب دور المدير العام';
  end if;

  select c.id into v_company_id
  from public.financial_companies c
  order by c.created_at limit 1;
  if v_company_id is null then raise exception 'No financial company configured'; end if;

  select p.id into v_period_id
  from public.financial_periods p
  where p.start_date <= current_date and p.end_date >= current_date
  order by p.start_date desc limit 1;
  if v_period_id is null then raise exception 'الفترة المالية الحالية غير مفعّلة'; end if;

  insert into public.payout_documents
    (company_id, payout_date, payment_method, total_amount, status, description, created_by)
  values
    (v_company_id, current_date, p_payment_method, 0, 'posted',
     'كشف دفع عمولات أطباء — ' || to_char(now(), 'YYYY-MM-DD HH24:MI'),
     auth.uid())
  returning id into v_doc_id;

  foreach v_doctor_id in array coalesce(p_doctor_ids, array[]::uuid[]) loop
    v_amount := public.fn_doctor_payables(v_doctor_id);
    if v_amount <= 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.payout_line_items (payout_document_id, doctor_user_id, amount)
    values (v_doc_id, v_doctor_id, v_amount);

    v_total := v_total + v_amount;
    v_paid := v_paid + 1;

    v_entry_id := public.fn_financial_auto_entry(
      current_date,
      'دفعة عمولة طبيب — ' || v_doctor_id::text,
      'payout', 'payout_line_items',
      (select id from public.payout_line_items
       where payout_document_id = v_doc_id and doctor_user_id = v_doctor_id
       order by created_at desc limit 1),
      jsonb_build_array(
        jsonb_build_object('account_code', '126000', 'debit', v_amount, 'credit', 0,
                           'description', 'سداد عمولة الطبيب ' || v_doctor_id::text),
        jsonb_build_object('account_code', case when p_payment_method = 'bank' then v_bank_code else v_cash_code end,
                           'debit', 0, 'credit', v_amount,
                           'description', case when p_payment_method = 'bank' then 'دفع من البنك' else 'دفع من الصندوق' end)
      ));

    select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_count, v_debit, v_credit
    from public.financial_journal_lines
    where journal_entry_id = v_entry_id;

    if v_count < 2 or v_debit <> v_credit then
      raise exception 'القيد الناتج غير متوازن لدفعة الطبيب %', v_doctor_id;
    end if;

    update public.financial_journal_entries
    set status = 'posted', posted_at = now(), posted_by = auth.uid()
    where id = v_entry_id;
  end loop;

  if v_paid = 0 then
    delete from public.payout_documents where id = v_doc_id;
    return 'لا توجد أرصدة مستحقة للدفع (عدد متماثل: ' || v_skipped || ').';
  end if;

  update public.payout_documents
  set total_amount = v_total
  where id = v_doc_id;

  return 'تم دفع ' || v_paid || ' طبيباً دفعة واحدة بمبلغ ' || v_total::text
         || ' ' || case when p_payment_method = 'bank' then 'بنكياً' else 'نقداً' end
         || coalesce(' (' || v_skipped || ' بدون أرصدة).', '.');
end;
$$;

revoke all on function public.create_doctors_payouts_entries(uuid[], text) from public;
grant execute on function public.create_doctors_payouts_entries(uuid[], text) to authenticated;

-- 5) نظرة سريعة على آخر كشوف الدفع ------------------------------
revoke all on table public.payout_documents from public;
revoke all on table public.payout_line_items from public;
grant select on public.payout_documents to authenticated;
grant select on public.payout_line_items to authenticated;
