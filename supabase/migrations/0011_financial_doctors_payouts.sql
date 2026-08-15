-- =============================================================
-- Migration 0011 — Doctor Payouts (دفع عمولات الأطباء دفعة واحدة)
-- مشروع ويب Medlik-Waap (لوحة تحكم المدير العام — النظام المالي)
--
-- 1) حساب "عمولات الأطباء المستحقة" (126000) في دليل الحسابات إن غاب.
-- 2) جداول كشوف الدفع payout_documents + payout_line_items مع RLS.
-- 3) get_doctors_payables(): رصيد كل طبيب من القيود المرحّلة
--    (ناتج: مدين 6110 عمولات / دائن 126000 عند الاستحقاق،
--     ثم مدين 126000 / دائن صندوق عند الدفع — فتنخفض تلقائياً).
-- 4) create_doctors_payouts_entries(uuid[], text): دفع كل المبالغ
--    المستحقة دفعة واحدة: كشف + بنود + قيد مرحَّل فوراً (دون مسودات).
-- 5) الحماية: revoke public / grant authenticated + فحص دور المدير.
-- نفِّذه من Supabase Dashboard → SQL Editor
-- =============================================================

-- 1) حساب عمولات الأطباء المستحقة (التزام لحين الدفع) -------------
insert into public.financial_accounts (company_id, code, name, account_type, level, is_postable, is_active, normal_balance)
select c.id, '126000', 'عمولات الأطباء المستحقة الدفع', 'liability', 3, true, true, 'credit'
from public.financial_companies c
where not exists (
  select 1 from public.financial_accounts a
  where a.company_id = c.id and a.code = '126000'
);

-- 2) جدول كشوف الدفع -------------------------------------------
create table if not exists public.payout_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.financial_companies(id),
  payout_number bigint generated always as identity (start with 1001),
  payout_date date not null default current_date,
  payment_method text not null default 'cash' check (payment_method in ('cash','bank')),
  total_amount numeric(18,4) not null default 0,
  status text not null default 'posted' check (status in ('posted','voided')),
  journal_entry_id uuid references public.financial_journal_entries(id),
  description text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.payout_line_items (
  id uuid primary key default gen_random_uuid(),
  payout_document_id uuid not null references public.payout_documents(id) on delete cascade,
  doctor_user_id uuid not null references public.users(id),
  amount numeric(18,4) not null default 0 check (amount >= 0),
  created_at timestamptz not null default now()
);

alter table public.payout_documents enable row level security;
alter table public.payout_line_items enable row level security;

create policy "director payout_documents all"
  on public.payout_documents for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'company_director'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'company_director'));

create policy "director payout_line_items all"
  on public.payout_line_items for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'company_director'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'company_director'));

-- 3) رصيد الطبيب المستحق من القيود المرحّلة ---------------------
create or replace function public.fn_doctor_payables(v_doctor_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(jl.debit - jl.credit), 0)
  from public.financial_journal_lines jl
  join public.financial_journal_entries je on je.id = jl.journal_entry_id
  join public.financial_accounts a on a.id = jl.account_id
  where je.status = 'posted'
    and a.code = '126000'
    and jl.description like '%' || v_doctor_id::text || '%';
$$;

revoke all on function public.fn_doctor_payables(uuid) from public;

