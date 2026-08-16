-- =============================================================
-- Migration 0012 — إصلاح أعمدة سندات القبض
-- مشروع ويب Medlik-Waap (لوحة تحكم المدير العام)
--
-- financial_receipts في 0006 لا يحوي عمودي payment_method و
-- description، بينما تعتمد عليهما:
--   1) create_financial_receipt (0010) — إدراج وقت التشغيل
--   2) queries.sql — استعلام السندات
--   3) لوحة الـ Stitch المالية — بند "آخر الحركات المالية"
-- هذا الملف يضيف العمودين بأمان ويعيد تعبئة payment_method
-- من cash_account_id / bank_account_id للموجود.
-- نفِّذه من Supabase Dashboard → SQL Editor
-- =============================================================

alter table public.financial_receipts
  add column if not exists payment_method text
  check (payment_method in ('cash', 'bank'));

alter table public.financial_receipts
  add column if not exists description text;

update public.financial_receipts
set payment_method = case when cash_account_id is not null then 'cash' else 'bank' end
where payment_method is null;

-- إبقاء الدالة محدّثة لتحفظ الطريقة صراحةً عند السندات الجديدة
create or replace function public.create_financial_receipt(
  p_client_id uuid,
  p_amount numeric,
  p_payment_method text default 'cash',
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_gl_account_id uuid;
  v_pay_account_id uuid;
  v_receipt_id uuid;
  v_entry_id uuid;
begin
  if public.current_user_role() <> 'company_director' then
    raise exception 'غير مصرح لك — مطلوب دور المدير العام';
  end if;
  if p_amount <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  if p_payment_method not in ('cash', 'bank') then
    raise exception 'طريقة الدفع يجب أن تكون cash أو bank';
  end if;

  if p_payment_method = 'bank' then
    select ga.gl_account_id, ga.id into v_gl_account_id, v_pay_account_id
    from public.financial_bank_accounts ga
    where ga.is_active = true order by ga.created_at limit 1;
  else
    select ga.gl_account_id, ga.id into v_gl_account_id, v_pay_account_id
    from public.financial_cash_accounts ga
    where ga.is_active = true order by ga.created_at limit 1;
  end if;
  if v_gl_account_id is null then
    raise exception 'لا يوجد حساب % مفعّل — نفّذ بذور الصندوق/البنك أولاً', p_payment_method;
  end if;

  insert into public.financial_receipts
    (client_id, amount, cash_account_id, bank_account_id, receipt_date, status, payment_method, description)
  values
    (p_client_id, p_amount,
     case when p_payment_method = 'cash' then v_pay_account_id end,
     case when p_payment_method = 'bank' then v_pay_account_id end,
     current_date, 'posted', p_payment_method, p_description)
  returning id into v_receipt_id;

  v_entry_id := public.fn_financial_auto_entry(
    current_date,
    coalesce(p_description, 'سند قبض من عميل'),
    'receipt', 'financial_receipts', v_receipt_id,
    jsonb_build_array(
      jsonb_build_object('account_code', (select a.code from public.financial_accounts a where a.id = v_gl_account_id), 'debit', p_amount, 'credit', 0, 'description', case when p_payment_method = 'bank' then 'إيداع بنكي' else 'قبض نقدي' end),
      jsonb_build_object('account_code', '1130', 'debit', 0, 'credit', p_amount, 'description', 'تحصيل ذمم عميل')
    ));
  perform public.post_financial_journal_entry(v_entry_id);

  insert into public.payments (client_id, amount, created_at)
  values (p_client_id, p_amount, now());

  update public.financial_receipts set journal_entry_id = v_entry_id where id = v_receipt_id;

  return v_receipt_id;
end;
$$;

grant execute on function public.create_financial_receipt(uuid, numeric, text, text) to authenticated;