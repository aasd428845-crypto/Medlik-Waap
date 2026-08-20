-- =============================================================
-- Migration 0016: دفعة مخزون جديدة لمدير الفرع (شاشة المخزون — قسم 4)
-- مشروع ويب Medlik-Waap — لوحة المدير العام
-- نفِّذ هذا الملف من Supabase Dashboard → SQL Editor
-- لا تعدّل الملفات 0001–0015
--
-- ⚠️ المشروعان يتصلان بنفس قاعدة البيانات، وكودها موثَّق في كلا
-- المشروعين: الملف المقابل لهذا الملف في مشروع Flutter
-- stitch_medlink_yemen (تطبيق مدير الفرع) هو:
-- 0011_branch_inventory_batch.sql
--
-- ما يُضافه هذا الملف (إضافي فقط — لا تعديل على الموجود):
--   branch_add_stock_batch() : RPC ذري يضيف دفعة جديدة من منتج لفرع
--     المدير مع تاريخ انتهاء صلاحية وسعر وحدة: يُسجِّل الدفعة في
--     warehouse_inventory (دفعات متعددة بصلاحيات مختلفة) ويزيد إجمالي
--     الكمية في inventory (العبرة التي تستخدمها بقية شاشات التطبيق).
--     أساس زر "دفعة جديدة" في شاشة المخزون (قسم 4 من التصميم المعتمد).
-- =============================================================

create or replace function public.branch_add_stock_batch(
  p_branch_id   uuid,
  p_product_id  uuid,
  p_quantity    int,
  p_expiry_date date,
  p_unit_price  numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 1) الصلاحية: مدير الفرع فقط، ولفرعه فقط
  if public.current_user_role() <> 'branch_manager' then
    raise exception 'Only a branch manager can add stock';
  end if;
  if p_branch_id is distinct from public.current_user_branch_id() then
    raise exception 'You can only add stock to your own branch';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Batch quantity must be positive';
  end if;

  -- 2) تسجيل الدفعة (تاريخ انتهاء + سعر وحدة) في warehouse_inventory
  insert into public.warehouse_inventory
    (branch_id, product_id, quantity, expiry_date, unit_price)
  values
    (p_branch_id, p_product_id, p_quantity, p_expiry_date, p_unit_price);

  -- 3) زيادة إجمالي الكمية في inventory (العبرة الموحدة للتطبيق)
  insert into public.inventory (branch_id, product_id, quantity, updated_at)
  values (p_branch_id, p_product_id, p_quantity, now())
  on conflict (branch_id, product_id)
  do update set quantity = public.inventory.quantity + excluded.quantity,
                updated_at = now();
end $$;

grant execute on function public.branch_add_stock_batch(uuid, uuid, int, date, numeric)
  to authenticated;