create or replace function public.get_doctors_payables()
returns table (doctor_id uuid, doctor_name text, payables numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select u.id,
           coalesce(u.name, u.phone::text, 'طبيب بدون اسم'),
           coalesce(public.fn_doctor_payables(u.id), 0)
    from public.users u
    where u.role = 'doctor'
    order by 3 desc;
end;
$$;

revoke all on function public.get_doctors_payables() from public;
grant execute on function public.get_doctors_payables() to authenticated;

-- 4) دفع عمولات الأطباء دفعة واحدة (كشف + بنود + قيد مرحَّل) ------
create or replace function public.create_doctors_payouts_entries(
  p_doctor_ids uuid[] default null,
  p_payment_method text default 'cash'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_period_id uuid;
  v_doc_id uuid;
  v_entry_id uuid;
  v_doctor_id uuid;
  v_amount numeric(18,4);
  v_paid integer := 0;
  v_skipped integer := 0;
  v_total numeric(18,4) := 0;
  v_debit numeric(18,2);
  v_credit numeric(18,2);
  v_count integer;
  v_period_status text;
  v_cash_code text := '1110';
  v_bank_code text := '1120';
begin
  if public.current_user_role() <> 'company_director' then
    raise exception 'غير مصرح لك — مطلوب دور المدير العام';
  end if;

  select c.id into v_company_id
  from public.financial_companies c
  order by c.created_at limit 1;
  if v_company_id is null then raise exception 'No financial company configured'; end if;

  select p.id into v_period_id
  from public.financial_periods p
  where p.start_date <= current_date and p.end_date >= current_date
  order by p.start_date desc limit 1;
  if v_period_id is null then raise exception 'الفترة المالية الحالية غير مفعّلة'; end if;

  insert into public.payout_documents
    (company_id, payout_date, payment_method, total_amount, status, description, created_by)
  values
    (v_company_id, current_date, p_payment_method, 0, 'posted',
     'كشف دفع عمولات أطباء — ' || to_char(now(), 'YYYY-MM-DD HH24:MI'),
     auth.uid())
  returning id into v_doc_id;

  foreach v_doctor_id in array coalesce(p_doctor_ids, array[]::uuid[]) loop
    v_amount := public.fn_doctor_payables(v_doctor_id);
    if v_amount <= 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.payout_line_items (payout_document_id, doctor_user_id, amount)
    values (v_doc_id, v_doctor_id, v_amount);

    v_total := v_total + v_amount;
    v_paid := v_paid + 1;

    v_entry_id := public.fn_financial_auto_entry(
      current_date,
      'دفعة عمولة طبيب — ' || v_doctor_id::text,
      'payout', 'payout_line_items',
      (select id from public.payout_line_items
       where payout_document_id = v_doc_id and doctor_user_id = v_doctor_id
       order by created_at desc limit 1),
      jsonb_build_array(
        jsonb_build_object('account_code', '126000', 'debit', v_amount, 'credit', 0,
                           'description', 'سداد عمولة الطبيب ' || v_doctor_id::text),
        jsonb_build_object('account_code', case when p_payment_method = 'bank' then v_bank_code else v_cash_code end,
                           'debit', 0, 'credit', v_amount,
                           'description', case when p_payment_method = 'bank' then 'دفع من البنك' else 'دفع من الصندوق' end)
      ));

    select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_count, v_debit, v_credit
    from public.financial_journal_lines
    where journal_entry_id = v_entry_id;

    if v_count < 2 or v_debit <> v_credit then
      raise exception 'القيد الناتج غير متوازن لدفعة الطبيب %', v_doctor_id;
    end if;

    update public.financial_journal_entries
    set status = 'posted', posted_at = now(), posted_by = auth.uid()
    where id = v_entry_id;
  end loop;

  if v_paid = 0 then
    delete from public.payout_documents where id = v_doc_id;
    return 'لا توجد أرصدة مستحقة للدفع (عدد متماثل: ' || v_skipped || ').';
  end if;

  update public.payout_documents
  set total_amount = v_total
  where id = v_doc_id;

  return 'تم دفع ' || v_paid || ' طبيباً دفعة واحدة بمبلغ ' || v_total::text
         || ' ' || case when p_payment_method = 'bank' then 'بنكياً' else 'نقداً' end
         || coalesce(' (' || v_skipped || ' بدون أرصدة).', '.');
end;
$$;

revoke all on function public.create_doctors_payouts_entries(uuid[], text) from public;
grant execute on function public.create_doctors_payouts_entries(uuid[], text) to authenticated;

-- 5) نظرة سريعة على آخر كشوف الدفع ------------------------------
revoke all on table public.payout_documents from public;
revoke all on table public.payout_line_items from public;
grant select on public.payout_documents to authenticated;
grant select on public.payout_line_items to authenticated;