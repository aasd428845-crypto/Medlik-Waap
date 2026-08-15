-- =============================================================
-- Migration 0009 — Financial Auto Posting (القيود التلقائية)
-- مشروع ويب Medlik-Waap (لوحة تحكم المدير العام)
--
-- 1) حساب مصروف العمولات (6110) يُضاف إلى دليل الحسابات.
-- 2) تعديل قيد movement_type في حركة المخزون لإضافة 'bonus'.
-- 3) دالة مساعدة fn_financial_auto_entry تُنشئ مستنداً + قيداً
--    (draft — يحتاج ترحيلاً يدوياً من دفتر اليومية) بأسطر متوازنة.
-- 4) Triggers تلقائية:
--    - invoices          → مدين 1130 (ذمم العملاء) / دائن 4000 (الإيرادات)
--    - driver_commissions → عند status='paid' → مدين 6110 (عمولات) / دائن 1110 (الصندوق)
--    - order_items        → عند is_bonus=true → حركة مخزون بنوع 'bonus' (كمية سالبة)
-- 5) أي فشل يُسجَّل في financial_audit_logs ولا يُسقط العملية الأصلية.
-- نفِّذه من Supabase Dashboard → SQL Editor
-- =============================================================

-- 1) حساب مصروفات عمولات المندوبين -----------------------------
insert into public.financial_accounts (company_id, code, name, account_type, level, is_postable, normal_balance)
select c.id, '6110', 'مصروفات عمولات المندوبين', 'expense', 3, true, 'debit'
from public.financial_companies c
where not exists (
  select 1 from public.financial_accounts a
  where a.company_id = c.id and a.code = '6110'
);

-- 2) إضافة نوع حركة 'bonus' إلى حركة المخزون --------------------
alter table public.financial_inventory_movements
  drop constraint if exists financial_inventory_movements_movement_type_check;

alter table public.financial_inventory_movements
  add constraint financial_inventory_movements_movement_type_check
  check (movement_type in ('receipt', 'sale', 'return_in', 'return_out', 'transfer_in', 'transfer_out', 'adjustment', 'damage', 'expired', 'sample', 'bonus'));

-- 3) دالة القيد التلقائي ----------------------------------------
create or replace function public.fn_financial_auto_entry(
  p_entry_date date,
  p_description text default null,
  p_document_type text default 'auto',
  p_source_table text default null,
  p_source_id uuid default null,
  p_lines jsonb default '[]'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_period_id uuid;
  v_doc_id uuid;
  v_entry_id uuid;
  v_line jsonb;
  v_account_id uuid;
  v_sequence integer := 0;
begin
  select c.id into v_company_id
  from public.financial_companies c
  order by c.created_at limit 1;
  if v_company_id is null then raise exception 'No financial company configured'; end if;

  select p.id into v_period_id
  from public.financial_periods p
  where p.start_date <= p_entry_date and p.end_date >= p_entry_date
  order by p.start_date desc limit 1;

  insert into public.financial_documents
    (company_id, document_type, source_table, source_id, description, document_number, created_by)
  values
    (v_company_id, p_document_type, p_source_table, p_source_id, p_description,
     coalesce(p_document_type, 'auto') || '-' || to_char(now(), 'YYYYMMDD-HH24MISS'), auth.uid())
  returning id into v_doc_id;

  insert into public.financial_journal_entries
    (company_id, entry_date, period_id, description, status, source_document_id, created_by)
  values
    (v_company_id, p_entry_date, v_period_id, coalesce(p_description, 'قيد تلقائي'), 'draft', v_doc_id, auth.uid())
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_sequence := v_sequence + 1;

    select a.id into v_account_id
    from public.financial_accounts a
    where a.company_id = v_company_id and a.code = v_line->>'account_code';

    if v_account_id is null then
      raise exception 'Account code "%" not found for auto entry', v_line->>'account_code';
    end if;

    insert into public.financial_journal_lines
      (journal_entry_id, line_number, account_id, description, debit, credit)
    values
      (v_entry_id, v_sequence, v_account_id, v_line->>'description',
       coalesce((v_line->>'debit')::numeric, 0),
       coalesce((v_line->>'credit')::numeric, 0));
  end loop;

  return v_entry_id;
end;
$$;

revoke all on function public.fn_financial_auto_entry(date, text, text, text, uuid, jsonb) from public;

-- 4) Trigger 1: فاتورة → قيد ذمم/إيرادات (draft) -----------------
create or replace function public.trg_financial_invoice_auto_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status = 'cancelled' or NEW.amount <= 0 then return NEW; end if;

  begin
    perform public.fn_financial_auto_entry(
      coalesce(NEW.due_date, NEW.created_at::date),
      'إشعار فاتورة عميل رقم ' || NEW.id::text,
      'invoice', 'invoices', NEW.id,
      jsonb_build_array(
        jsonb_build_object('account_code', '1130', 'debit', NEW.amount, 'credit', 0, 'description', 'فاتورة عميل — ذمم مدينة'),
        jsonb_build_object('account_code', '4000', 'debit', 0, 'credit', NEW.amount, 'description', 'فاتورة عميل — إيرادات مبيعات')
      ));
  exception when others then
    insert into public.financial_audit_logs (actor_user_id, action, entity_table, entity_id, new_data, reason)
    values (auth.uid(), 'auto_journal_failed', 'invoices', NEW.id, row_to_json(NEW)::jsonb,
            'فشل قيد الفاتورة التلقائي: ' || SQLERRM);
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_financial_invoice_auto_journal on public.invoices;
create trigger trg_financial_invoice_auto_journal
  after insert on public.invoices
  for each row
  execute function public.trg_financial_invoice_auto_journal();

