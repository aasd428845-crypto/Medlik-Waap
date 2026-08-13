import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { BonusRulesPanel } from '@/components/director/BonusRulesPanel';

export function BonusRulesPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">قواعد البونص</h2>
          <p className="text-muted-foreground text-sm">
            إدارة قواعد "اشترِ واحصل على مجاناً"، وإيقاف/تعديل/حذف أي قاعدة
          </p>
        </div>
        <Link
          to="/director/bonus-rules/new"
          className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          إضافة قاعدة بونص
        </Link>
      </div>

      <BonusRulesPanel />
    </div>
  );
}
