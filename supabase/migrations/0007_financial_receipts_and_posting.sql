-- =============================================================
-- Migration 0007 — سندات القبض والترحيل المالي
-- Medlik-Waap
--
-- الهدف:
-- تحويل عملية التحصيل من مجرد payment تشغيلي إلى سند قبض مالي
-- واضح المصدر، مرتبط بصندوق/بنك، وقابل للترحيل إلى دفتر الأستاذ.
-- لا يتم ترحيل السجلات التاريخية تلقائياً.
-- =============================================================

create table if not exists public.financial_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.financial_companies(id) on delete restrict,
  receipt_number bigint generated always as identity,
  client_id uuid not null references public.users(id) on delete restrict,
  receipt_date date not null default current_date,
  amount numeric(18,2) not null check (amount > 0),
  currency_code text not null default 'YER' references public.financial_currencies(code),
  cash_account_id uuid references public.financial_cash_accounts(id) on delete restrict,
  bank_account_id uuid references public.financial_bank_accounts(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete restrict,
  financial_document_id uuid references public.financial_documents(id) on delete set null,
  journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','posted','voided')),
  reference_number text,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  posted_by uuid references public.users(id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references public.users(id) on delete set null,
  void_reason text,
  check ((cash_account_id is not null) <> (bank_account_id is not null))
);

create table if not exists public.financial_receipt_allocations (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.financial_receipts(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  allocated_amount numeric(18,2) not null check (allocated_amount > 0),
  created_at timestamptz not null default now(),
  unique(receipt_id, invoice_id)
);

create index if not exists financial_receipts_client_idx
  on public.financial_receipts(client_id, receipt_date);
create index if not exists financial_receipts_status_idx
  on public.financial_receipts(company_id, status);
create index if not exists financial_receipt_allocations_invoice_idx
  on public.financial_receipt_allocations(invoice_id);

alter table public.financial_receipts enable row level security;
alter table public.financial_receipt_allocations enable row level security;

create policy "financial_receipts_read" on public.financial_receipts
  for select using (public.current_user_role() in ('company_director','accountant'));
create policy "financial_receipts_insert" on public.financial_receipts
  for insert with check (public.current_user_role() in ('company_director','accountant'));
create policy "financial_receipt_allocations_read" on public.financial_receipt_allocations
  for select using (public.current_user_role() in ('company_director','accountant'));
create policy "financial_receipt_allocations_insert" on public.financial_receipt_allocations
  for insert with check (public.current_user_role() in ('company_director','accountant'));

-- ترحيل سند قبض واحد بصورة ذرية.
-- المبدأ المحاسبي:
--   مدين: الصندوق/البنك
--   دائن: الذمم المدينة
-- ولا يُنشأ payment أو posting_link إلا بعد نجاح التحقق من التخصيص.
create or replace function public.post_financial_receipt(p_receipt_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt public.financial_receipts%rowtype;
  v_mapping public.financial_account_mappings%rowtype;
  v_gl_account uuid;
  v_total_allocated numeric(18,2);
  v_invoice_amount numeric(18,2);
  v_paid numeric(18,2);
  v_outstanding numeric(18,2);
  v_period_id uuid;
  v_document_id uuid;
  v_journal_id uuid;
  v_payment_id uuid;
  v_branch_id uuid;
  v_cash_gl uuid;
  v_bank_gl uuid;
begin
  select * into v_receipt
    from public.financial_receipts
   where id = p_receipt_id
   for update;

  if not found then
    raise exception 'Financial receipt not found';
  end if;
  if v_receipt.status <> 'draft' then
    raise exception 'Only draft receipts can be posted';
  end if;

  if v_receipt.cash_account_id is not null then
    select gl_account_id, branch_id into v_cash_gl, v_branch_id
      from public.financial_cash_accounts
     where id = v_receipt.cash_account_id
       and company_id = v_receipt.company_id
       and is_active = true;
    v_gl_account := v_cash_gl;
  else
    select gl_account_id, branch_id into v_bank_gl, v_branch_id
      from public.financial_bank_accounts
     where id = v_receipt.bank_account_id
       and company_id = v_receipt.company_id
       and is_active = true;
    v_gl_account := v_bank_gl;
  end if;

  if v_gl_account is null then
    raise exception 'Receipt cash/bank account is not configured with a GL account';
  end if;

  select receivable_account_id into v_mapping.receivable_account_id
    from public.financial_account_mappings
   where company_id = v_receipt.company_id;

  if v_mapping.receivable_account_id is null then
    raise exception 'Receivable GL mapping is missing for company';
  end if;

  select coalesce(sum(allocated_amount),0)
    into v_total_allocated
    from public.financial_receipt_allocations
   where receipt_id = p_receipt_id;

  if v_total_allocated <> v_receipt.amount then
    raise exception 'Receipt allocations must equal receipt amount: allocated=% receipt=%',
      v_total_allocated, v_receipt.amount;
  end if;

  -- كل فاتورة يجب أن تخص نفس العميل وأن يكون التخصيص ضمن المتبقي.
  for v_invoice_amount in
    select allocated_amount
      from public.financial_receipt_allocations
     where receipt_id = p_receipt_id
  loop
    null;
  end loop;

  if exists (
    select 1
      from public.financial_receipt_allocations a
      join public.invoices i on i.id = a.invoice_id
     where a.receipt_id = p_receipt_id
       and i.client_id <> v_receipt.client_id
  ) then
    raise exception 'Receipt cannot allocate an invoice belonging to another client';
  end if;

  if exists (
    select 1
      from public.financial_receipt_allocations a
     where a.receipt_id = p_receipt_id
       and a.allocated_amount > public.get_invoice_outstanding_amount(a.invoice_id)
  ) then
    raise exception 'Receipt allocation exceeds invoice outstanding amount';
  end if;

  select p.id into v_payment_id
    from public.payments p
   where p.id = v_receipt.payment_id;

  -- إنشاء مستند مصدر للقبض.
  insert into public.financial_documents (
    company_id, document_type, source_table, source_id, document_number,
    description, created_by
  ) values (
    v_receipt.company_id, 'customer_receipt', 'financial_receipts', v_receipt.id,
    v_receipt.receipt_number::text, coalesce(v_receipt.notes, 'Customer receipt'), auth.uid()
  ) returning id into v_document_id;

  -- اختيار الفترة حسب تاريخ السند.
  select p.id into v_period_id
    from public.financial_periods p
    join public.financial_fiscal_years fy on fy.id = p.fiscal_year_id
   where fy.company_id = v_receipt.company_id
     and v_receipt.receipt_date between p.start_date and p.end_date
     and p.status = 'open'
   order by p.start_date
   limit 1;

  if v_period_id is null then
    raise exception 'No open accounting period for receipt date';
  end if;

  insert into public.financial_journal_entries (
    company_id, entry_date, fiscal_period_id, description,
    source_document_id, created_by
  ) values (
    v_receipt.company_id, v_receipt.receipt_date, v_period_id,
    coalesce(v_receipt.notes, 'Customer receipt #' || v_receipt.receipt_number),
    v_document_id, auth.uid()
  ) returning id into v_journal_id;

  insert into public.financial_journal_lines (
    journal_entry_id, line_number, account_id, branch_id, description,
    debit, credit, currency_code
  ) values (
    v_journal_id, 1, v_gl_account, v_branch_id,
    'Customer receipt - cash/bank', v_receipt.amount, 0, v_receipt.currency_code
  );

  insert into public.financial_journal_lines (
    journal_entry_id, line_number, account_id, branch_id, description,
    debit, credit, currency_code
  ) values (
    v_journal_id, 2, v_mapping.receivable_account_id, v_branch_id,
    'Customer receivable settlement', 0, v_receipt.amount, v_receipt.currency_code
  );

  perform public.post_financial_journal_entry(v_journal_id);

  -- إنشاء payment التشغيلي بعد نجاح القيد فقط. Trigger الموجود في 0004/0006
  -- يحافظ على current_balance وحالة الفاتورة.
  insert into public.payments (
    invoice_id, client_id, amount, financial_document_id
  )
  select a.invoice_id, v_receipt.client_id, a.allocated_amount, v_document_id
    from public.financial_receipt_allocations a
   where a.receipt_id = p_receipt_id
   order by a.invoice_id;

  update public.financial_receipts
     set financial_document_id = v_document_id,
         journal_entry_id = v_journal_id,
         status = 'posted',
         posted_at = now(),
         posted_by = auth.uid()
   where id = p_receipt_id;

  insert into public.financial_posting_links (
    company_id, source_table, source_id, journal_entry_id, posting_type
  ) values (
    v_receipt.company_id, 'financial_receipts', v_receipt.id,
    v_journal_id, 'payment'
  );

  return v_journal_id;
end;
$$;

revoke all on function public.post_financial_receipt(uuid) from public;

after alter table public.financial_receipts
  add constraint financial_receipts_payment_fk
  foreign key (payment_id) references public.payments(id) on delete restrict;

-- =============================================================
-- ملاحظة: الدالة تحتاج أن يكون account mapping والصندوق/البنك والحسابات
-- المحاسبية مهيأة قبل الترحيل. لا يتم اختراع حسابات افتراضية أثناء القبض.
-- =============================================================
