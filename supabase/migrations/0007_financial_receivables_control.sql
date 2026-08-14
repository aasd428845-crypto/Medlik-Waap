-- 0007 — الذمم المدينة والتحصيل المنضبط
-- يفصل إثبات التحصيل عن مجرد تغيير حالة الفاتورة، ويدعم الدفعات الجزئية.

create table if not exists public.financial_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number bigint generated always as identity,
  client_id uuid not null references public.users(id) on delete restrict,
  invoice_id uuid references public.invoices(id) on delete restrict,
  amount numeric(18,2) not null check(amount > 0),
  currency_code text not null default 'YER' references public.financial_currencies(code),
  cash_account_id uuid references public.financial_cash_accounts(id) on delete restrict,
  bank_account_id uuid references public.financial_bank_accounts(id) on delete restrict,
  receipt_date date not null default current_date,
  status text not null default 'draft' check(status in('draft','posted','voided')),
  journal_entry_id uuid references public.financial_journal_entries(id) on delete restrict,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check(((cash_account_id is not null)::int + (bank_account_id is not null)::int)=1)
);

create index if not exists financial_receipts_client_idx on public.financial_receipts(client_id,receipt_date);
create index if not exists financial_receipts_invoice_idx on public.financial_receipts(invoice_id);

-- منع تجاوز إجمالي الفاتورة عند إدخال دفعة جديدة.
create or replace function public.validate_payment_amount()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_invoice_amount numeric(18,2); v_paid numeric(18,2);
begin
 if new.invoice_id is null then return new; end if;
 select amount into v_invoice_amount from public.invoices where id=new.invoice_id for update;
 if v_invoice_amount is null then raise exception 'Invoice not found'; end if;
 select coalesce(sum(amount),0) into v_paid from public.payments where invoice_id=new.invoice_id;
 if v_paid + new.amount > v_invoice_amount then raise exception 'Payment exceeds invoice remaining balance'; end if;
 return new;
end $$;

drop trigger if exists trg_validate_payment_amount on public.payments;
create trigger trg_validate_payment_amount before insert on public.payments for each row execute function public.validate_payment_amount();

-- تصحيح السلوك القديم: حالة الفاتورة لا تصبح paid إلا عند اكتمال مجموع الدفعات.
create or replace function public.decrease_balance_on_payment()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_total_paid numeric(18,2); v_invoice_amount numeric(18,2);
begin
 update public.users set current_balance=greatest(current_balance-new.amount,0) where id=new.client_id;
 if new.invoice_id is not null then
   select amount into v_invoice_amount from public.invoices where id=new.invoice_id;
   select coalesce(sum(amount),0) into v_total_paid from public.payments where invoice_id=new.invoice_id;
   update public.invoices set status=case when v_total_paid >= v_invoice_amount then 'paid' else 'pending' end,
       paid_at=case when v_total_paid >= v_invoice_amount then now() else null end
   where id=new.invoice_id;
 end if;
 return new;
end $$;

-- سجل تطبيق الدفعات على الفواتير للتحليل والمطابقة.
create table if not exists public.financial_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  allocated_amount numeric(18,2) not null check(allocated_amount>0),
  created_at timestamptz not null default now(),
  unique(payment_id,invoice_id)
);

alter table public.financial_receipts enable row level security;
alter table public.financial_payment_allocations enable row level security;
create policy "financial_receipts_read" on public.financial_receipts for select using(public.current_user_role() in('company_director','accountant'));
create policy "financial_receipts_write" on public.financial_receipts for all using(public.current_user_role() in('company_director','accountant')) with check(public.current_user_role() in('company_director','accountant'));
create policy "financial_allocations_read" on public.financial_payment_allocations for select using(public.current_user_role() in('company_director','accountant'));
create policy "financial_allocations_write" on public.financial_payment_allocations for all using(public.current_user_role() in('company_director','accountant')) with check(public.current_user_role() in('company_director','accountant'));
