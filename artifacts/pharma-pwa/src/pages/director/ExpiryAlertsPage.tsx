import { useEffect, useState } from 'react';
import { AlertTriangle, Download, Flame } from 'lucide-react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import {
  listWarehouseInventory,
  exportExpiryCsv,
  bucketOf,
  type WarehouseRow,
  type ExpiryBucket,
} from '@/lib/expiryInventoryApi';

const TABS: { bucket: ExpiryBucket; label: string; cls: string; badgeCls: string }[] = [
  { bucket: 30, label: 'ينتهي خلال 30 يوم', cls: 'bg-red-50 text-red-700 border-red-200', badgeCls: 'bg-red-100 text-red-700' },
  { bucket: 60, label: 'ينتهي خلال 60 يوم', cls: 'bg-orange-50 text-orange-700 border-orange-200', badgeCls: 'bg-orange-100 text-orange-700' },
  { bucket: 90, label: 'ينتهي خلال 90 يوم', cls: 'bg-yellow-50 text-yellow-700 border-yellow-200', badgeCls: 'bg-yellow-100 text-yellow-700' },
];

function daysBadge(days: number | null): { label: string; cls: string } {
  if (days == null) return { label: '—', cls: 'bg-gray-100 text-gray-600' };
  if (days <= 0) return { label: 'منتهي', cls: 'bg-red-100 text-red-700' };
  if (days <= 30) return { label: `${days} يوم`, cls: 'bg-red-50 text-red-700 border border-red-200' };
  if (days <= 60) return { label: `${days} يوم`, cls: 'bg-orange-50 text-orange-700 border border-orange-200' };
  return { label: `${days} يوم`, cls: 'bg-yellow-50 text-yellow-700 border border-yellow-200' };
}

export function ExpiryAlertsPage() {
  const [rows, setRows] = useState<WarehouseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<ExpiryBucket>(30);

  useEffect(() => {
    (async () => {
      try {
        setRows(await listWarehouseInventory());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'تعذر جلب بيانات انتهاء الصلاحية');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const exposure30 = rows
    .filter((r) => bucketOf(r.days_left) === 30)
    .reduce((s, r) => s + r.value, 0);

  const currentBucket = TABS.find((t) => t.bucket === tab)!;
  const tabRows = rows.filter((r) => bucketOf(r.days_left) === tab);

  const handleExport = () => {
    exportExpiryCsv(`انتهاء-الصلاحية-${tab}-يوم.csv`, tabRows);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">تنبيهات انتهاء الصلاحية</h2>
        <p className="text-muted-foreground text-sm">
          رصد دفعات المخزون القريبة من انتهاء الصلاحية عبر كل الفروع
        </p>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorMessage message={error} />
      ) : (
        <>
          {/* بطاقة الملخص: القيمة المعرضة للخسارة خلال 30 يوم */}
          <div className="rounded-xl border-2 border-red-200 bg-red-50 p-6 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="p-4 rounded-full bg-red-100 text-red-600 shrink-0">
                <AlertTriangle className="w-7 h-7" />
              </div>
              <div>
                <p className="text-sm font-medium text-red-700">
                  القيمة المالية المعرَّضة للخسارة (أصناف تنتهي خلال 30 يوم)
                </p>
                <h3 className="text-3xl md:text-4xl font-extrabold text-red-600 mt-1" dir="ltr">
                  {exposure30.toLocaleString()} <span className="text-lg font-bold">ر.ي</span>
                </h3>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-100 text-red-700 text-sm font-semibold">
              <Flame className="w-4 h-4" />
              {rows.filter((r) => bucketOf(r.days_left) === 30).length} دفعة معرّضة
            </span>
          </div>

          {/* الأقسام المبوّبة */}
          <div className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t.bucket}
                onClick={() => setTab(t.bucket)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                  tab === t.bucket ? 'shadow-sm ' + t.cls : 'bg-card text-muted-foreground hover:bg-muted'
                }`}
              >
                {t.label}
                <span className={`mr-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${t.badgeCls}`}>
                  {rows.filter((r) => bucketOf(r.days_left) === t.bucket).length}
                </span>
              </button>
            ))}
          </div>

          {/* جدول القسم المختار */}
          <div className="bg-card border rounded-xl shadow-sm">
            <div className="px-4 py-3 border-b bg-muted/20 flex items-center justify-between gap-3">
              <h3 className="font-bold text-foreground">{currentBucket.label}</h3>
              <button
                onClick={handleExport}
                disabled={tabRows.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                تصدير Excel/CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
                  <tr>
                    <th className="px-4 py-3 whitespace-nowrap">اسم الصنف</th>
                    <th className="px-4 py-3 whitespace-nowrap">الفرع</th>
                    <th className="px-4 py-3 whitespace-nowrap text-center">الكمية المتبقية</th>
                    <th className="px-4 py-3 whitespace-nowrap text-center">تاريخ الانتهاء بالضبط</th>
                    <th className="px-4 py-3 whitespace-nowrap text-center">الأيام المتبقية</th>
                    <th className="px-4 py-3 whitespace-nowrap text-center">القيمة المالية</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tabRows.map((r) => {
                    const d = daysBadge(r.days_left);
                    return (
                      <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-foreground">{r.product_name || '—'}</td>
                        <td className="px-4 py-3 text-muted-foreground">{r.branch_name || '—'}</td>
                        <td className="px-4 py-3 text-center font-semibold">{r.quantity}</td>
                        <td className="px-4 py-3 text-center text-muted-foreground" dir="ltr">
                          {r.expiry_date ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${d.cls}`}>
                            {d.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center font-bold text-foreground" dir="ltr">
                          {r.value.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                  {tabRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                        لا توجد دفعات تنتهي خلال {tab} يوماً في الوقت الحالي.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}