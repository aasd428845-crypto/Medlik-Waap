import { useCallback, useEffect, useState } from 'react';
import { Search, RefreshCw, Eye, X } from 'lucide-react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { listAudit, type AuditRow } from '@/lib/bonusFinancialApi';

function prettyJson(v: unknown): string {
  if (v === null || v === undefined) return '—';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function BonusAuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setRows(await listAudit(300));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'تعذر جلب سجل التدقيق');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const actions = Array.from(new Set(rows.map((r) => r.action))).sort();

  const filtered = rows.filter((r) => {
    if (actionFilter && r.action !== actionFilter) return false;
    if (searchTerm) {
      const q = searchTerm.trim().toLowerCase();
      if (
        !(r.entity ?? '').toLowerCase().includes(q) &&
        !(r.entity_id ?? '').toLowerCase().includes(q) &&
        !(r.reason ?? '').toLowerCase().includes(q) &&
        !(r.reference ?? '').toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">سجل تدقيق البونص</h2>
          <p className="text-muted-foreground text-sm">
            سجل إلحاقي للقراءة فقط — لا يمكن تعديله أو حذفه
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchAll()}
          disabled={loading}
          className="inline-flex items-center gap-2 border rounded-lg bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          تحديث
        </button>
      </div>

      <div className="bg-card border rounded-xl shadow-sm">
        <div className="p-4 border-b flex flex-col sm:flex-row gap-3 bg-muted/20">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute right-3 top-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="بحث بالكيان أو السبب أو المرجع..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-3 pr-10 py-2 border rounded-lg bg-background text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="border rounded-lg bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
          >
            <option value="">كل الإجراءات</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <div className="p-4">
            <ErrorMessage message={error} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
                <tr>
                  <th className="px-4 py-3 whitespace-nowrap">الإجراء</th>
                  <th className="px-4 py-3 whitespace-nowrap">الكيان</th>
                  <th className="px-4 py-3 whitespace-nowrap">الوقت</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">التفاصيل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium" dir="ltr">
                      {r.action}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground" dir="ltr">
                      {r.entity}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs" dir="ltr">
                      {String(r.at_time).slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => setDetail(r)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="عرض القيم"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                      لا توجد سجلات مطابقة.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-2xl my-8">
            <div className="px-6 py-4 border-b flex justify-between items-center bg-muted/20">
              <h3 className="font-bold text-lg">تفاصيل حدث التدقيق</h3>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="إغلاق"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-sm">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                {[
                  ['الإجراء', detail.action],
                  ['الكيان', detail.entity],
                  ['معرف الكيان', detail.entity_id ?? '—'],
                  ['الفاعل', detail.actor ?? '—'],
                  ['الوقت', String(detail.at_time).slice(0, 19).replace('T', ' ')],
                  ['السبب', detail.reason ?? '—'],
                  ['المرجع', detail.reference ?? '—'],
                ].map(([k, v]) => (
                  <div key={k} className="border-b pb-2">
                    <dt className="text-muted-foreground text-xs mb-1">{k}</dt>
                    <dd className="font-medium break-all" dir="ltr">
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
              <div>
                <p className="text-xs font-bold text-muted-foreground mb-1">القيمة السابقة</p>
                <pre className="bg-muted/50 rounded-lg p-3 text-xs overflow-x-auto" dir="ltr">
                  {prettyJson(detail.old_value)}
                </pre>
              </div>
              <div>
                <p className="text-xs font-bold text-muted-foreground mb-1">القيمة الجديدة</p>
                <pre className="bg-muted/50 rounded-lg p-3 text-xs overflow-x-auto" dir="ltr">
                  {prettyJson(detail.new_value)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
