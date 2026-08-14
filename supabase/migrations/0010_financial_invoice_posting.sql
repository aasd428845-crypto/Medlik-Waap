-- =============================================================
-- Migration 0010 — ترحيل فواتير العملاء إلى دفتر الأستاذ
-- =============================================================

create or replace function public.post_financial_invoice(p_invoice_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_mapping public.financial_account_mappings%rowtype;
  v_period_id uuid;
  v_document_id uuid;
  v_journal_id uuid;
  v_existing uuid;
  v_entry_date date;
  v_branch_id uuid;
begin
  select * into v_invoice
    from public.invoices
   where id = p_invoice_id
   for update;

  if not found then raise exception 'Invoice not found'; end if;
  if v_invoice.status = 'cancelled' then raise exception 'Cancelled invoice cannot be posted'; end if;
  if v_invoice.amount <= 0 then raise exception 'Invoice amount must be greater than zero'; end if;

  select journal_entry_id into v_existing
    from public.financial_posting_links
   where source_table = 'invoices'
     and source_id = v_invoice.id
     and posting_type = 'invoice'
   limit 1;

  if v_existing is not null then return v_existing; end if;

  select * into v_mapping
    from public.financial_account_mappings
   where company_id = (select id from public.financial_companies order by created_at limit 1);

  if v_mapping.id is null then raise exception 'Financial account mapping is missing'; end if;

  v_entry_date := v_invoice.created_at::date;

  select p.id into v_period_id
    from public.financial_periods p
    join public.financial_fiscal_years fy on fy.id = p.fiscal_year_id
   where fy.company_id = v_mapping.company_id
     and v_entry_date between p.start_date and p.end_date
     and p.status = 'open'
   limit 1;

  if v_period_id is null then raise exception 'No open accounting period for invoice date'; end if;

  -- branch_id إن وجد للمستخدم العميل يستخدم كبعد تحليلي فقط.
  select u.branch_id into v_branch_id from public.users u where u.id = v_invoice.client_id;

  insert into public.financial_documents (
    company_id, document_type, source_table, source_id, document_number, description, created_by
  ) values (
    v_mapping.company_id, 'customer_invoice', 'invoices', v_invoice.id,
    v_invoice.id::text, 'Customer invoice', auth.uid()
  ) returning id into v_document_id;

  insert into public.financial_journal_entries (
    company_id, entry_date, fiscal_period_id, description, source_document_id, created_by
  ) values (
    v_mapping.company_id, v_entry_date, v_period_id,
    'Customer invoice #' || v_invoice.id::text, v_document_id, auth.uid()
  ) returning id into v_journal_id;

  insert into public.financial_journal_lines (
    journal_entry_id, line_number, account_id, branch_id, description,
    debit, credit, currency_code
  ) values (
    v_journal_id, 1, v_mapping.receivable_account_id, v_branch_id,
    'Customer receivable', v_invoice.amount, 0, 'YER'
  );

  insert into public.financial_journal_lines (
    journal_entry_id, line_number, account_id, branch_id, description,
    debit, credit, currency_code
  ) values (
    v_journal_id, 2, v_mapping.sales_account_id, v_branch_id,
    'Sales revenue', 0, v_invoice.amount, 'YER'
  );

  perform public.post_financial_journal_entry(v_journal_id);

  update public.invoices
     set financial_document_id = v_document_id
   where id = v_invoice.id;

  insert into public.financial_posting_links (
    company_id, source_table, source_id, journal_entry_id, posting_type
  ) values (
    v_mapping.company_id, 'invoices', v_invoice.id, v_journal_id, 'invoice'
  );

  return v_journal_id;
end;
$$;

revoke all on function public.post_financial_invoice(uuid) from public;

-- =============================================================
-- لا يتم تشغيل الترحيل تلقائياً على الفواتير التاريخية.
-- =============================================================
