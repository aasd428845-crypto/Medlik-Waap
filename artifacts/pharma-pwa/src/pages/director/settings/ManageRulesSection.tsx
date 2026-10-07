import { BonusRulesPage } from '@/pages/director/BonusRulesPage';

/** 📋 إدارة قواعد البونص — legacy Buy-X-Free-Y rule manager (reuses existing panel). */
export function ManageRulesSection() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-bold">إدارة قواعد البونص</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          إدارة قواعد البونص الكلاسيكية (اشترِ كمية — خصم/هدية). إنشاء وتعديل وحذف.
        </p>
      </div>
      <BonusRulesPage />
    </div>
  );
}
