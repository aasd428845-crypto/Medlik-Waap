-- =============================================================
-- Migration 0014: عمليات مدير الفرع (التخصيص، الفواتير، المخزون بالصلاحيات)
-- مشروع ويب Medlik-Waap — لوحة المدير العام
-- نفِّذ هذا الملف من Supabase Dashboard → SQL Editor
-- لا تعدّل الملفات 0001–0013
--
-- ⚠️ المشروعان يتصلان بنفس قاعدة البيانات، وكودها موثَّق في كلا
-- المشروعين: الملف المقابل لهذا الملف في مشروع Flutter
-- stitch_medlink_yemen (تطبيق مدير الفرع) هو:
-- 0009_branch_manager_operations.sql
-- (نفس التغييرات — انسخهما معاً كي يبقى التوثيق متطابقاً مع القاعدة الحية).
--
-- ما يُضافه هذا الملف (تغييرات إضافية فقط — لا تعديل على الموجود):
--   1. orders.priority                     : أولوية الطلب
--      (urgent / priority / standard) — شاشة "الطلبات الواردة"
--      تُظهر بطاقة الطلب مع شارة الأولوية وشريط جانبي ملون.
--   2. orders.delivered_at                 : لحظة اكتمال التوصيل —
--      تُملأ تلقائياً عبر Trigger عند الوصول لحالة delivered؛
--      تُستخدم في "الإحصائيات والتقارير" (متوسط وقت التوصيل +
--      الرسم البياني اليومي للتسليمات الحقيقية).
--   3. warehouse_inventory.reorder_level   : حد إعادة الطلب لكل صنف —
--      أساس تنبيه "مخزون منخفض" (quantity <= reorder_level) في
--      شاشتي المخزون والإحصائيات (بدلاً من أرقام وهمية).
--   4. invoices.branch_id                  : ربط الفاتورة بالفرع + سياسات
--      إدراج/تحديث لمدير الفرع (إنشاء فاتورة من شاشة "سجل الفواتير").
--   5. branch_allocate_order()             : RPC ذري — يُنفَّذ في معاملة
--      واحدة: التحقق من توفر المخزون لكل صنف → الخصم → إسناد الطلب →
--      إصدار فاتورة للعميل (اختياري). أساس شاشة "التخصيص".
-- =============================================================

-- ─────────────────────────────────────────
-- 1. أولوية الطلب
-- ─────────────────────────────────────────
alter table public.orders
  add column if not exists priority text not null default 'standard'
  check (priority in ('urgent', 'priority', 'standard'));

-- ─────────────────────────────────────────
-- 2. لحظة اكتمال التوصيل (تلقائية)
-- ─────────────────────────────────────────
alter table public.orders add column if not exists delivered_at timestamptz;

create or replace function public.set_order_delivered_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'delivered' and new.delivered_at is null then
    new.delivered_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_set_delivered_at on public.orders;
create trigger trg_orders_set_delivered_at
  before insert or update of status on public.orders
  for each row execute function public.set_order_delivered_at();

-- ─────────────────────────────────────────
-- 3. حد إعادة الطلب (تنبيه انخفاض المخزون)
-- ─────────────────────────────────────────
alter table public.warehouse_inventory
  add column if not exists reorder_level int not null default 5
  check (reorder_level >= 0);

-- ─────────────────────────────────────────
-- 4. ربط الفاتورة بالفرع + سياسات مدير الفرع
--    (الفواتير أُنشئت هنا — migration 0004 —
--     وبقيت الإدراج حصراً للمدير العام؛ هنا نمنح مدير الفرع
--     إنشاء/تعديل فواتير فرعه فقط)
-- ─────────────────────────────────────────
alter table public.invoices
  add column if not exists branch_id uuid references public.branches(id) on delete set null;

create index if not exists invoices_branch_idx on public.invoices (branch_id);

drop policy if exists "invoices_branch_manager_insert" on public.invoices;
create policy "invoices_branch_manager_insert" on public.invoices
  for insert
  with check (
    public.current_user_role() = 'branch_manager'
    and branch_id = public.current_user_branch_id()
  );

