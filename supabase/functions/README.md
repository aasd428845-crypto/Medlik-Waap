# Supabase Edge Functions — مشروع الويب (Pharma Manager)

> **الغرض:** دوال الخادم الخاصة بلوحة تحكم المدير العام في مشروع الويب.
> **قاعدة البيانات المستهدفة:** `lmkomzqioneuyvatzsov` (نفس قاعدة بيانات تطبيق Flutter).
> **ملاحظة الفصل بين المشروعين:** دالة `manage-driver-account` تخص مشروع Flutter وتُدار من هناك؛
> هذا المجلد يحوي دوال الويب فقط. **لا ازدواجية.**

---

## الدوال الموجودة

### 1) `manage-branch-manager-account`

**وظيفتها:** إدارة حسابات مدراء الفروع من لوحة المدير العام —
إنشاء الحسابات، تفعيل/إيقاف، وإعادة تعيين كلمة المرور — دون كشف مفتاح الخدمة.

**البنية الأمنية (مطابقة لنمط `manage-driver-account`):**
- المتصل يجب أن يكون `company_director` **نشطاً** فقط (`role` + `account_status='active'`).
- الهدف يجب أن يكون `branch_manager` (تحقق من الدور في كل إجراء).
- التحقق من JWT عبر `auth.getUser()`، ثم عمليات حساسة عبر مفتاح الخدمة.
- `email_confirm: true` + تأخير 600ms (لانتظار trigger `handle_new_user`) + تراجع تلقائي عند الفشل.
- `requires_password_change: true` — إجبار المدير على تغيير كلمة المرور عند أول دخول.

**الإجراءات المكشوفة (`action`):**

| action | الحقول المطلوبة | النتيجة |
|---|---|---|
| `create` | `name`, `email`, `password`, `phone?`, `branchId?` | إنشاء حساب مفعّل فوراً وربطه بفرع |
| `update_status` | `managerId`, `status` (`active`/`suspended`) | تفعيل أو إيقاف الحساب |
| `reset_password` | `managerId`, `newPassword` (≥6) | إعادة تعيين كلمة المرور + إجبار تغييرها |

**رسائل الخطأ:** تطابق تماماً عقد `src/lib/branchManagerApi.ts` (تُترجم للعربية في الواجهة).

**الاستدعاء من الويب:** `supabase.functions.invoke('manage-branch-manager-account', { body })`
(الملف: `src/lib/branchManagerApi.ts` — كل عمليات الكتابة تمر حصراً عبر هذه الدالة).

---

## أوامر النشر (نفّذها من مجلد مشروع الويب)

### 1) تسجيل الدخول إلى Supabase CLI (مرة واحدة أو عند انتهاء الجلسة)
```bash
supabase login
```

### 2) تعيين أسرار الدالة
> **ملاحظة دقيقة:** المنصة تزوّد كل دالة تلقائياً بـ `SUPABASE_URL` و`SUPABASE_ANON_KEY`
> و`SUPABASE_SERVICE_ROLE_KEY` — لذلك **لا يلزم** عادةً أي `secrets set` (هذا هو سبب عمل
> `manage-driver-account` بدونها). لو أردت التعيين الصريح لأي سبب:
```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service_role_key> --project-ref lmkomzqioneuyvatzsov
```
> ⚠️ خدمةً منك: مفتاح الخدمة سرّ قوي — لا تشاركه أو ترفعه لأي مستودع.

### 3) نشر الدالة
```bash
# من جذر مشروع الويب: C:\Users\USER\Medlik-Waap
supabase functions deploy manage-branch-manager-account --project-ref lmkomzqioneuyvatzsov
```

### 4) التحقق من النشر
```bash
supabase functions list --project-ref lmkomzqioneuyvatzsov
```
يجب أن تظهر `manage-branch-manager-account` بحالة نشطة و `verify_jwt: true` (مطلوب —
الويب يرسل JWT المستخدم في `Authorization` عبر `functions.invoke`).

---

## مخطط الاعتماد بين الويب والدالة

| الطبقة | الملف | الدور |
|---|---|---|
| الواجهة | `src/pages/director/BranchManagersPage.tsx` | العرض (جدول + إنشاء + إيقاف + إعادة تعيين) |
| الطبقة الوسيطة | `src/lib/branchManagerApi.ts` | القراءة المباشرة (RLS) + استدعاء الدالة للكتابة |
| الخادم | `supabase/functions/manage-branch-manager-account/index.ts` | التحقق من المدير العام + عمليات admin |
