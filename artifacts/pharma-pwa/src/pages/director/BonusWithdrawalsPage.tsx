import { useCallback, useEffect, useState } from 'react';
import { Search, RefreshCw, Eye, X, CheckCircle, XCircle, Banknote, Flag } from 'lucide-react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  listWithdrawals,
  startWithdrawalReview,
  approveWithdrawal,
  rejectWithdrawal,
  markWithdrawalPaid,
  completeWithdrawal,
  cancelWithdrawal,
  type WithdrawalRow,
} from '@/lib/bonusFinancialApi';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'معلّق', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  UNDER_REVIEW: { label: 'قيد المراجعة', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  APPROVED: { label: 'مقبول', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  REJECTED: { label: 'مرفوض', className: 'bg-red-50 text-red-700 border-red-200' },
  PAID: { label: 'مدفوع', className: 'bg-teal-50 text-teal-700 border-teal-200' },
  COMPLETED: { label: 'مكتمل', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  CANCELLED: { label: 'ملغي', className: 'bg-gray-100 text-gray-600 border-gray-200' },
};

const yer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmtDate = (v: string | null) => (v ? String(v).slice(0, 16).replace('T', ' ') : '—');

type SimpleAction = { kind: 'start' | 'approve' | 'complete' | 'cancel'; row: WithdrawalRow };
type InputAction = { kind: 'reject' | 'pay'; row: WithdrawalRow };

export function BonusWithdrawalsPage() {
  const [rows, setRows] = useState<WithdrawalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [detail, setDetail] = useState<WithdrawalRow | null>(null);
  const [simple, setSimple] = useState<SimpleAction | null>(null);
  const [inputAction, setInputAction] = useState<InputAction | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [inputValue2, setInputValue2] = useState('');
  const [busy, setBusy] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setRows(await listWithdrawals());
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'تعذر جلب طلبات السحب');
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

  const runSimple = async () => {
    if (!simple) return;
    setBusy(true);
    try {
      if (simple.kind === 'start') await startWithdrawalReview(simple.row.id);
      else if (simple.kind === 'approve') await approveWithdrawal(simple.row.id);
      else if (simple.kind === 'complete') await completeWithdrawal(simple.row.id);
      else await cancelWithdrawal(simple.row.id);
      showSuccess('تم تنفيذ العملية بنجاح.');
      setSimple(null);
      await fetchAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء تنفيذ العملية');
    } finally {
      setBusy(false);
    }
  };

  const runInput = async () => {
    if (!inputAction) return;
    if (!inputValue.trim()) {
      alert(
        inputAction.kind === 'reject' ? 'أدخل سبب الرفض — السبب إلزامي.' : 'أدخل مرجع الدفع — المرجع إلزامي.',
      );
      return;
    }
    setBusy(true);
    try {
      if (inputAction.kind === 'reject') {
        await rejectWithdrawal(inputAction.row.id, inputValue.trim());
        showSuccess('تم رفض الطلب مع تسجيل السبب.');
      } else {
        await markWithdrawalPaid(inputAction.row.id, inputValue.trim(), inputValue2.trim() || null);
        showSuccess('تم تسجيل الدفع بنجاح.');
      }
      setInputAction(null);
      setInputValue('');
      setInputValue2('');
      await fetchAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء تنفيذ العملية');
    } finally {
      setBusy(false);
    }
  };

  const filtered = rows.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (searchTerm && !(r.account_id ?? '').toLowerCase().includes(searchTerm.trim().toLowerCase()))
      return false;
    return true;
  });

  const pendingCount = rows.filter((r) => r.status === 'PENDING' || r.status === 'UNDER_REVIEW').length;

  const SIMPLE_META: Record<SimpleAction['kind'], { title: string; confirm: string; message: string }> = {
    start: {
      title: 'بدء مراجعة طلب السحب',
      confirm: 'بدء المراجعة',
      message: 'نقل الطلب إلى قيد المراجعة؟',
    },
    approve: {
      title: 'اعتماد طلب السحب',
      confirm: 'اعتماد',
      message: 'اعتماد هذا الطلب؟ سيتمكن المدير بعدها من تسجيل الدفع.',
    },
    complete: {
      title: 'إكمال طلب السحب',
      confirm: 'إكمال',
      message: 'وضع علامة مكتمل على هذا الطلب المدفوع؟',
    },
    cancel: {
      title: 'إلغاء طلب السحب',
      confirm: 'إلغاء الطلب',
      message: 'إلغاء هذا الطلب وتحرير المبلغ المحجوز؟',
    },
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">طلبات السحب النقدي</h2>
          <p className="text-muted-foreground text-sm">
            {pendingCount > 0 ? `${pendingCount} طلب بانتظار المراجعة` : 'دورة حياة السحب الكاملة من الطلب حتى الإكمال'}
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
              placeholder="بحث برقم الحساب..."
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
                  <th className="px-4 py-3 whitespace-nowrap text-center">المبلغ (ر.ي)</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">الحالة</th>
                  <th className="px-4 py-3 whitespace-nowrap">طريقة الدفع</th>
                  <th className="px-4 py-3 whitespace-nowrap">تاريخ الطلب</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => {
                  const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE.PENDING;
                  return (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-center font-bold" dir="ltr">
                        {yer.format(r.amount)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">{r.payment_method || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs" dir="ltr">
                        {fmtDate(r.requested_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1 flex-wrap">
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
                                onClick={() => setSimple({ kind: 'start', row: r })}
                                disabled={busy}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors disabled:opacity-50"
                              >
                                <Flag className="w-3.5 h-3.5" />
                                مراجعة
                              </button>
                              <button
                                type="button"
                                onClick={() => setSimple({ kind: 'cancel', row: r })}
                                disabled={busy}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 transition-colors disabled:opacity-50"
                              >
                                إلغاء
                              </button>
                            </>
                          )}
                          {r.status === 'UNDER_REVIEW' && (
                            <>
                              <button
                                type="button"
                                onClick={() => setSimple({ kind: 'approve', row: r })}
                                disabled={busy}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                                اعتماد
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setInputAction({ kind: 'reject', row: r });
                                  setInputValue('');
                                  setInputValue2('');
                                }}
                                disabled={busy}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-50"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                رفض
                              </button>
                              <button
                                type="button"
                                onClick={() => setSimple({ kind: 'cancel', row: r })}
                                disabled={busy}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 transition-colors disabled:opacity-50"
                              >
                                إلغاء
                              </button>
                            </>
                          )}
                          {r.status === 'APPROVED' && (
                            <button
                              type="button"
                              onClick={() => {
                                setInputAction({ kind: 'pay', row: r });
                                setInputValue('');
                                setInputValue2('');
                              }}
                              disabled={busy}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100 transition-colors disabled:opacity-50"
                            >
                              <Banknote className="w-3.5 h-3.5" />
                              تسجيل الدفع
                            </button>
                          )}
                          {r.status === 'PAID' && (
                            <button
                              type="button"
                              onClick={() => setSimple({ kind: 'complete', row: r })}
                              disabled={busy}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              إكمال
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                      لا توجد طلبات سحب مطابقة.
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
              <h3 className="font-bold text-lg">تفاصيل طلب السحب</h3>
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
                ['المبلغ (ر.ي)', yer.format(detail.amount)],
                ['الحالة', STATUS_BADGE[detail.status]?.label ?? detail.status],
                ['الحساب', detail.account_id],
                ['طريقة الدفع', detail.payment_method ?? '—'],
                ['مرجع الدفع', detail.payment_reference ?? '—'],
                ['الإيصال', detail.receipt_url ?? '—'],
                ['ملاحظات', detail.notes ?? '—'],
                ['سبب الرفض', detail.rejection_reason ?? '—'],
                ['طُلب', fmtDate(detail.requested_at)],
                ['روجِع', fmtDate(detail.reviewed_at)],
                ['اعتُمد', fmtDate(detail.approved_at)],
                ['دُفع', fmtDate(detail.paid_at)],
                ['القيد المرتبط', detail.ledger_id ?? '—'],
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

      {simple && (
        <ConfirmDialog
          isOpen
          onClose={() => {
            if (!busy) setSimple(null);
          }}
          onConfirm={() => void runSimple()}
          title={SIMPLE_META[simple.kind].title}
          message={`${SIMPLE_META[simple.kind].message} (المبلغ ${yer.format(simple.row.amount)} ر.ي)`}
          confirmLabel={SIMPLE_META[simple.kind].confirm}
        />
      )}

      {inputAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b bg-muted/20">
              <h3 className="font-bold text-lg">
                {inputAction.kind === 'reject' ? 'رفض طلب السحب' : 'تسجيل دفع طلب السحب'}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  {inputAction.kind === 'reject' ? 'سبب الرفض *' : 'مرجع الدفع *'}
                </label>
                <input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={inputAction.kind === 'reject' ? 'مثال: تجاوز الحد الشهري' : 'مثال: سند قبض #123'}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                />
              </div>
              {inputAction.kind === 'pay' && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">رابط الإيصال (اختياري)</label>
                  <input
                    value={inputValue2}
                    onChange={(e) => setInputValue2(e.target.value)}
                    placeholder="https://..."
                    dir="ltr"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left"
                  />
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!busy) {
                      setInputAction(null);
                      setInputValue('');
                      setInputValue2('');
                    }
                  }}
                  className="px-4 py-2 text-sm font-medium border rounded-lg hover:bg-muted"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={() => void runInput()}
                  disabled={busy}
                  className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-60"
                >
                  {busy ? 'جارٍ الحفظ...' : 'تأكيد'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
