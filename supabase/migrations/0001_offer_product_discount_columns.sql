-- =============================================================
-- Migration 0001 — مشروع ويب Medlik-Waap (لوحة تحكم المدير العام)
-- أعمدة العروض الترويجية: ربط الصنف + نسبة الخصم / السعر الخاص
-- + سياسات RLS تتيح للمدير العام إدارة العروض وقواعد البونص
--
-- البنية الأصلية (من ملفات مشروع Flutter 0002) لا تحتوي أعمدة
-- product_id / discount_percent / special_price في promotional_offers.
-- هذا الملف يضيفها لإدارة العروض من الويب، ويضمن وصول المدير العام
-- للقراءة/الإدراج/التحديث/الحذف على جدولي العروض والبونص.
-- نفِّذه من Supabase Dashboard → SQL Editor
-- =============================================================

-- 1) أعمدة جديدة في promotional_offers --------------------------
alter table public.promotional_offers
  add column if not exists product_id uuid references public.products(id);

alter table public.promotional_offers
  add column if not exists discount_percent numeric(5,2);

alter table public.promotional_offers
  add column if not exists special_price numeric(10,2);

-- 2) سياسات RLS للمدير العام (المدير العام هو الشركة) ------------
--    تكون السياسات تراكمية (OR) مع أي سياسات موجودة، ولا تمسّ
--    سياسات القراءة الحالية الخاصة بتطبيق Flutter.

drop policy if exists "director_manage_promotional_offers" on public.promotional_offers;
create policy "director_manage_promotional_offers"
  on public.promotional_offers
  for all
  to authenticated
  using (exists (
    select 1 from public.users where id = auth.uid() and role = 'company_director'
  ))
  with check (exists (
    select 1 from public.users where id = auth.uid() and role = 'company_director'
  ));

drop policy if exists "director_manage_bonus_rules" on public.bonus_rules;
create policy "director_manage_bonus_rules"
  on public.bonus_rules
  for all
  to authenticated
  using (exists (
    select 1 from public.users where id = auth.uid() and role = 'company_director'
  ))
  with check (exists (
    select 1 from public.users where id = auth.uid() and role = 'company_director'
  ));
