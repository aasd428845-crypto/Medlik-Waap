import { useCallback, useEffect, useState } from 'react';
import { TrendingUp, AlertTriangle, PackageOpen, ClipboardList } from 'lucide-react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { fetchTopRequested, fetchStagnantProducts, type TopProduct, type StagnantProduct } from '@/lib/itemAnalyticsApi';

const PERIODS = [
  { days: 7, label: 'آخر 7 أيام' },
  { days: 30, label: 'آخر 30 يوم' },
  { days: 90, label: 'آخر 90 يوم' },
];

function formatDate(iso: string | null, never: boolean): string {
  if (never) return 'لم يُطلب مطلقاً';
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function ItemAnalyticsPage() {
  const [period, setPeriod] = useState(30);
  const [top, setTop] = useState<TopProduct[]>([]);
  const [stagnant, setStagnant] = useState<StagnantProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [t, s] = await Promise.all([fetchTopRequested(period), fetchStagnantProducts(period)]);
      setTop(t);
      setStagnant(s);
    } catch (err) {
      console.error(err);
      setError('تعذر جلب بيانات التحليلات. تأكد من تسجيل الدخول.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const maxQty = top.length > 0 ? top[0].totalQty : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">تحليلات الأصناف</h2>
          <p className="text-muted-foreground text-sm">
            الأكثر طلباً والأصناف الراكدة بناءً على الطلبات الفعلية.
          </p>
        </div>
        <div className="flex items-center gap-1 bg-muted/40 border rounded-lg p-1 w-fit">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              onClick={() => setPeriod(p.days)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                period === p.days
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorMessage message={error} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* الأكثر طلباً */}
          <section className="bg-card border rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b bg-muted/20 flex items-center gap-2.5">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
              <h3 className="font-bold text-foreground">الأكثر طلباً 🔝</h3>
              <span className="text-xs text-muted-foreground mr-auto">
                أعلى 10 أصناف خلال {period} يوماً
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
                  <tr>
                    <th className="px-4 py-2.5 whitespace-nowrap">#</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">اسم الصنف</th>
                    <th className="px-4 py-2.5 whitespace-nowrap text-center">الكمية الإجمالية</th>
                    <th className="px-4 py-2.5 whitespace-nowrap text-center">عدد الطلبات</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">الطلب</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {top.map((p, i) => (
                    <tr key={p.productId} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-2.5 font-medium text-foreground">{p.name}</td>
                      <td className="px-4 py-2.5 text-center font-bold text-primary">{p.totalQty}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border bg-blue-50 text-blue-700 border-blue-200">
                          <ClipboardList className="w-3.5 h-3.5" />
                          {p.orderCount}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="w-full h-2 rounded-full bg-muted overflow-hidden min-w-[60px]">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${Math.round((p.totalQty / maxQty) * 100)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {top.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        لا توجد طلبات خلال هذه الفترة.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* الأصناف الراكدة */}
          <section className="bg-card border rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b bg-muted/20 flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <h3 className="font-bold text-foreground">الأصناف الراكدة ⚠️</h3>
              <span className="text-xs text-muted-foreground mr-auto">
                متوفرة بالمخزون ولم تُطلب خلال {period} يوماً
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
                  <tr>
                    <th className="px-4 py-2.5 whitespace-nowrap">اسم الصنف</th>
                    <th className="px-4 py-2.5 whitespace-nowrap text-center">الكمية المتوفرة (كل الفروع)</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">تاريخ آخر طلب</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stagnant.map((p) => (
                    <tr key={p.productId} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 font-medium text-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <PackageOpen className="w-4 h-4 text-amber-600" />
                          {p.name}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center font-bold text-amber-700">
                        {p.totalAvailableQty}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded-md text-xs ${p.neverRequested ? 'bg-gray-100 text-gray-600 border border-gray-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                          {formatDate(p.lastRequestAt, p.neverRequested)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {stagnant.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                        لا توجد أصناف راكدة خلال هذه الفترة.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}