-- 5) Trigger 2: عمولة مندوب تصل لـ paid → قيد (draft) ------------
create or replace function public.trg_financial_commission_auto_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status <> 'paid' then return NEW; end if;

  begin
    perform public.fn_financial_auto_entry(
      current_date,
      'عمولة مندوب توصيل — معاملة ' || NEW.order_id::text,
      'driver_commission', 'driver_commissions', NEW.id,
      jsonb_build_array(
        jsonb_build_object('account_code', '6110', 'debit', NEW.amount, 'credit', 0, 'description', 'مصروف عمولة مندوب'),
        jsonb_build_object('account_code', '1110', 'debit', 0, 'credit', NEW.amount, 'description', 'صرف من الصندوق')
      ));
  exception when others then
    insert into public.financial_audit_logs (actor_user_id, action, entity_table, entity_id, new_data, reason)
    values (auth.uid(), 'auto_journal_failed', 'driver_commissions', NEW.id, row_to_json(NEW)::jsonb,
            'فشل قيد العمولة التلقائي: ' || SQLERRM);
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_financial_commission_auto_journal on public.driver_commissions;
create trigger trg_financial_commission_auto_journal
  after insert on public.driver_commissions
  for each row
  when (NEW.status = 'paid')
  execute function public.trg_financial_commission_auto_journal();

drop trigger if exists trg_financial_commission_auto_journal_update on public.driver_commissions;
create trigger trg_financial_commission_auto_journal_update
  after update on public.driver_commissions
  for each row
  when (NEW.status = 'paid' and OLD.status is distinct from 'paid')
  execute function public.trg_financial_commission_auto_journal();

-- 6) Trigger 3: بند طلب بونصي → حركة مخزون (bonus) --------------
create or replace function public.trg_financial_bonus_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
  v_unit_cost numeric(18,4) := 0;
begin
  select o.branch_id into v_branch_id from public.orders o where o.id = NEW.order_id;
  if v_branch_id is null then return NEW; end if;

  select coalesce(p.unit_price, 0) into v_unit_cost
  from public.products p where p.id = NEW.product_id;

  begin
    insert into public.financial_inventory_movements
      (branch_id, product_id, movement_type, quantity, unit_cost, reference_type, reference_id, movement_date)
    values
      (v_branch_id, NEW.product_id, 'bonus', -NEW.quantity, v_unit_cost, 'order_items', NEW.id, now());
  exception when others then
    insert into public.financial_audit_logs (actor_user_id, action, entity_table, entity_id, new_data, reason)
    values (auth.uid(), 'bonus_movement_failed', 'order_items', NEW.id, row_to_json(NEW)::jsonb,
            'فشل تسجيل حركة البونص في المخزون: ' || SQLERRM);
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_financial_bonus_inventory on public.order_items;
create trigger trg_financial_bonus_inventory
  after insert on public.order_items
  for each row
  when (NEW.is_bonus)
  execute function public.trg_financial_bonus_inventory();