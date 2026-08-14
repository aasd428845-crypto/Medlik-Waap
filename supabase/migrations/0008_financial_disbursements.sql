-- =============================================================
-- Migration 0008 — سندات الصرف والمصروفات
-- Medlik-Waap
-- =============================================================

create table if not exists public.financial_disbursements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.financial_companies(id) on delete restrict,
  disbursement_number bigint generated always as identity,
  disbursement_date date not null default current_date,
  amount numeric(18,2) not null check (amount > 0),
  currency_code text not null default 'YER' references public.financial_currencies(code),
  cash_account_id uuid references public.financial_cash_accounts(id) on delete restrict,
  bank_account_id uuid references public.financial_bank_accounts(id) on delete restrict,
  financial_document_id uuid references public.financial_documents(id) on delete set null,
  journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','posted','voided')),
  beneficiary_name text,
  reference_number text,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  posted_by uuid references public.users(id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references public.users(id) on delete set null,
  void_reason text,
  check ((cash_account_id is not null) <> (bank_account_id is not null))
);

create table if not exists public.financial_disbursement_lines (
  id uuid primary key default gen_random_uuid(),
  disbursement_id uuid not null references public.financial_disbursements(id) on delete restrict,
  line_number smallint not null,
  account_id uuid not null references public.financial_accounts(id) on delete restrict,
  cost_center_id uuid references public.financial_cost_centers(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  description text,
  amount numeric(18,2) not null check (amount > 0),
  unique(disbursement_id, line_number)
);

create index if not exists financial_disbursements_date_idx
  on public.financial_disbursements(company_id, disbursement_date);
create index if not exists financial_disbursement_lines_account_idx
  on public.financial_disbursement_lines(account_id);

alter table public.financial_disbursements enable row level security;
alter table public.financial_disbursement_lines enable row level security;

create policy "financial_disbursements_read" on public.financial_disbursements
  for select using (public.current_user_role() in ('company_director','accountant'));
create policy "financial_disbursements_insert" on public.financial_disbursements
  for insert with check (public.current_user_role() in ('company_director','accountant'));
create policy "financial_disbursement_lines_read" on public.financial_disbursement_lines
  for select using (public.current_user_role() in ('company_director','accountant'));
create policy "financial_disbursement_lines_insert" on public.financial_disbursement_lines
  for insert with check (public.current_user_role() in ('company_director','accountant'));

create or replace function public.post_financial_disbursement(p_disbursement_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_disbursement public.financial_disbursements%rowtype;
  v_gl_account uuid;
  v_branch_id uuid;
  v_period_id uuid;
  v_document_id uuid;
  v_journal_id uuid;
  v_lines_total numeric(18,2);
  v_invalid integer;
begin
  select * into v_disbursement
    from public.financial_disbursements
   where id = p_disbursement_id
   for update;

  if not found then raise exception 'Financial disbursement not found'; end if;
  if v_disbursement.status <> 'draft' then raise exception 'Only draft disbursements can be posted'; end if;

  if v_disbursement.cash_account_id is not null then
    select gl_account_id, branch_id into v_gl_account, v_branch_id
      from public.financial_cash_accounts
     where id = v_disbursement.cash_account_id
       and company_id = v_disbursement.company_id
       and is_active = true;
  else
    select gl_account_id, branch_id into v_gl_account, v_branch_id
      from public.financial_bank_accounts
     where id = v_disbursement.bank_account_id
       and company_id = v_disbursement.company_id
       and is_active = true;
  end if;

  if v_gl_account is null then
    raise exception 'Disbursement cash/bank account is not configured with a GL account';
  end if;

  select coalesce(sum(amount),0), count(*)
    into v_lines_total, v_invalid
    from public.financial_disbursement_lines
   where disbursement_id = p_disbursement_id;

  if v_invalid = 0 then raise exception 'Disbursement requires at least one accounting line'; end if;
  if v_lines_total <> v_disbursement.amount then
    raise exception 'Disbursement lines must equal header amount: lines=% header=%', v_lines_total, v_disbursement.amount;
  end if;

  if exists (
    select 1
      from public.financial_disbursement_lines l
      join public.financial_accounts a on a.id = l.account_id
     where l.disbursement_id = p_disbursement_id
       and (a.company_id <> v_disbursement.company_id or a.is_active = false or a.is_postable = false)
  ) then
    raise exception 'One or more disbursement accounts are invalid or not postable';
  end if;

  select p.id into v_period_id
    from public.financial_periods p
    join public.financial_fiscal_years fy on fy.id = p.fiscal_year_id
   where fy.company_id = v_disbursement.company_id
     and v_disbursement.disbursement_date between p.start_date and p.end_date
     and p.status = 'open'
   limit 1;

  if v_period_id is null then raise exception 'No open accounting period for disbursement date'; end if;

  insert into public.financial_documents (
    company_id, document_type, source_table, source_id, document_number, description, created_by
  ) values (
    v_disbursement.company_id, 'disbursement', 'financial_disbursements', v_disbursement.id,
    v_disbursement.disbursement_number::text,
    coalesce(v_disbursement.notes, 'Financial disbursement'), auth.uid()
  ) returning id into v_document_id;

  insert into public.financial_journal_entries (
    company_id, entry_date, fiscal_period_id, description, source_document_id, created_by
  ) values (
    v_disbursement.company_id, v_disbursement.disbursement_date, v_period_id,
    coalesce(v_disbursement.notes, 'Financial disbursement #' || v_disbursement.disbursement_number),
    v_document_id, auth.uid()
  ) returning id into v_journal_id;

  insert into public.financial_journal_lines (
    journal_entry_id, line_number, account_id, cost_center_id, branch_id,
    description, debit, credit, currency_code
  )
  select v_journal_id, l.line_number, l.account_id, l.cost_center_id, coalesce(l.branch_id, v_branch_id),
         coalesce(l.description, v_disbursement.beneficiary_name, 'Disbursement'),
         l.amount, 0, v_disbursement.currency_code
    from public.financial_disbursement_lines l
   where l.disbursement_id = p_disbursement_id;

  insert into public.financial_journal_lines (
    journal_entry_id, line_number, account_id, branch_id,
    description, debit, credit, currency_code
  ) values (
    v_journal_id, 32000, v_gl_account, v_branch_id,
    'Cash/bank disbursement', 0, v_disbursement.amount, v_disbursement.currency_code
  );

  perform public.post_financial_journal_entry(v_journal_id);

  update public.financial_disbursements
     set financial_document_id = v_document_id,
         journal_entry_id = v_journal_id,
         status = 'posted',
         posted_at = now(),
         posted_by = auth.uid()
   where id = p_disbursement_id;

  insert into public.financial_posting_links (
    company_id, source_table, source_id, journal_entry_id, posting_type
  ) values (
    v_disbursement.company_id, 'financial_disbursements', v_disbursement.id,
    v_journal_id, 'payment'
  );

  return v_journal_id;
end;
$$;

revoke all on function public.post_financial_disbursement(uuid) from public;
-- =============================================================
