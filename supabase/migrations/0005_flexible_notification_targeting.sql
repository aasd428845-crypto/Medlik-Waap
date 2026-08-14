-- =============================================================
-- Migration 0005 — المرحلة 6: إرسال الإشعارات لمستخدمين محددين
-- مشروع ويب Medlik-Waap (لوحة تحكم المدير العام)
-- 1) عمود target_user_ids يسمح بتوجيه إشعار واحد لمجموعة مستخدمين
--    محددة (uuid[]) بدلاً من التوجيه حسب الدور فقط.
-- 2) تعديل سياسة notifications_select_relevant ليشمل القراءة
--    للمستخدمين المذكورين داخل target_user_ids.
--
-- البنية الأصلية (من ملفات مشروع Flutter 0003) لا تحتوي هذا العمود،
-- والسياسة الأصلية تتيح القراءة لمن يطابق دورهم target_role فقط.
-- هذا الملف يضيف العمود ويوسّع السياسة شرطاً تراكمياً (OR) دون أن
-- يمسّ شروط القراءة الحالية الخاصة بتطبيق Flutter.
-- نفِّذه من Supabase Dashboard → SQL Editor
-- =============================================================

-- 1) عمود جديد: المستخدمون المستهدفون --------------------------
alter table public.notifications
  add column if not exists target_user_ids uuid[] not null default '{}';

-- 2) تعديل سياسة القراءة ليشمل المستخدمين المحددين --------------
--    تبقى السياسة كما هي مع شرط إضافي: أن يكون المستخدم ضمن
--    target_user_ids (تنطبق على إشعارات "مجموعة محددة"/"فرد واحد"
--    حيث target_role = null والمستلمون في المصفوفة).

drop policy if exists "notifications_select_relevant" on public.notifications;
create policy "notifications_select_relevant"
  on public.notifications
  for select
  to authenticated
  using (
    target_role is null
    or target_role = public.current_user_role()
    or auth.uid() = any(target_user_ids)
  );
