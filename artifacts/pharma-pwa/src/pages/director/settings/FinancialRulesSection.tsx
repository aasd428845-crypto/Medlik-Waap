import { BonusRulesV2Page } from '@/pages/director/BonusRulesV2Page';

/** 💼 القواعد المالية — V2 rule engine CRUD (reuses existing component). */
export function FinancialRulesSection() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-bold">القواعد المالية</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          محرك قواعد البونص V2: قواعد منتجات/نقدية/عامة مع أولويات وتكاملات. إنشاء وتعديل وحذف.
        </p>
      </div>
      <BonusRulesV2Page />
    </div>
  );
}
