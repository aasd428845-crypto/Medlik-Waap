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