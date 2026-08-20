-- =============================================================
-- Migration 0015: إعدادات مدير الفرع (حسابات الدفع، الإشعارات،
--                  تعديل بيانات الفرع، وتحويل المخزون بين الفروع)
-- مشروع ويب Medlik-Waap — لوحة المدير العام
-- نفِّذ هذا الملف من Supabase Dashboard → SQL Editor
-- لا تعدّل الملفات 0001–0014
--
-- ⚠️ المشروعان يتصلان بنفس قاعدة البيانات، وكودها موثَّق في كلا
-- المشروعين: الملف المقابل لهذا الملف في مشروع Flutter
-- stitch_medlink_yemen (تطبيق مدير الفرع) هو:
-- 0010_branch_manager_settings.sql
-- (نفس التغييرات — انسخهما معاً كي يبقى التوثيق متطابقاً مع القاعدة الحية).
--
-- ما يُضافه هذا الملف (تغييرات إضافية فقط — لا تعديل على الموجود):
--   1. notification_preferences        : تفضيلات إشعارات المستخدم —
--      أربعة مفاتيح (new_orders, low_stock, expiry_alerts,
--      driver_messages) تُقرأ/تُكتب من مودال "الإعدادات" في
--      شاشة مدير الفرع. RLS: صاحب الصف فقط.
--   2. branch_bank_accounts            : حسابات الدفع البنكية لكل فرع —
--      اسم البنك / صاحب الحساب / رقم الحساب + علامة الافتراضي.
--      أساس قسم "حسابات الدفع" في مودال الإعدادات.
--      RLS: مدير الفرع (فرعه فقط) + المدير العام (الكل).
--   3. branches_manager_update_own     : سياسة تحديث جديدة تسمح لمدير
--      الفرع بتعديل بيانات فرعه فقط (الاسم/المحافظة/العنوان) من
--      مودال الإعدادات. (سابقاً: المدير العام فقط.)
--   4. branch_transfer_stock_between_branches() : RPC ذري ينقل
--      كمية من مخزون فرع المدير إلى فرع آخر في معاملة واحدة:
--      تحقق من الصلاحية → تحقق من الوجهة → تحقق من الكمية المتوفرة →
--      خصم من المصدر + إضافة للوجهة. أساس خيارات التحويل الأربعة
--      في مودال "التخصيص" (تحويل كامل/جزئي وذكي).
-- =============================================================

