-- =============================================================
-- Migration 0010 — Financial Simple Entries (إدخالات مبسّطة)
-- مشروع ويب Medlik-Waap (لوحة تحكم المدير العام)
--
-- دوال محمية (security definer + فحص دور المدير العام) تُنشئ
-- الصف التشغيلي + قيده المحاسبي معاً خلف الكواليس، بحيث لا يرى
-- المستخدم "مدين/دائن" أبداً:
--   1) create_financial_expense      → مصروف + قيد مرتجل (posted)
--   2) create_financial_receipt      → سند قبض + قيد + payments
--   3) create_financial_disbursement → صرف (صناديق/بنوك) + قيد
--   4) create_financial_journal_entry→ قيد يدوي مسودة (لدفتر اليومية)
--   5) post_financial_journal_entry  → تُعاد كتابته مع فحص الدور
-- بذور: الصندوق الرئيسي + البنك الرئيسي (رهناك ربط GL 1110/1120).
-- نفِّذه من Supabase Dashboard → SQL Editor
-- =============================================================

-- 1) بذور الصندوق والبنك الرئيسيين ------------------------------
insert into public.financial_cash_accounts (company_id, code, name, currency_code, gl_account_id, is_active)
select c.id, 'CASH-001', 'الصندوق الرئيسي', 'YER', a.id, true
from public.financial_companies c
join public.financial_accounts a on a.company_id = c.id and a.code = '1110'
where not exists (select 1 from public.financial_cash_accounts ca where ca.company_id = c.id and ca.code = 'CASH-001');

insert into public.financial_bank_accounts (company_id, bank_name, account_name, account_number, currency_code, gl_account_id, is_active)
select c.id, 'البنك الرئيسي', 'الحساب الرئيسي', null, 'YER', a.id, true
from public.financial_companies c
join public.financial_accounts a on a.company_id = c.id and a.code = '1120'
where not exists (select 1 from public.financial_bank_accounts ba where ba.company_id = c.id and ba.account_name = 'الحساب الرئيسي');

-- 2) دوال مساعدة (حماية من التنفيذ العام) -----------------------
revoke all on function public.fn_financial_auto_entry(date, text, text, text, uuid, jsonb) from public;
revoke all on function public.post_financial_journal_entry(uuid) from public;

-- 3) مصروف مبسّط: صف + قيد مرتجل (posted) -----------------------
create or replace function public.create_financial_expense(
  p_amount numeric,
  p_category_account_id uuid default null,
  p_branch_id uuid default null,
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
  v_category uuid;
  v_gl_account_id uuid;
  v_pay_account_id uuid;
  v_expense_id uuid;
  v_entry_id uuid;
begin
  if public.current_user_role() <> 'company_director' then
    raise exception 'غير مصرح لك — مطلوب دور المدير العام';
  end if;
  if p_amount <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  if p_payment_method not in ('cash', 'bank') then
    raise exception 'طريقة الدفع يجب أن تكون cash أو bank';
  end if;

  select c.id into v_company_id from public.financial_companies c order by c.created_at limit 1;
  if v_company_id is null then raise exception 'لا توجد شركة مالية مفعّلة'; end if;

  if p_category_account_id is null then
    select a.id into v_category from public.financial_accounts a
    where a.company_id = v_company_id and a.code = '6000';
  else
    v_category := p_category_account_id;
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

  insert into public.financial_expenses
    (expense_date, category_account_id, amount, branch_id, cash_account_id, bank_account_id, status, description)
  values
    (current_date, v_category, p_amount, p_branch_id,
     case when p_payment_method = 'cash' then v_pay_account_id end,
     case when p_payment_method = 'bank' then v_pay_account_id end,
     'posted', p_description)
  returning id into v_expense_id;

  v_entry_id := public.fn_financial_auto_entry(
    current_date,
    coalesce(p_description, 'مصروف نقدي/بنكي'),
    'expense', 'financial_expenses', v_expense_id,
    jsonb_build_array(
      jsonb_build_object('account_code', (select a.code from public.financial_accounts a where a.id = v_category), 'debit', p_amount, 'credit', 0, 'description', 'مصروف'),
      jsonb_build_object('account_code', (select a.code from public.financial_accounts a where a.id = v_gl_account_id), 'debit', 0, 'credit', p_amount, 'description', case when p_payment_method = 'bank' then 'دفع من البنك' else 'دفع نقداً' end)
    ));
  perform public.post_financial_journal_entry(v_entry_id);

  update public.financial_expenses set journal_entry_id = v_entry_id where id = v_expense_id;

  return v_expense_id;
end;
$$;

grant execute on function public.create_financial_expense(numeric, uuid, uuid, text, text) to authenticated;

-- 4) سند قبض مبسّط: سند + قيد + تخفيض رصيد العميل --------------
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

  -- سند القبض
  insert into public.financial_receipts
    (client_id, amount, cash_account_id, bank_account_id, receipt_date, status, description)
  values
    (p_client_id, p_amount,
     case when p_payment_method = 'cash' then v_pay_account_id end,
     case when p_payment_method = 'bank' then v_pay_account_id end,
     current_date, 'posted', p_description)
  returning id into v_receipt_id;

  -- القيد المرتبط (نقد/بنك ← ذمم العميل)
  v_entry_id := public.fn_financial_auto_entry(
    current_date,
    coalesce(p_description, 'سند قبض من عميل'),
    'receipt', 'financial_receipts', v_receipt_id,
    jsonb_build_array(
      jsonb_build_object('account_code', (select a.code from public.financial_accounts a where a.id = v_gl_account_id), 'debit', p_amount, 'credit', 0, 'description', case when p_payment_method = 'bank' then 'إيداع بنكي' else 'قبض نقدي' end),
      jsonb_build_object('account_code', '1130', 'debit', 0, 'credit', p_amount, 'description', 'تحصيل ذمم عميل')
    ));
  perform public.post_financial_journal_entry(v_entry_id);

  -- تنفيذ Trigger المرحلة 4: خفض current_balance تلقائياً
  insert into public.payments (client_id, amount, created_at)
  values (p_client_id, p_amount, now());

  update public.financial_receipts set journal_entry_id = v_entry_id where id = v_receipt_id;

  return v_receipt_id;
