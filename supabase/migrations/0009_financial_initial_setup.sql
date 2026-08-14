-- =============================================================
-- Migration 0009 — التهيئة المالية الأولية
-- Medlik-Waap
--
-- تنشئ شركة مالية تشغيلية أولية، سنة 2026 وفتراتها، ودليل حسابات
-- أساسي مناسب لشركة توزيع أدوية. يمكن للإدارة تعديل الأسماء لاحقاً
-- دون تغيير أرقام الحسابات المستخدمة في القيود.
-- =============================================================

insert into public.financial_companies (name, legal_name, base_currency_code)
select 'MedLink Yemen', null, 'YER'
where not exists (
  select 1 from public.financial_companies
);

do $$
declare
  v_company_id uuid;
  v_fy_id uuid;
begin
  select id into v_company_id
    from public.financial_companies
   order by created_at
   limit 1;

  if v_company_id is null then
    raise exception 'Financial company setup failed';
  end if;

  insert into public.financial_fiscal_years (
    company_id, year_code, start_date, end_date, status
  )
  select v_company_id, '2026', '2026-01-01', '2026-12-31', 'open'
  where not exists (
    select 1 from public.financial_fiscal_years
     where company_id = v_company_id and year_code = '2026'
  );

  select id into v_fy_id
    from public.financial_fiscal_years
   where company_id = v_company_id and year_code = '2026';

  insert into public.financial_periods (
    fiscal_year_id, period_number, name, start_date, end_date, status
  )
  select v_fy_id, x.n, x.name, x.start_date, x.end_date, 'open'
    from (values
      (1,'يناير','2026-01-01'::date,'2026-01-31'::date),
      (2,'فبراير','2026-02-01'::date,'2026-02-28'::date),
      (3,'مارس','2026-03-01'::date,'2026-03-31'::date),
      (4,'أبريل','2026-04-01'::date,'2026-04-30'::date),
      (5,'مايو','2026-05-01'::date,'2026-05-31'::date),
      (6,'يونيو','2026-06-01'::date,'2026-06-30'::date),
      (7,'يوليو','2026-07-01'::date,'2026-07-31'::date),
      (8,'أغسطس','2026-08-01'::date,'2026-08-31'::date),
      (9,'سبتمبر','2026-09-01'::date,'2026-09-30'::date),
      (10,'أكتوبر','2026-10-01'::date,'2026-10-31'::date),
      (11,'نوفمبر','2026-11-01'::date,'2026-11-30'::date),
      (12,'ديسمبر','2026-12-01'::date,'2026-12-31'::date)
    ) as x(n,name,start_date,end_date)
  where not exists (
    select 1 from public.financial_periods p
     where p.fiscal_year_id = v_fy_id and p.period_number = x.n
  );

  -- الحسابات الرئيسية
  insert into public.financial_accounts
    (company_id, code, name, account_type, level, is_postable, normal_balance)
  select v_company_id, x.code, x.name, x.account_type, 1, false, x.normal_balance
    from (values
      ('1000','الأصول','asset','debit'),
      ('2000','الالتزامات','liability','credit'),
      ('3000','حقوق الملكية','equity','credit'),
      ('4000','الإيرادات','revenue','credit'),
      ('5000','تكلفة المبيعات','cogs','debit'),
      ('6000','المصروفات','expense','debit')
    ) x(code,name,account_type,normal_balance)
  where not exists (
    select 1 from public.financial_accounts a
     where a.company_id = v_company_id and a.code = x.code
  );

  -- الأصول المتداولة
  insert into public.financial_accounts
    (company_id, code, name, account_type, parent_id, level, is_postable, normal_balance)
  select v_company_id, x.code, x.name, x.account_type,
         (select id from public.financial_accounts where company_id=v_company_id and code='1000'),
         2, false, x.normal_balance
    from (values
      ('1100','الأصول المتداولة','asset','debit'),
      ('1200','الأصول غير المتداولة','asset','debit')
    ) x(code,name,account_type,normal_balance)
  where not exists (select 1 from public.financial_accounts a where a.company_id=v_company_id and a.code=x.code);

  -- الحسابات التشغيلية الأساسية
  insert into public.financial_accounts
    (company_id, code, name, account_type, parent_id, level, is_postable, normal_balance)
  select v_company_id, x.code, x.name, x.account_type,
         (select id from public.financial_accounts where company_id=v_company_id and code=x.parent_code),
         3, true, x.normal_balance
    from (values
      ('1110','الصندوق الرئيسي','asset','1110_parent','debit'),
      ('1120','البنوك','asset','1100','debit'),
      ('1130','الذمم المدينة - العملاء','asset','1100','debit'),
      ('1140','مخزون الأدوية','asset','1100','debit'),
      ('1150','مصروفات مدفوعة مقدماً','asset','1100','debit'),
      ('1210','الأصول الثابتة','asset','1200','debit'),
      ('2110','الذمم الدائنة - الموردون','liability','2000','credit'),
      ('2120','مصروفات مستحقة','liability','2000','credit'),
      ('2130','ضرائب والتزامات أخرى','liability','2000','credit'),
      ('3110','رأس المال','equity','3000','credit'),
      ('3120','الأرباح المحتجزة','equity','3000','credit'),
      ('4110','مبيعات الأدوية','revenue','4000','credit'),
      ('4120','إيرادات التوصيل والخدمات','revenue','4000','credit'),
      ('5110','تكلفة الأدوية المباعة','cogs','5000','debit'),
      ('6110','رواتب وأجور','expense','6000','debit'),
      ('6120','إيجارات','expense','6000','debit'),
      ('6130','كهرباء واتصالات','expense','6000','debit'),
      ('6140','وقود ونقل','expense','6000','debit'),
      ('6150','صيانة','expense','6000','debit'),
      ('6160','تسويق وإعلان','expense','6000','debit'),
      ('6170','مصروفات بنكية','expense','6000','debit'),
      ('6180','مصروفات إدارية متنوعة','expense','6000','debit')
    ) x(code,name,account_type,parent_code,normal_balance)
  where not exists (select 1 from public.financial_accounts a where a.company_id=v_company_id and a.code=x.code);

  -- تصحيح أب الصندوق الرئيسي: حساب فرعي تحت الأصول المتداولة.
  update public.financial_accounts a
     set parent_id = (select id from public.financial_accounts where company_id=v_company_id and code='1100')
   where a.company_id=v_company_id and a.code='1110';

  -- ربط الذمم والمبيعات الافتراضية بالنواة.
  insert into public.financial_account_mappings
    (company_id, receivable_account_id, sales_account_id)
  select v_company_id,
         (select id from public.financial_accounts where company_id=v_company_id and code='1130'),
         (select id from public.financial_accounts where company_id=v_company_id and code='4110')
  where not exists (select 1 from public.financial_account_mappings m where m.company_id=v_company_id);
end $$;

-- =============================================================
-- لا يتم إنشاء أرصدة افتتاحية أو حركات تاريخية تلقائياً هنا.
-- الأرصدة الافتتاحية ستدخل عبر مستند افتتاحي معتمد في مرحلة مستقلة.
-- =============================================================
