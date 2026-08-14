-- 0009 — المحاسبة عن المخزون والدفعات والجرد

create table if not exists public.financial_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid references public.warehouse_inventory(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null check(movement_type in('receipt','sale','return_in','return_out','transfer_in','transfer_out','adjustment','damage','expired','sample')),
  quantity numeric(18,3) not null check(quantity<>0),
  unit_cost numeric(18,4) not null default 0 check(unit_cost>=0),
  movement_date timestamptz not null default now(),
  reference_type text, reference_id uuid,
  journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict,
  created_by uuid references public.users(id) on delete set null, created_at timestamptz not null default now()
);
create index if not exists financial_inventory_movements_product_idx on public.financial_inventory_movements(product_id,movement_date);
create index if not exists financial_inventory_movements_batch_idx on public.financial_inventory_movements(inventory_id,movement_date);

create table if not exists public.financial_stock_counts (
  id uuid primary key default gen_random_uuid(), count_number bigint generated always as identity,
  branch_id uuid not null references public.branches(id) on delete restrict,
  count_date date not null default current_date, status text not null default 'draft' check(status in('draft','approved','posted','cancelled')),
  approved_by uuid references public.users(id) on delete set null, approved_at timestamptz,
  journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict, notes text,
  created_by uuid references public.users(id) on delete set null, created_at timestamptz not null default now()
);
create table if not exists public.financial_stock_count_lines (
  id uuid primary key default gen_random_uuid(), stock_count_id uuid not null references public.financial_stock_counts(id) on delete cascade,
  inventory_id uuid references public.warehouse_inventory(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  system_quantity numeric(18,3) not null default 0,
  counted_quantity numeric(18,3) not null default 0,
  unit_cost numeric(18,4) not null default 0,
  difference_quantity numeric(18,3) generated always as (counted_quantity-system_quantity) stored,
  notes text
);

-- ربط المخزون بالـGL دون فرض حسابات محددة قبل تهيئة دليل الحسابات.
create table if not exists public.financial_inventory_account_mapping (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.financial_companies(id) on delete cascade,
  inventory_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  cogs_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  inventory_adjustment_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  unique(company_id)
);

alter table public.financial_inventory_movements enable row level security;
alter table public.financial_stock_counts enable row level security;
alter table public.financial_stock_count_lines enable row level security;
alter table public.financial_inventory_account_mapping enable row level security;
create policy "financial_inventory_movements_rw" on public.financial_inventory_movements for all using(public.current_user_role() in('company_director','accountant')) with check(public.current_user_role() in('company_director','accountant'));
create policy "financial_stock_counts_rw" on public.financial_stock_counts for all using(public.current_user_role() in('company_director','accountant')) with check(public.current_user_role() in('company_director','accountant'));
create policy "financial_stock_count_lines_rw" on public.financial_stock_count_lines for all using(public.current_user_role() in('company_director','accountant')) with check(public.current_user_role() in('company_director','accountant'));
create policy "financial_inventory_mapping_rw" on public.financial_inventory_account_mapping for all using(public.current_user_role()='company_director') with check(public.current_user_role()='company_director');
