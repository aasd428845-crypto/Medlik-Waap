-- =============================================================
-- Migration 0012 — الموردون وفواتير المشتريات
-- =============================================================

create table if not exists public.financial_suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.financial_companies(id) on delete restrict,
  supplier_code text not null,
  name text not null,
  phone text,
  email text,
  address text,
  tax_number text,
  credit_limit numeric(18,2) not null default 0 check (credit_limit >= 0),
  payment_terms_days integer not null default 0 check (payment_terms_days >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, supplier_code)
);

alter table public.financial_account_mappings
  add column if not exists payable_account_id uuid
    references public.financial_accounts(id) on delete restrict;

create table if not exists public.financial_purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.financial_companies(id) on delete restrict,
  supplier_id uuid not null references public.financial_suppliers(id) on delete restrict,
  invoice_number text not null,
  invoice_date date not null,
  due_date date,
  amount numeric(18,2) not null check (amount > 0),
  currency_code text not null default 'YER' references public.financial_currencies(code),
  status text not null default 'pending' check (status in ('pending','paid','cancelled')),
  financial_document_id uuid references public.financial_documents(id) on delete set null,
  journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(company_id, supplier_id, invoice_number)
);

create table if not exists public.financial_purchase_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_invoice_id uuid not null references public.financial_purchase_invoices(id) on delete restrict,
  line_number smallint not null,
  product_id uuid references public.products(id) on delete restrict,
  account_id uuid references public.financial_accounts(id) on delete restrict,
  quantity numeric(18,3) check (quantity is null or quantity > 0),
  unit_cost numeric(18,4) check (unit_cost is null or unit_cost >= 0),
  amount numeric(18,2) not null check (amount > 0),
  description text,
  branch_id uuid references public.branches(id) on delete set null,
  unique(purchase_invoice_id, line_number)
);

create index if not exists financial_suppliers_name_idx
  on public.financial_suppliers(company_id, name);
create index if not exists financial_purchase_invoices_supplier_idx
  on public.financial_purchase_invoices(supplier_id, invoice_date);
create index if not exists financial_purchase_invoice_lines_product_idx
  on public.financial_purchase_invoice_lines(product_id);

alter table public.financial_suppliers enable row level security;
alter table public.financial_purchase_invoices enable row level security;
alter table public.financial_purchase_invoice_lines enable row level security;

create policy "financial_suppliers_read" on public.financial_suppliers
  for select using (public.current_user_role() in ('company_director','accountant'));
create policy "financial_suppliers_write" on public.financial_suppliers
  for all using (public.current_user_role() in ('company_director','accountant'))
  with check (public.current_user_role() in ('company_director','accountant'));
create policy "financial_purchase_invoices_read" on public.financial_purchase_invoices
  for select using (public.current_user_role() in ('company_director','accountant'));
create policy "financial_purchase_invoices_write" on public.financial_purchase_invoices
  for all using (public.current_user_role() in ('company_director','accountant'))
  with check (public.current_user_role() in ('company_director','accountant'));
create policy "financial_purchase_invoice_lines_read" on public.financial_purchase_invoice_lines
  for select using (public.current_user_role() in ('company_director','accountant'));
create policy "financial_purchase_invoice_lines_write" on public.financial_purchase_invoice_lines
  for all using (public.current_user_role() in ('company_director','accountant'))
  with check (public.current_user_role() in ('company_director','accountant'));

create or replace function public.post_financial_purchase_invoice(p_invoice_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.financial_purchase_invoices%rowtype;
  v_mapping public.financial_account_mappings%rowtype;
  v_period_id uuid;
  v_document_id uuid;
  v_journal_id uuid;
  v_total numeric(18,2);
  v_inventory_account uuid;
  v_line record;
  v_line_no smallint := 1;
begin
  select * into v_invoice from public.financial_purchase_invoices where id=p_invoice_id for update;
  if not found then raise exception 'Purchase invoice not found'; end if;
  if v_invoice.status='cancelled' then raise exception 'Cancelled purchase invoice cannot be posted'; end if;
  if v_invoice.amount <= 0 then raise exception 'Purchase invoice amount must be greater than zero'; end if;

  if exists (select 1 from public.financial_posting_links where source_table='financial_purchase_invoices' and source_id=v_invoice.id and posting_type='invoice') then
    select journal_entry_id into v_journal_id from public.financial_posting_links where source_table='financial_purchase_invoices' and source_id=v_invoice.id and posting_type='invoice' limit 1;
    return v_journal_id;
  end if;

  select * into v_mapping from public.financial_account_mappings where company_id=v_invoice.company_id;
  if v_mapping.payable_account_id is null then raise exception 'Payable GL mapping is missing'; end if;

  select coalesce(sum(amount),0) into v_total from public.financial_purchase_invoice_lines where purchase_invoice_id=p_invoice_id;
  if v_total <> v_invoice.amount then raise exception 'Purchase invoice lines do not equal invoice amount'; end if;

  select id into v_inventory_account from public.financial_accounts where company_id=v_invoice.company_id and code='1140' and is_postable=true limit 1;
  if v_inventory_account is null then raise exception 'Inventory GL account 1140 is missing'; end if;

  select p.id into v_period_id
    from public.financial_periods p
    join public.financial_fiscal_years fy on fy.id=p.fiscal_year_id
   where fy.company_id=v_invoice.company_id
     and v_invoice.invoice_date between p.start_date and p.end_date
     and p.status='open' limit 1;
  if v_period_id is null then raise exception 'No open accounting period for purchase invoice date'; end if;

  insert into public.financial_documents(company_id,document_type,source_table,source_id,document_number,description,created_by)
  values(v_invoice.company_id,'supplier_invoice','financial_purchase_invoices',v_invoice.id,v_invoice.invoice_number,'Supplier purchase invoice',auth.uid())
  returning id into v_document_id;

  insert into public.financial_journal_entries(company_id,entry_date,fiscal_period_id,description,source_document_id,created_by)
  values(v_invoice.company_id,v_invoice.invoice_date,v_period_id,'Supplier invoice #'||v_invoice.invoice_number,v_document_id,auth.uid())
  returning id into v_journal_id;

  for v_line in
    select * from public.financial_purchase_invoice_lines where purchase_invoice_id=p_invoice_id order by line_number
  loop
    insert into public.financial_journal_lines(journal_entry_id,line_number,account_id,branch_id,description,debit,credit,currency_code)
    values(v_journal_id,v_line_no,coalesce(v_line.account_id,v_inventory_account),v_line.branch_id,coalesce(v_line.description,'Purchased goods'),v_line.amount,0,v_invoice.currency_code);
    v_line_no := v_line_no + 1;
  end loop;

  insert into public.financial_journal_lines(journal_entry_id,line_number,account_id,description,debit,credit,currency_code)
  values(v_journal_id,32000,v_mapping.payable_account_id,'Accounts payable',0,v_invoice.amount,v_invoice.currency_code);

  perform public.post_financial_journal_entry(v_journal_id);

  update public.financial_purchase_invoices set financial_document_id=v_document_id,journal_entry_id=v_journal_id where id=v_invoice.id;

  insert into public.financial_posting_links(company_id,source_table,source_id,journal_entry_id,posting_type)
  values(v_invoice.company_id,'financial_purchase_invoices',v_invoice.id,v_journal_id,'invoice');

  return v_journal_id;
end;
$$;

revoke all on function public.post_financial_purchase_invoice(uuid) from public;