-- ─────────────────────────────────────────
-- 1. تفضيلات الإشعارات
--    مفتاح: user_id (حساب واحد لكل مستخدم).
-- ─────────────────────────────────────────
create table if not exists public.notification_preferences (
  user_id         uuid        primary key references public.users(id) on delete cascade,
  new_orders      boolean     not null default true,
  low_stock       boolean     not null default true,
  expiry_alerts   boolean     not null default true,
  driver_messages boolean     not null default false,
  updated_at      timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

drop policy if exists "notification_preferences_own" on public.notification_preferences;
create policy "notification_preferences_own" on public.notification_preferences
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─────────────────────────────────────────
-- 2. حسابات الدفع البنكية للفرع
--    الافتراضي فريد لكل فرع عبر فهرس جزئي (فرع واحد = حساب افتراضي واحد).
-- ─────────────────────────────────────────
create table if not exists public.branch_bank_accounts (
  id             uuid        primary key default gen_random_uuid(),
  branch_id      uuid        not null references public.branches(id) on delete cascade,
  bank_name      text        not null,
  account_name   text        not null,
  account_number text        not null,
  is_default     boolean     not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists branch_bank_accounts_branch_idx
  on public.branch_bank_accounts (branch_id);

create unique index if not exists branch_bank_accounts_one_default_idx
  on public.branch_bank_accounts (branch_id) where is_default;

alter table public.branch_bank_accounts enable row level security;

drop policy if exists "branch_bank_accounts_branch_manager" on public.branch_bank_accounts;
create policy "branch_bank_accounts_branch_manager" on public.branch_bank_accounts
  for all
  using (
    public.current_user_role() = 'branch_manager'
    and branch_id = public.current_user_branch_id()
  )
  with check (
    public.current_user_role() = 'branch_manager'
    and branch_id = public.current_user_branch_id()
  );

drop policy if exists "branch_bank_accounts_director" on public.branch_bank_accounts;
create policy "branch_bank_accounts_director" on public.branch_bank_accounts
  for all
  using (public.current_user_role() = 'company_director')
  with check (public.current_user_role() = 'company_director');

-- تعيين الحساب الافتراضي (ذري: إلغاء القديم أولاً ثم تعيين الجديد
-- كي لا يصطدم الفهرس الجزئي الفريد branch_bank_accounts_one_default_idx).
create or replace function public.branch_set_default_bank_account(
  p_account_id uuid,
  p_branch_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('branch_manager', 'company_director') then
    raise exception 'Only a branch manager or the company director can manage accounts';
  end if;
  if public.current_user_role() = 'branch_manager'
     and p_branch_id is distinct from public.current_user_branch_id() then
    raise exception 'Account does not belong to your branch';
  end if;

  update public.branch_bank_accounts
     set is_default = false
   where branch_id = p_branch_id and is_default;

  update public.branch_bank_accounts
     set is_default = true
   where id = p_account_id and branch_id = p_branch_id;

  if not found then
    raise exception 'Account % not found in branch %', p_account_id, p_branch_id;
  end if;
end $$;

grant execute on function public.branch_set_default_bank_account(uuid, uuid)
  to authenticated;

-- ─────────────────────────────────────────
-- 3. تعديل بيانات الفرع بواسطة مديره
--    (لا تُلمس سياسات القراءة أو سياسة المدير العام).
-- ─────────────────────────────────────────
drop policy if exists "branches_manager_update_own" on public.branches;
create policy "branches_manager_update_own" on public.branches
  for update
  using (
    public.current_user_role() = 'branch_manager'
    and id = public.current_user_branch_id()
  )
  with check (
    public.current_user_role() = 'branch_manager'
    and id = public.current_user_branch_id()
  );

-- ─────────────────────────────────────────
-- 4. RPC تحويل المخزون بين الفروع (ذري)
--    المدخلات: المنتج، الفرع الوجهة، الكمية.
--    المصدر دائماً فرع المدير الحالي (لا يمكن التحويل من فرع غيره).
--    التحقق والخصم والإضافة كلها داخل معاملة واحدة (لا كمية زائدة).
-- ─────────────────────────────────────────
create or replace function public.branch_transfer_stock_between_branches(
  p_product_id   uuid,
  p_to_branch_id uuid,
  p_quantity     int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_branch uuid;
  v_have        int;
begin
  -- 1) الصلاحية: مدير الفرع فقط
  if public.current_user_role() <> 'branch_manager' then
    raise exception 'Only a branch manager can transfer stock';
  end if;

  -- 2) المصدر = فرع المدير الحالي
  v_from_branch := public.current_user_branch_id();
  if v_from_branch is null then
    raise exception 'Manager has no assigned branch';
  end if;

  -- 3) الوجهة: موجودة ومختلفة عن المصدر
  if p_to_branch_id is null or p_to_branch_id = v_from_branch then
    raise exception 'Target branch must differ from source branch';
  end if;
  if not exists (select 1 from public.branches where id = p_to_branch_id) then
    raise exception 'Target branch % not found', p_to_branch_id;
  end if;

  -- 4) الكمية: موجبة
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Transfer quantity must be positive';
  end if;

  -- 5) توفر المخزون في المصدر
  select quantity into v_have
    from public.inventory
   where branch_id = v_from_branch and product_id = p_product_id;

  if v_have is null or v_have < p_quantity then
    raise exception 'Insufficient stock in source branch (need %, have %)',
      p_quantity, coalesce(v_have, 0);
  end if;

  -- 6) خصم من المصدر + إضافة للوجهة (ذري)
  update public.inventory
     set quantity = quantity - p_quantity,
         updated_at = now()
   where branch_id = v_from_branch and product_id = p_product_id;

  insert into public.inventory (branch_id, product_id, quantity, updated_at)
  values (p_to_branch_id, p_product_id, p_quantity, now())
  on conflict (branch_id, product_id)
  do update set quantity = public.inventory.quantity + excluded.quantity,
                updated_at = now();
end $$;

grant execute on function public.branch_transfer_stock_between_branches(uuid, uuid, int)
  to authenticated;