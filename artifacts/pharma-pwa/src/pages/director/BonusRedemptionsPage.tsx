import { useCallback, useEffect, useState } from 'react';
import { Search, RefreshCw, Eye, X, CheckCircle, PackageCheck, Ban } from 'lucide-react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  listRedemptions,
  approveRedemption,
  fulfillRedemption,
  cancelRedemption,
  type RedemptionRow,
} from '@/lib/bonusFinancialApi';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'معلّق', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  APPROVED: { label: 'مقبول', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  REJECTED: { label: 'مرفوض', className: 'bg-red-50 text-red-700 border-red-200' },
  FULFILLED: { label: 'مُنفَّذ', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  CANCELLED: { label: 'ملغي', className: 'bg-gray-100 text-gray-600 border-gray-200' },
};

const yer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

type Action =
  | { kind: 'approve' | 'fulfill' | 'cancel'; row: RedemptionRow }
  | null;

const ACTION_META: Record<string, { title: string; confirm: string }> = {
  approve: { title: 'قبول طلب الاسترداد', confirm: 'قبول' },
  fulfill: { title: 'تنفيذ طلب الاسترداد', confirm: 'تنفيذ' },
  cancel: { title: 'إلغاء طلب الاسترداد', confirm: 'إلغاء الطلب' },
};

export function BonusRedemptionsPage() {
  const [rows, setRows] = useState<RedemptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [detail, setDetail] = useState<RedemptionRow | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setRows(await listRedemptions());
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'تعذر جلب طلبات الاسترداد');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    window.setTimeout(() => setSuccessMsg(''), 4000);
  };

  const handleAction = async () => {
    if (!action) return;
    setBusy(true);
    try {
      if (action.kind === 'approve') await approveRedemption(action.row.id);
      else if (action.kind === 'fulfill') await fulfillRedemption(action.row.id);
      else await cancelRedemption(action.row.id);
      showSuccess('تم تنفيذ العملية بنجاح.');
      setAction(null);
      await fetchAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء تنفيذ العملية');
    } finally {
      setBusy(false);
    }
  };

  const filtered = rows.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (searchTerm) {
      const q = searchTerm.trim().toLowerCase();
      if (
        !(r.account_id ?? '').toLowerCase().includes(q) &&
        !(r.product_name ?? '').toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  const pendingCount = rows.filter((r) => r.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">استرداد المنتجات بالبونص</h2>
          <p className="text-muted-foreground text-sm">
            {pendingCount > 0 ? `${pendingCount} طلب معلّق بانتظار القرار` : 'طلبات استبدال الرصيد بمنتجات'}
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

      {successMsg && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
          {successMsg}
        </div>
      )}

      <div className="bg-card border rounded-xl shadow-sm">
        <div className="p-4 border-b flex flex-col sm:flex-row gap-3 bg-muted/20">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute right-3 top-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="بحث برقم الحساب أو المنتج..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-3 pr-10 py-2 border rounded-lg bg-background text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border rounded-lg bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
          >
            <option value="">كل الحالات</option>
            {Object.entries(STATUS_BADGE).map(([v, b]) => (
              <option key={v} value={v}>
                {b.label}
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
                  <th className="px-4 py-3 whitespace-nowrap">المنتج</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">الكمية</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">القيمة (ر.ي)</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">الحالة</th>
                  <th className="px-4 py-3 whitespace-nowrap">التاريخ</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => {
                  const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE.PENDING;
                  return (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium">
                        {r.product_name ?? r.product_id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3 text-center" dir="ltr">
                        {r.quantity}
                      </td>
                      <td className="px-4 py-3 text-center font-bold" dir="ltr">
                        {yer.format(r.bonus_value)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs" dir="ltr">
                        {String(r.created_at).slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => setDetail(r)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="التفاصيل"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {r.status === 'PENDING' && (
                            <>
                              <button
                                type="button"
                                onClick={() => setAction({ kind: 'approve', row: r })}
                                disabled={busy}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                                قبول
                              </button>
                              <button
                                type="button"
                                onClick={() => setAction({ kind: 'cancel', row: r })}
                                disabled={busy}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 transition-colors disabled:opacity-50"
                              >
                                <Ban className="w-3.5 h-3.5" />
                                إلغاء
                              </button>
                            </>
                          )}
                          {r.status === 'APPROVED' && (
                            <button
                              type="button"
                              onClick={() => setAction({ kind: 'fulfill', row: r })}
                              disabled={busy}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors disabled:opacity-50"
                            >
                              <PackageCheck className="w-3.5 h-3.5" />
                              تنفيذ
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      لا توجد طلبات استرداد مطابقة.
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
          <div className="bg-card rounded-xl shadow-xl w-full max-w-lg my-8">
            <div className="px-6 py-4 border-b flex justify-between items-center bg-muted/20">
              <h3 className="font-bold text-lg">تفاصيل طلب الاسترداد</h3>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="إغلاق"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <dl className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {[
                ['المنتج', detail.product_name ?? detail.product_id],
                ['الكمية', String(detail.quantity)],
                ['القيمة (ر.ي)', yer.format(detail.bonus_value)],
                ['الحالة', STATUS_BADGE[detail.status]?.label ?? detail.status],
                ['الحساب', detail.account_id],
                ['طلبها', detail.requested_by ?? '—'],
                ['قررها', detail.decided_by ?? '—'],
                ['سبب القرار', detail.decision_reason ?? '—'],
                ['القيد المرتبط', detail.ledger_id ?? '—'],
                ['التاريخ', String(detail.created_at).slice(0, 16).replace('T', ' ')],
              ].map(([k, v]) => (
                <div key={k} className="border-b pb-2">
                  <dt className="text-muted-foreground text-xs mb-1">{k}</dt>
                  <dd className="font-medium break-all">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {action && (
        <ConfirmDialog
          isOpen
          onClose={() => {
            if (!busy) setAction(null);
          }}
          onConfirm={() => void handleAction()}
          title={ACTION_META[action.kind].title}
          message={`تأكيد ${ACTION_META[action.kind].confirm} طلب الاسترداد (القيمة ${yer.format(
            action.row.bonus_value,
          )} ر.ي)؟`}
          confirmLabel={ACTION_META[action.kind].confirm}
        />
      )}
    </div>
  );
}