end;
$$;

grant execute on function public.create_financial_receipt(uuid, numeric, text, text) to authenticated;

-- 5) سند صرف مبسّط: حركة صندوق/بنك + قيد (posted) ----------------
create or replace function public.create_financial_disbursement(
  p_amount numeric,
  p_category_account_id uuid default null,
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
  v_category uuid;
  v_gl_account_id uuid;
  v_pay_account_id uuid;
  v_movement_id uuid;
  v_entry_id uuid;
begin
  if public.current_user_role() <> 'company_director' then
    raise exception 'غير مصرح لك — مطلوب دور المدير العام';
  end if;
  if p_amount <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  if p_payment_method not in ('cash', 'bank') then
    raise exception 'طريقة الدفع يجب أن تكون cash أو bank';
  end if;

  select c.id into v_company_id from public.financial_companies c order by c.created_at limit 1;
  if v_company_id is null then raise exception 'لا توجد شركة مالية مفعّلة'; end if;

  if p_category_account_id is null then
    select a.id into v_category from public.financial_accounts a
    where a.company_id = v_company_id and a.code = '6000';
  else
    v_category := p_category_account_id;
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

  -- حركة الصرف (نقداً → cash_movements / بنكياً → bank_movements)
  if p_payment_method = 'cash' then
    insert into public.financial_cash_movements
      (cash_account_id, movement_date, movement_type, amount, status, description)
    values
      (v_pay_account_id, current_date, 'disbursement', p_amount, 'posted', p_description)
    returning id into v_movement_id;
  else
    insert into public.financial_bank_movements
      (bank_account_id, movement_date, movement_type, amount, status, description)
    values
      (v_pay_account_id, current_date, 'withdrawal', p_amount, 'posted', p_description)
    returning id into v_movement_id;
  end if;

  -- القيد المرتبط (مصروف/فئة ← نقد/بنك)
  v_entry_id := public.fn_financial_auto_entry(
    current_date,
    coalesce(p_description, 'سند صرف'),
    'disbursement',
    case when p_payment_method = 'cash' then 'financial_cash_movements' else 'financial_bank_movements' end,
    v_movement_id,
    jsonb_build_array(
      jsonb_build_object('account_code', (select a.code from public.financial_accounts a where a.id = v_category), 'debit', p_amount, 'credit', 0, 'description', 'مصروف بموجب سند صرف'),
      jsonb_build_object('account_code', (select a.code from public.financial_accounts a where a.id = v_gl_account_id), 'debit', 0, 'credit', p_amount, 'description', case when p_payment_method = 'bank' then 'سحب من البنك' else 'صرف نقدي' end)
    ));
  perform public.post_financial_journal_entry(v_entry_id);

  if p_payment_method = 'cash' then
    update public.financial_cash_movements set journal_entry_id = v_entry_id where id = v_movement_id;
  else
    update public.financial_bank_movements set journal_entry_id = v_entry_id where id = v_movement_id;
  end if;

  return v_movement_id;
end;
$$;

grant execute on function public.create_financial_disbursement(numeric, uuid, text, text) to authenticated;

-- 6) قيد يدوي مسودة (لدفتر اليومية — المحاسب المتخصص) ------------
create or replace function public.create_financial_journal_entry(
  p_entry_date date,
  p_description text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
begin
  if public.current_user_role() <> 'company_director' then
    raise exception 'غير مصرح لك — دفتر اليومية للمدير العام فقط';
  end if;
  if p_description is null or btrim(p_description) = '' then
    raise exception 'الوصف مطلوب';
  end if;

  v_entry_id := public.fn_financial_auto_entry(
    p_entry_date, p_description, 'manual', null, null, p_lines);

  return v_entry_id;
end;
$$;

grant execute on function public.create_financial_journal_entry(date, text, jsonb) to authenticated;

-- 7) دالة الترحيل: إعادة كتابتها مع فحص الدور ثم منح التنفيذ ----
create or replace function public.post_financial_journal_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_debit numeric(18,2);
  v_credit numeric(18,2);
  v_count integer;
  v_status text;
  v_period_status text;
begin
  if public.current_user_role() <> 'company_director' then
    raise exception 'غير مصرح لك — مطلوب دور المدير العام';
  end if;

  select status into v_status
  from public.financial_journal_entries
  where id = p_entry_id
  for update;

  if v_status is null then raise exception 'Journal entry not found'; end if;
  if v_status <> 'draft' then raise exception 'Only draft entries can be posted'; end if;

  select status into v_period_status
  from public.financial_periods p
  join public.financial_journal_entries e on e.period_id = p.id
  where e.id = p_entry_id;
  if v_period_status is null or v_period_status <> 'open' then
    raise exception 'Period is closed or missing';
  end if;

  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
  into v_count, v_debit, v_credit
  from public.financial_journal_lines
  where journal_entry_id = p_entry_id;

  if v_count < 2 or v_debit <> v_credit then
    raise exception 'Journal entry is not balanced';
  end if;

  update public.financial_journal_entries
  set status = 'posted', posted_at = now(), posted_by = auth.uid()
  where id = p_entry_id;
end;
$$;

grant execute on function public.post_financial_journal_entry(uuid) to authenticated;