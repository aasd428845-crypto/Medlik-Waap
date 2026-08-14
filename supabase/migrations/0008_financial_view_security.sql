-- 0008 — حماية واجهات التقارير وربط الشركة
create policy "financial_companies_access" on public.financial_companies for all using(public.current_user_role() in('company_director','accountant')) with check(public.current_user_role() in('company_director','accountant'));

alter view public.financial_general_ledger set (security_invoker = true);
alter view public.financial_trial_balance set (security_invoker = true);
alter view public.financial_branch_profitability set (security_invoker = true);

create index if not exists financial_journal_entries_period_idx on public.financial_journal_entries(period_id,status);
create index if not exists financial_journal_lines_account_idx on public.financial_journal_lines(account_id);
create index if not exists financial_receipts_client_idx on public.financial_receipts(client_id,receipt_date);
create index if not exists financial_inventory_product_idx on public.financial_inventory_movements(product_id,movement_date);
