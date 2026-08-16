-- =============================================================
-- Migration 0013 — ربط سعر الصرف الحي (financial_exchange_rates)
-- مشروع ويب Medlik-Waap (لوحة تحكم المدير العام)
--
-- يضيف أعمدة المواصفة الجديدة فوق التعريف القديم (0006):
--   currency_code  → العملة المرجعية (USD / SAR)
--   rate_to_yer    → سعر الوحدة مقابل الريال اليمني
--   fetched_at     → طابع الجلب (تحديث كل ساعة عبر Edge Function)
-- + فهرس (currency_code, fetched_at desc) لأحدث سعر بسرعة
-- + سياسة قراءة للمستخدمين المصادق عليهم
-- + بذور أولية (فقط إن كان الجدول فارغاً) كي تظهر البطاقة
--   قبل أول تشغيل للدالة.
-- نفِّذه من Supabase Dashboard → SQL Editor
-- =============================================================

-- 1) أعمدة المواصفة الجديدة فوق الجدول القديم -------------------
alter table public.financial_exchange_rates
  add column if not exists currency_code text references public.financial_currencies(code);

alter table public.financial_exchange_rates
  add column if not exists rate_to_yer numeric(20,8);

alter table public.financial_exchange_rates
  add column if not exists fetched_at timestamptz not null default now();

-- تعبئة من السجلات القديمة إن وُجدت (USD/YER و SAR/YER)
update public.financial_exchange_rates
set currency_code = from_currency_code,
    rate_to_yer = rate,
    fetched_at = effective_date::timestamptz
where currency_code is null
  and from_currency_code in ('USD', 'SAR')
  and to_currency_code = 'YER';

-- 2) إزالة القيد اليومي القديم (يسمح بإدراج صف جديد كل جلب) ------
alter table public.financial_exchange_rates
  drop constraint if exists financial_exchange_rates_from_currency_code_to_currency_code_effective_date_key;

-- 3) فهرس أسرع جلب لأحدث سعر لكل عملة ---------------------------
create index if not exists financial_exchange_rates_currency_fetched_idx
  on public.financial_exchange_rates (currency_code, fetched_at desc);

-- 3) الحماية: قراءة للمصادق عليهم فقط (الإدراج عبر Service Role) --
alter table public.financial_exchange_rates enable row level security;

drop policy if exists "exchange_rates_read_authenticated" on public.financial_exchange_rates;
create policy "exchange_rates_read_authenticated"
  on public.financial_exchange_rates
  for select
  using (auth.role() = 'authenticated');

-- 4) بذور أولية (فقط إن كان الجدول فارغاً تماماً) ----------------
insert into public.financial_exchange_rates
  (from_currency_code, to_currency_code, rate, effective_date, currency_code, rate_to_yer, fetched_at)
select 'USD', 'YER', 530.5, current_date, 'USD', 530.5, now()
where not exists (select 1 from public.financial_exchange_rates);

insert into public.financial_exchange_rates
  (from_currency_code, to_currency_code, rate, effective_date, currency_code, rate_to_yer, fetched_at)
select 'SAR', 'YER', 140.2, current_date, 'SAR', 140.2, now()
where not exists (select 1 from public.financial_exchange_rates where currency_code = 'SAR');