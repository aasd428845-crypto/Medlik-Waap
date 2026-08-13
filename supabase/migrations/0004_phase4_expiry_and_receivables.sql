-- =============================================================
-- Migration 0004 — المرحلة 4: تنبيهات انتهاء الصلاحية + الذمم المدينة
-- مشروع ويب Medlik-Waap (لوحة تحكم المدير العام)
--
-- ✅ التحقق الحي (PostgREST) قبل هذا الملف:
--   - warehouse_inventory  : غير موجود — الجدول الوحيد هو inventory
--                             بدون expiry_date → أُنشئ هنا بجدول جديد
--                             يدعم دفعات متعددة بصلاحيات مختلفة.
--   - credit_limit/current_balance : غير موجودة في users أو
--                             client_profiles (الجدول غير موجود) → أُضيفت.
--   - invoices / payments   : غير موجودين → أُنشئا مع Trigger.
--
-- ✅ الإجابة على سؤال التقرير:
--   Trigger تحديث current_balance لم يكن موجوداً مسبقاً (ولا حتى
--   جدولا invoices/payments أو عمودا الائتمان) — أُنشئ بالكامل هنا.
-- نفِّذه من Supabase Dashboard → SQL Editor
-- =============================================================

-- ─────────────────────────────────────────
-- 1. جدول مخزون المستودع (بالصلاحيات — دفعات)
-- ─────────────────────────────────────────
create table if not exists public.warehouse_inventory (
  id          uuid        primary key default gen_random_uuid(),
  branch_id   uuid        not null references public.branches(id)  on delete cascade,
  product_id  uuid        not null references public.products(id)  on delete cascade,
  quantity    int         not null default 0 check (quantity >= 0),
  expiry_date date,
  unit_price  numeric(10,2),          -- سعر الوحدة عند الاستلام (يُفضَّل على سعر الكتالوج)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists warehouse_inventory_expiry_idx
  on public.warehouse_inventory (expiry_date);

alter table public.warehouse_inventory enable row level security;

drop policy if exists "warehouse_inventory_select_authenticated" on public.warehouse_inventory;
create policy "warehouse_inventory_select_authenticated" on public.warehouse_inventory
  for select using (auth.role() = 'authenticated');

drop policy if exists "warehouse_inventory_write" on public.warehouse_inventory;
create policy "warehouse_inventory_write" on public.warehouse_inventory
  for all using (
    public.current_user_role() in ('branch_manager', 'company_director')
    and (public.current_user_role() = 'company_director' or branch_id = public.current_user_branch_id())
  )
  with check (
    public.current_user_role() in ('branch_manager', 'company_director')
    and (public.current_user_role() = 'company_director' or branch_id = public.current_user_branch_id())
  );

-- ─────────────────────────────────────────
-- 2. أعمدة الائتمان في users (للعملاء)
-- ─────────────────────────────────────────
alter table public.users
  add column if not exists credit_limit    numeric(12,2) not null default 0;

alter table public.users
  add column if not exists current_balance numeric(12,2) not null default 0;

-- ─────────────────────────────────────────
-- 3. الفواتير والمدفوعات
-- ─────────────────────────────────────────
create table if not exists public.invoices (
  id         uuid         primary key default gen_random_uuid(),
  client_id  uuid         not null references public.users(id) on delete cascade,
  amount     numeric(12,2) not null check (amount >= 0),
  status     text         not null default 'pending'
             check (status in ('pending', 'paid', 'cancelled')),
  due_date   date,
  paid_at    timestamptz,
  created_at timestamptz  not null default now()
);

create index if not exists invoices_client_idx on public.invoices (client_id);

alter table public.invoices enable row level security;

drop policy if exists "invoices_select_authenticated" on public.invoices;
create policy "invoices_select_authenticated" on public.invoices
  for select using (auth.role() = 'authenticated');

drop policy if exists "invoices_director_insert" on public.invoices;
create policy "invoices_director_insert" on public.invoices
  for insert with check (public.current_user_role() = 'company_director');

create table if not exists public.payments (
  id         uuid         primary key default gen_random_uuid(),
  invoice_id uuid         references public.invoices(id) on delete cascade,
  client_id  uuid         not null references public.users(id) on delete cascade,
  amount     numeric(12,2) not null check (amount >= 0),
  created_at timestamptz  not null default now()
);

alter table public.payments enable row level security;

drop policy if exists "payments_select_authenticated" on public.payments;
create policy "payments_select_authenticated" on public.payments
  for select using (auth.role() = 'authenticated');

drop policy if exists "payments_director_insert" on public.payments;
create policy "payments_director_insert" on public.payments
  for insert with check (public.current_user_role() = 'company_director');

-- ─────────────────────────────────────────
-- 4. Trigger: تحديث current_balance تلقائياً
--    (لم يكن موجوداً مسبقاً — أُنشئ بالكامل هنا)
-- ─────────────────────────────────────────

-- 4.1 إصدار فاتورة → زيادة الرصيد المستحق بمقدار الفاتورة
create or replace function public.increase_balance_on_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
     set current_balance = current_balance + new.amount
   where id = new.client_id;
  return new;
end $$;

drop trigger if exists trg_invoice_increase_balance on public.invoices;
create trigger trg_invoice_increase_balance
  after insert on public.invoices
  for each row execute function public.increase_balance_on_invoice();

-- 4.2 تسجيل دفعة → تنقيص الرصيد + تمييز الفاتورة مسدَّدة (إن اكتملت)
create or replace function public.decrease_balance_on_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
     set current_balance = greatest(current_balance - new.amount, 0)
   where id = new.client_id;

  if new.invoice_id is not null then
    update public.invoices
       set status = 'paid', paid_at = now()
     where id = new.invoice_id
       and status = 'pending';
  end if;

  return new;
end $$;

drop trigger if exists trg_payment_decrease_balance on public.payments;
create trigger trg_payment_decrease_balance
  after insert on public.payments
  for each row execute function public.decrease_balance_on_payment();

-- ─────────────────────────────────────────
-- ملاحظات:
-- - حالة "متأخر" تُشتق في الواجهة من (status='pending' AND due_date < اليوم)
--   بدلاً من وظيفة مجدولة.
-- - إعادة فتح فاتورة/تعديل سداد لا يُدعم في هذه المرحلة (وثّقها كقيد).
-- =============================================================
