import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gift, Activity, XCircle, Globe, Plus, Layers } from 'lucide-react';
import { KPICard } from '@/components/KPICard';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { listBonusRules, type BonusRuleRow } from '@/lib/bonusRulesApi';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function isActiveNow(r: BonusRuleRow): boolean {
  const today = todayStr();
  return (
    r.is_active &&
    (!r.start_date || String(r.start_date).slice(0, 10) <= today) &&
    (!r.end_date || String(r.end_date).slice(0, 10) >= today)
  );
}

export function BonusOverviewPage() {
  const [rules, setRules] = useState<BonusRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setRules(await listBonusRules());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'تعذر جلب بيانات البونص');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const activeNow = rules.filter(isActiveNow);
  const generalActive = activeNow.filter((r) => !r.product_id);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">نظرة عامة على نظام البونص</h2>
          <p className="text-muted-foreground text-sm">ملخص قواعد "اشترِ واحصل على مجاناً" ومدى سريانها</p>
        </div>
        <Link
          to="/director/bonus-rules"
          className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          إدارة قواعد البونص
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="إجمالي قواعد البونص"
          value={rules.length}
          icon={<Gift className="w-6 h-6" />}
          colorClass="bg-primary/10 text-primary"
        />
        <KPICard
          title="قواعد سارية الآن"
          value={activeNow.length}
          icon={<Activity className="w-6 h-6" />}
          colorClass="bg-emerald-50 text-emerald-700"
        />
        <KPICard
          title="موقوفة أو منتهية"
          value={rules.length - activeNow.length}
          icon={<XCircle className="w-6 h-6" />}
          colorClass="bg-red-50 text-red-600"
        />
        <KPICard
          title="قواعد عامة سارية (كل الأصناف)"
          value={generalActive.length}
          icon={<Globe className="w-6 h-6" />}
          colorClass="bg-violet-50 text-violet-700"
        />
      </div>

      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/20 flex items-center justify-between">
          <h3 className="font-bold text-foreground">قواعد البونص السارية الآن</h3>
          <Link to="/director/bonus-rules" className="text-sm text-primary hover:underline">
            عرض الكل
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
              <tr>
                <th className="px-4 py-3">الصنف</th>
                <th className="px-4 py-3">القاعدة</th>
                <th className="px-4 py-3 text-center">التراكم</th>
                <th className="px-4 py-3">الفترة</th>
                <th className="px-4 py-3">المحافظة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {activeNow.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {r.product_name || 'جميع الأصناف'}
                  </td>
                  <td className="px-4 py-3 font-semibold text-foreground">
                    اشترِ {r.buy_quantity} واحصل على {r.free_quantity} مجاناً
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.is_stackable ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full">
                        <Layers className="w-3 h-3" /> نعم
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">لا</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {r.start_date ? String(r.start_date).slice(0, 10) : '—'}
                    {r.end_date ? ` ← ${String(r.end_date).slice(0, 10)}` : ''}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.target_governorate || 'الكل'}
                  </td>
                </tr>
              ))}
              {activeNow.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    لا توجد قواعد بونص سارية الآن.{' '}
                    <Link to="/director/bonus-rules/new" className="text-primary hover:underline">
                      أنشئ قاعدة جديدة
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
