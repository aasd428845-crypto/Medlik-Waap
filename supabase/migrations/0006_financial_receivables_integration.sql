-- =============================================================
-- Migration 0006 — Financial Integration / Receivables Foundation
-- Medlik-Waap
--
-- الهدف: ربط invoices/payments الموجودة بالنواة المالية دون إنشاء
-- نظام فواتير بديل. لا يتم ترحيل حركات تاريخية تلقائياً في هذه المرحلة.
-- =============================================================

-- 1) إعداد الحسابات المالية الافتراضية التي ستستخدمها دورة الذمم لاحقاً.
create table if not exists public.financial_account_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.financial_companies(id) on delete cascade,
  receivable_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  sales_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id)
);

alter table public.financial_account_mappings enable row level security;

create policy "financial_account_mappings_read" on public.financial_account_mappings
  for select using (public.current_user_role() in ('company_director','accountant'));

create policy "financial_account_mappings_write" on public.financial_account_mappings
  for all using (public.current_user_role() = 'company_director')
  with check (public.current_user_role() = 'company_director');

-- 2) ربط الفواتير والمقبوضات بمستند مالي مصدر، مع عدم فرض قيمة على السجلات القديمة.
alter table public.invoices
  add column if not exists financial_document_id uuid
    references public.financial_documents(id) on delete set null;

alter table public.payments
  add column if not exists financial_document_id uuid
    references public.financial_documents(id) on delete set null;

create index if not exists invoices_financial_document_idx
  on public.invoices(financial_document_id);

create index if not exists payments_financial_document_idx
  on public.payments(financial_document_id);

-- 3) سجل تطبيق الدورات المحاسبية على المستندات التشغيلية.
-- يمنع تكرار الترحيل لنفس المصدر.
create table if not exists public.financial_posting_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.financial_companies(id) on delete cascade,
  source_table text not null,
  source_id uuid not null,
  journal_entry_id uuid not null references public.financial_journal_entries(id) on delete restrict,
  posting_type text not null check (posting_type in ('invoice','payment','refund','adjustment')),
  created_at timestamptz not null default now(),
  unique(source_table, source_id, posting_type)
);

create index if not exists financial_posting_links_journal_idx
  on public.financial_posting_links(journal_entry_id);

alter table public.financial_posting_links enable row level security;

create policy "financial_posting_links_read" on public.financial_posting_links
  for select using (public.current_user_role() in ('company_director','accountant'));

-- 4) لا نعتبر status='paid' دليلاً محاسبياً. هذه الدالة تفصل بين حالة الفاتورة
-- وبين إثبات الحركة المالية، وتستخدم فقط بعد إعداد mapping وصندوق/بنك في المرحلة التالية.
create or replace function public.get_invoice_outstanding_amount(p_invoice_id uuid)
returns numeric(18,2)
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    i.amount - coalesce(sum(p.amount), 0),
    0
  )::numeric(18,2)
  from public.invoices i
  left join public.payments p on p.invoice_id = i.id
  where i.id = p_invoice_id
  group by i.id, i.amount;
$$;

revoke all on function public.get_invoice_outstanding_amount(uuid) from public;
grant execute on function public.get_invoice_outstanding_amount(uuid) to authenticated;

-- 5) قيد أساسي لحماية payment من تجاوز قيمة الفاتورة.
create or replace function public.validate_payment_amount()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outstanding numeric(18,2);
begin
  if new.invoice_id is null then
    return new;
  end if;

  select public.get_invoice_outstanding_amount(new.invoice_id)
    into v_outstanding;

  if new.amount > v_outstanding then
    raise exception 'Payment amount exceeds invoice outstanding amount: payment=% outstanding=%',
      new.amount, v_outstanding;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_payment_amount on public.payments;
create trigger trg_validate_payment_amount
  before insert on public.payments
  for each row execute function public.validate_payment_amount();

-- 6) الفاتورة لا تتحول إلى paid إلا إذا أصبح مجموع الدفعات >= قيمة الفاتورة.
-- هذا يصحح سلوك المرحلة السابقة الذي كان يضع paid عند أول دفعة حتى لو كانت جزئية.
create or replace function public.decrease_balance_on_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid numeric(18,2);
  v_amount numeric(18,2);
begin
  update public.users
     set current_balance = greatest(current_balance - new.amount, 0)
   where id = new.client_id;

  if new.invoice_id is not null then
    select amount into v_amount from public.invoices where id = new.invoice_id;
    select coalesce(sum(amount), 0) into v_paid from public.payments where invoice_id = new.invoice_id;

    update public.invoices
       set status = case when v_paid >= v_amount then 'paid' else 'pending' end,
           paid_at = case when v_paid >= v_amount then now() else null end
     where id = new.invoice_id;
  end if;

  return new;
end;
$$;

-- 7) توثيق ربط الفاتورة بالمصدر المالي يجب أن يتم قبل الترحيل المحاسبي الفعلي.
-- الترحيل التلقائي الكامل سيأتي بعد بناء سند القبض/اختيار البنك أو الصندوق
-- وربط حسابات الإيراد والذمم في واجهة الإدارة المالية.
