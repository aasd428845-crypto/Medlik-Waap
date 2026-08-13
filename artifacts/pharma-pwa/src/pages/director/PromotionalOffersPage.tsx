import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { OffersPanel } from '@/components/director/OffersPanel';

export function PromotionalOffersPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">العروض الترويجية</h2>
          <p className="text-muted-foreground text-sm">
            إدارة العروض الحالية، وإيقاف/تعديل/حذف أي عرض، وإضافة عروض جديدة
          </p>
        </div>
        <Link
          to="/director/promotional-offers/new"
          className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          إضافة عرض جديد
        </Link>
      </div>

      <OffersPanel />
    </div>
  );
}
