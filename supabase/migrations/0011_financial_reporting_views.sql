-- =============================================================
-- Migration 0011 — التقارير المالية الأساسية
-- =============================================================

create or replace view public.financial_general_ledger
with (security_invoker = true)
as
select
  je.company_id,
  je.id as journal_entry_id,
  je.entry_number,
  je.entry_date,
  je.description as entry_description,
  je.status as entry_status,
  jl.id as journal_line_id,
  jl.line_number,
  jl.account_id,
  a.code as account_code,
  a.name as account_name,
  a.account_type,
  jl.branch_id,
  jl.cost_center_id,
  jl.description as line_description,
  jl.debit,
  jl.credit,
  jl.currency_code,
  jl.exchange_rate,
  (jl.debit - jl.credit) as signed_amount
from public.financial_journal_entries je
join public.financial_journal_lines jl on jl.journal_entry_id = je.id
join public.financial_accounts a on a.id = jl.account_id
where je.status = 'posted';

create or replace view public.financial_trial_balance
with (security_invoker = true)
as
select
  a.company_id,
  a.id as account_id,
  a.code as account_code,
  a.name as account_name,
  a.account_type,
  coalesce(sum(gl.debit),0)::numeric(18,2) as total_debit,
  coalesce(sum(gl.credit),0)::numeric(18,2) as total_credit,
  coalesce(sum(gl.debit - gl.credit),0)::numeric(18,2) as net_balance
from public.financial_accounts a
left join public.financial_general_ledger gl on gl.account_id = a.id
where a.is_active = true
group by a.company_id, a.id, a.code, a.name, a.account_type;

create or replace view public.financial_customer_statement
with (security_invoker = true)
as
select
  i.client_id,
  i.id as document_id,
  i.created_at::date as transaction_date,
  'invoice'::text as transaction_type,
  i.id::text as reference,
  i.amount::numeric(18,2) as debit,
  0::numeric(18,2) as credit,
  i.status,
  i.due_date
from public.invoices i
union all
select
  p.client_id,
  p.id as document_id,
  p.created_at::date as transaction_date,
  'payment'::text as transaction_type,
  p.id::text as reference,
  0::numeric(18,2) as debit,
  p.amount::numeric(18,2) as credit,
  null::text as status,
  null::date as due_date
from public.payments p;

create index if not exists financial_journal_entries_status_date_idx
  on public.financial_journal_entries(company_id, status, entry_date);

-- =============================================================
