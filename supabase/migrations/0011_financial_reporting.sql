-- 0011 — التقارير المالية الأساسية

create or replace view public.financial_general_ledger as
select je.company_id, je.id as journal_entry_id, je.entry_number, je.entry_date, je.status, je.description,
       jl.line_number, jl.account_id, a.code as account_code, a.name as account_name,
       jl.branch_id, jl.cost_center_id, jl.debit, jl.credit, jl.currency_code, jl.exchange_rate
from public.financial_journal_entries je
join public.financial_journal_lines jl on jl.journal_entry_id=je.id
join public.financial_accounts a on a.id=jl.account_id
where je.status='posted';

create or replace view public.financial_trial_balance as
select je.company_id, jl.account_id, a.code as account_code, a.name as account_name,
       sum(jl.debit) as total_debit, sum(jl.credit) as total_credit,
       sum(jl.debit-jl.credit) as net_balance
from public.financial_journal_entries je
join public.financial_journal_lines jl on jl.journal_entry_id=je.id
join public.financial_accounts a on a.id=jl.account_id
where je.status='posted'
group by je.company_id,jl.account_id,a.code,a.name;

create or replace view public.financial_branch_profitability as
select je.company_id, jl.branch_id,
       sum(case when a.account_type='revenue' then jl.credit-jl.debit else 0 end) as revenue,
       sum(case when a.account_type='cogs' then jl.debit-jl.credit else 0 end) as cost_of_goods,
       sum(case when a.account_type='expense' then jl.debit-jl.credit else 0 end) as expenses,
       sum(case when a.account_type='revenue' then jl.credit-jl.debit else 0 end)
       -sum(case when a.account_type in('cogs','expense') then jl.debit-jl.credit else 0 end) as net_profit
from public.financial_journal_entries je
join public.financial_journal_lines jl on jl.journal_entry_id=je.id
join public.financial_accounts a on a.id=jl.account_id
where je.status='posted'
group by je.company_id,jl.branch_id;

create or replace view public.financial_customer_balances as
select u.id as client_id, u.full_name, u.credit_limit, u.current_balance,
       coalesce(sum(case when i.status='pending' then i.amount else 0 end),0) as invoice_balance,
       coalesce(sum(p.amount),0) as total_payments
from public.users u
left join public.invoices i on i.client_id=u.id
left join public.payments p on p.client_id=u.id
group by u.id,u.full_name,u.credit_limit,u.current_balance;

create or replace view public.financial_cash_bank_summary as
select 'cash'::text as account_kind, c.id as account_id, c.name, c.currency_code,
       coalesce(sum(case when m.movement_type in('receipt','transfer_in') then m.amount else -m.amount end),0) as balance
from public.financial_cash_accounts c left join public.financial_cash_movements m on m.cash_account_id=c.id and m.status='posted'
group by c.id,c.name,c.currency_code
union all
select 'bank', b.id, b.account_name, b.currency_code,
       coalesce(sum(case when m.movement_type in('deposit','transfer_in') then m.amount else -m.amount end),0)
from public.financial_bank_accounts b left join public.financial_bank_movements m on m.bank_account_id=b.id and m.status='posted'
group by b.id,b.account_name,b.currency_code;

alter view public.financial_general_ledger owner to postgres;
alter view public.financial_trial_balance owner to postgres;
alter view public.financial_branch_profitability owner to postgres;
alter view public.financial_customer_balances owner to postgres;
alter view public.financial_cash_bank_summary owner to postgres;
