import { BonusOverviewPage } from '@/pages/director/BonusOverviewPage';

/** 📊 نظام البونص — KPI cards + active rules table (reuses existing component). */
export function BonusSystemSection() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-bold">نظام البونص</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          نظرة عامة على البونص النشط، مؤشرات الأداء الرئيسية، وقائمة القواعد الحالية.
        </p>
      </div>
      <BonusOverviewPage />
    </div>
  );
}
