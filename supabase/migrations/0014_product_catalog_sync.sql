-- =============================================================
-- Migration 0014 — مزامنة كتالوج الويب مع تطبيق Flutter
--
-- يضيف الحقول التي تحتاجها لوحة المدير العام مع إبقاء الحقول
-- الأصلية (name/category/unit_price) متوافقة مع التطبيق المشترك.
-- كما ينشئ إشعارات المنتج الجديد وصفوف مخزون صفرية تلقائياً.
-- نفّذه من Supabase Dashboard → SQL Editor بعد migrations 0001–0013.
-- =============================================================

-- 1) حقول الكتالوج الموسعة --------------------------------------
alter table public.products
  add column if not exists sku text,
  add column if not exists commercial_name text,
  add column if not exists scientific_name text,
  add column if not exists strength text,
  add column if not exists pack_size integer not null default 1,
  add column if not exists price numeric(10,2),
  add column if not exists is_cold_chain boolean not null default false,
  add column if not exists is_controlled_substance boolean not null default false;

-- تعبئة الحقول الجديدة للمنتجات القديمة دون تغيير بيانات Flutter.
update public.products
set commercial_name = coalesce(nullif(commercial_name, ''), name),
    price = coalesce(price, unit_price),
    dosage_form = coalesce(nullif(dosage_form, ''), category),
    pack_size = coalesce(pack_size, 1)
where commercial_name is null
   or commercial_name = ''
   or price is null
   or dosage_form is null
   or pack_size is null;

alter table public.products
  alter column price set default 0,
  alter column price set not null;

-- NULL مسموح للمنتجات القديمة التي لم يكن لها SKU؛ أما كل SKU
-- جديد فيبقى فريداً كي يعمل upsert الآمن من Excel/CSV.
alter table public.products
  drop constraint if exists products_sku_key;
alter table public.products
  add constraint products_sku_key unique (sku);

-- 2) تفعيل/تعطيل الفروع ----------------------------------------
alter table public.branches
  add column if not exists is_active boolean not null default true;

-- 3) إنشاء صفوف المخزون والإشعارات عند إضافة منتج --------------
create or replace function public.sync_new_product_to_branches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- الجدول التجميعي الذي يعتمد عليه تطبيق Flutter.
  insert into public.inventory (branch_id, product_id, quantity, updated_at)
  select b.id, new.id, 0, now()
  from public.branches b
  where b.is_active
    and not exists (
      select 1
      from public.inventory i
      where i.branch_id = b.id and i.product_id = new.id
    );

  -- صف دفعة صفرية كي يظهر المنتج كنافد المخزون في شاشة المستودع.
  insert into public.warehouse_inventory (branch_id, product_id, quantity, unit_price)
  select b.id, new.id, 0, new.unit_price
  from public.branches b
  where b.is_active
    and not exists (
      select 1
      from public.warehouse_inventory wi
      where wi.branch_id = b.id and wi.product_id = new.id
    );

  insert into public.notifications (title, body, target_role, created_by)
  values
    (
      '💊 منتج جديد بالكتالوج',
      format('تمت إضافة المنتج «%s» إلى الكتالوج ويمكن للعملاء رؤيته.', coalesce(new.commercial_name, new.name)),
      'client',
      auth.uid()
    ),
    (
      '⚠️ منتج جديد يتطلب تحديد المخزون',
      format('تمت إضافة المنتج «%s»؛ يرجى تحديد مخزونه في الفروع.', coalesce(new.commercial_name, new.name)),
      'branch_manager',
      auth.uid()
    );

  return new;
end;
$$;

drop trigger if exists trg_sync_new_product_to_branches on public.products;
create trigger trg_sync_new_product_to_branches
  after insert on public.products
  for each row execute function public.sync_new_product_to_branches();

-- إصلاح المنتجات القديمة التي أضيفت قبل هذا الـtrigger.
insert into public.inventory (branch_id, product_id, quantity, updated_at)
select b.id, p.id, 0, now()
from public.branches b
cross join public.products p
where b.is_active
  and not exists (
    select 1
    from public.inventory i
    where i.branch_id = b.id and i.product_id = p.id
  );

insert into public.warehouse_inventory (branch_id, product_id, quantity, unit_price)
select b.id, p.id, 0, p.unit_price
from public.branches b
cross join public.products p
where b.is_active
  and not exists (
    select 1
    from public.warehouse_inventory wi
    where wi.branch_id = b.id and wi.product_id = p.id
  );