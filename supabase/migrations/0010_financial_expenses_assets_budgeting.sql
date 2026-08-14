-- 0010 — المصروفات والأصول الثابتة والموازنات

create table if not exists public.financial_expenses (
  id uuid primary key default gen_random_uuid(), expense_number bigint generated always as identity,
  expense_date date not null default current_date, vendor_name text, category_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  amount numeric(18,2) not null check(amount>0), currency_code text not null default 'YER' references public.financial_currencies(code),
  branch_id uuid references public.branches(id) on delete set null, cost_center_id uuid references public.financial_cost_centers(id) on delete set null,
  cash_account_id uuid references public.financial_cash_accounts(id) on delete restrict, bank_account_id uuid references public.financial_bank_accounts(id) on delete restrict,
  status text not null default 'draft' check(status in('draft','approved','posted','voided')), journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict,
  description text, attachment_path text, created_by uuid references public.users(id) on delete set null, approved_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(), check(((cash_account_id is not null)::int+(bank_account_id is not null)::int)=1)
);

create table if not exists public.financial_fixed_assets (
  id uuid primary key default gen_random_uuid(), asset_code text not null unique, name text not null, description text,
  acquisition_date date not null, acquisition_cost numeric(18,2) not null check(acquisition_cost>=0), currency_code text not null default 'YER' references public.financial_currencies(code),
  useful_life_months integer not null check(useful_life_months>0), depreciation_method text not null default 'straight_line' check(depreciation_method in('straight_line')),
  salvage_value numeric(18,2) not null default 0 check(salvage_value>=0), branch_id uuid references public.branches(id) on delete set null,
  asset_account_id uuid not null references public.financial_accounts(id) on delete restrict, accumulated_depreciation_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  depreciation_expense_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  status text not null default 'active' check(status in('active','disposed','fully_depreciated')), created_at timestamptz not null default now()
);
create table if not exists public.financial_asset_depreciation (
  id uuid primary key default gen_random_uuid(), asset_id uuid not null references public.financial_fixed_assets(id) on delete restrict,
  period_id uuid not null references public.financial_periods(id) on delete restrict, depreciation_amount numeric(18,2) not null check(depreciation_amount>=0),
  journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict, posted_at timestamptz, unique(asset_id,period_id)
);

create table if not exists public.financial_budgets (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.financial_companies(id) on delete cascade,
  fiscal_year_id uuid not null references public.financial_fiscal_years(id) on delete restrict, name text not null,
  status text not null default 'draft' check(status in('draft','approved','closed')), created_by uuid references public.users(id) on delete set null, created_at timestamptz not null default now()
);
create table if not exists public.financial_budget_lines (
  id uuid primary key default gen_random_uuid(), budget_id uuid not null references public.financial_budgets(id) on delete cascade,
  period_id uuid not null references public.financial_periods(id) on delete restrict, account_id uuid not null references public.financial_accounts(id) on delete restrict,
  branch_id uuid references public.branches(id) on delete set null, cost_center_id uuid references public.financial_cost_centers(id) on delete set null,
  amount numeric(18,2) not null default 0 check(amount>=0), unique(budget_id,period_id,account_id,branch_id,cost_center_id)
);

alter table public.financial_expenses enable row level security;
alter table public.financial_fixed_assets enable row level security;
alter table public.financial_asset_depreciation enable row level security;
alter table public.financial_budgets enable row level security;
alter table public.financial_budget_lines enable row level security;
create policy "financial_expenses_rw" on public.financial_expenses for all using(public.current_user_role() in('company_director','accountant')) with check(public.current_user_role() in('company_director','accountant'));
create policy "financial_assets_rw" on public.financial_fixed_assets for all using(public.current_user_role() in('company_director','accountant')) with check(public.current_user_role() in('company_director','accountant'));
create policy "financial_depreciation_rw" on public.financial_asset_depreciation for all using(public.current_user_role() in('company_director','accountant')) with check(public.current_user_role() in('company_director','accountant'));
create policy "financial_budgets_rw" on public.financial_budgets for all using(public.current_user_role()='company_director') with check(public.current_user_role()='company_director');
create policy "financial_budget_lines_rw" on public.financial_budget_lines for all using(public.current_user_role()='company_director') with check(public.current_user_role()='company_director');
