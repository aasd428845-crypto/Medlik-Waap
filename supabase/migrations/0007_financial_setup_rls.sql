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