drop policy if exists "invoices_branch_manager_update" on public.invoices;
create policy "invoices_branch_manager_update" on public.invoices
  for update
  using (
    public.current_user_role() = 'branch_manager'
    and branch_id = public.current_user_branch_id()
  )
  with check (
    public.current_user_role() = 'branch_manager'
    and branch_id = public.current_user_branch_id()
  );

-- ─────────────────────────────────────────
-- 5. RPC التخصيص الذري
--    المدخلات: الطلب، قائمة التخصيصات (product_id + allocated_qty)،
--    تاريخ التسليم المتوقع، هل نُصدر فاتورة.
--    المخرجات: id الفاتورة إن صدرت، وإلا null.
--    الحماية: مدير الفرع فقط، وفرعه فقط، وطلب بحالة pending فقط،
--    والمخزون يُتحقق منه ويُخصم داخل نفس المعاملة (لا خصم زائد).
-- ─────────────────────────────────────────
create or replace function public.branch_allocate_order(
  p_order_id              uuid,
  p_issue_invoice         boolean default true,
  p_expected_delivery_date date default null,
  p_allocations           jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id   uuid;
  v_client_id   uuid;
  v_status      text;
  v_total       numeric(12,2) := 0;
  v_invoice_id  uuid;
  v_alloc       record;
  v_inv_qty     int;
  v_unit_price  numeric(10,2);
begin
  -- 1) الصلاحية: مدير الفرع فقط
  if public.current_user_role() <> 'branch_manager' then
    raise exception 'Only a branch manager can allocate orders';
  end if;

  -- 2) الطلب موجود ولفرع المدير وبحالة pending فقط
  select branch_id, client_id, status
    into v_branch_id, v_client_id, v_status
    from public.orders
   where id = p_order_id;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;
  if v_branch_id is distinct from public.current_user_branch_id() then
    raise exception 'Order does not belong to your branch';
  end if;
  if v_status <> 'pending' then
    raise exception 'Only pending orders can be allocated (current: %)', v_status;
  end if;

  -- 3) تحقق وخصم لكل صنف داخل المعاملة
  for v_alloc in
    select * from jsonb_to_recordset(coalesce(p_allocations, '[]'::jsonb))
      as x(product_id uuid, allocated_qty int)
  loop
    if v_alloc.allocated_qty is null or v_alloc.allocated_qty <= 0 then
      continue;
    end if;

    select quantity into v_inv_qty
      from public.inventory
     where branch_id = v_branch_id and product_id = v_alloc.product_id;

    if v_inv_qty is null or v_inv_qty < v_alloc.allocated_qty then
      raise exception 'Insufficient stock for product % (need %, have %)',
        v_alloc.product_id, v_alloc.allocated_qty, coalesce(v_inv_qty, 0);
    end if;

    update public.inventory
       set quantity = quantity - v_alloc.allocated_qty,
           updated_at = now()
     where branch_id = v_branch_id and product_id = v_alloc.product_id;

    if p_issue_invoice then
      select unit_price into v_unit_price
        from public.order_items
       where order_id = p_order_id and product_id = v_alloc.product_id;
      v_total := v_total + coalesce(v_unit_price, 0) * v_alloc.allocated_qty;
    end if;
  end loop;

  -- 4) إسناد الطلب (جاهز لتخصيص سائق) + تاريخ التسليم المتوقع
  update public.orders
     set status = 'assigned',
         scheduled_delivery_at = p_expected_delivery_date
   where id = p_order_id;

  -- 5) إصدار فاتورة للعميل (اختياري)
  if p_issue_invoice then
    insert into public.invoices (client_id, branch_id, amount, status, due_date)
    values (v_client_id, v_branch_id, v_total, 'pending', p_expected_delivery_date)
    returning id into v_invoice_id;
  end if;

  return v_invoice_id;
end $$;

grant execute on function public.branch_allocate_order(uuid, boolean, date, jsonb)
  to authenticated;