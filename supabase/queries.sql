-- =============================================================
-- مفتاح الاستعلامات — النظام المالي
-- مشروع ويب Medlik-Waap (لوحة تحكم المدير العام)
--
-- كل استعلامات النظام المالي الجاهزة للتشغيل من
-- Supabase Dashboard → SQL Editor (قراءة فقط، بدون تعديلات).
-- =============================================================

-- ── 1) اللوحة المالية الحية (نظرة عامة) ─────────────────────
select
  (select count(*) from financial_accounts where is_active) as عدد_الحسابات,
  (select count(*) from financial_journal_entries where status = 'posted') as القيود_المرحلة,
  (select count(*) from financial_journal_entries where status = 'draft') as القيود_المسودة,
  (select count(*) from financial_cash_accounts where is_active) as صناديق_نشطة,
  (select count(*) from financial_bank_accounts where is_active) as بنوك_نشطة,
  (select coalesce(sum(current_balance), 0) from users where role = 'client') as اجمالي_الذمم;

-- ── 2) عمولات الأطباء المستحقة (TRIGGER الدفعات) ────────────
select * from public.get_doctors_payables();

-- ── 3) دفع عمولات الأطباء دفعة واحدة ────────────────────────
-- select public.create_doctors_payouts_entries(
--   array(select doctor_id from public.get_doctors_payables() where payables > 0),
--   'cash'  -- أو 'bank'
-- );

-- آخر كشوف الدفع:
select payout_number, payout_date, payment_method, total_amount, status, description
from payout_documents
order by payout_date desc
limit 10;

-- بنود آخر كشوف الدفع:
select pd.payout_number, pli.doctor_user_id, u.name as الطبيب, pli.amount
from payout_line_items pli
join payout_documents pd on pd.id = pli.payout_document_id
left join users u on u.id = pli.doctor_user_id
order by pd.created_at desc
limit 50;

-- ── 4) دليل الحسابات ────────────────────────────────────────
select code, name, account_type, level, normal_balance, is_postable, is_active
from financial_accounts
order by code;

-- ── 5) القيود المحاسبية (دفتر اليومية والأستاذ) ─────────────
select entry_number, entry_date, description, status, posted_at
from financial_journal_entries
order by created_at desc
limit 50;

-- أسطر القيود (دفتر الأستاذ):
select je.entry_number, jl.line_number, a.code as الحساب, a.name, jl.debit, jl.credit
from financial_journal_lines jl
join financial_journal_entries je on je.id = jl.journal_entry_id
join financial_accounts a on a.id = jl.account_id
where je.status = 'posted'
order by je.entry_date desc, jl.journal_entry_id, jl.line_number
limit 200;

-- ميزان المراجعة (المجاميع والرصيد لكل حساب):
select a.code, a.name, a.normal_balance,
       sum(jl.debit) as مدين, sum(jl.credit) as دائن,
       sum(jl.debit - jl.credit) as صافي
from financial_journal_lines jl
join financial_journal_entries je on je.id = jl.journal_entry_id
join financial_accounts a on a.id = jl.account_id
where je.status = 'posted'
group by a.code, a.name, a.normal_balance
order by a.code;

-- ── 6) السندات (قبض) ────────────────────────────────────────
select receipt_number, receipt_date, amount, payment_method, status, description
from financial_receipts
order by receipt_date desc
limit 20;

-- ── 7) المصروفات والصرف (تعريفة من الفئات) ──────────────────
select e.expense_number, e.expense_date, e.amount,
       case when e.cash_account_id is not null then 'cash' else 'bank' end as payment_method,
       e.status,
       a.code as فئة, a.name as اسم_الفئة, e.description
from financial_expenses e
left join financial_accounts a on a.id = e.category_account_id
order by e.expense_date desc
limit 20;

-- حركات الصندوق:
select movement_date, movement_type, amount, description
from financial_cash_movements
order by movement_date desc
limit 20;

-- حركات البنك:
select movement_date, movement_type, amount, description
from financial_bank_movements
order by movement_date desc
limit 20;

-- ── 8) المستندات المالية (المصدر المشترك للقيود) ────────────
select document_number, document_type, description, source_table, source_id
from financial_documents
order by created_at desc
limit 50;

-- ── 9) سجل التدقيق والترميم (الاستثناءات فقط) ───────────────
select created_at, action, entity_table, entity_id, reason
from financial_audit_logs
where action like '%failed%'
order by created_at desc
limit 50;