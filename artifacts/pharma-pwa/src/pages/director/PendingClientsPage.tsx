import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, XCircle, UserCheck } from 'lucide-react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  listPendingClients,
  approveClient,
  rejectClient,
  type PendingClientRow,
} from '@/lib/clientApprovalApi';

const CLIENT_TYPE_LABEL: Record<string, string> = {
  pharmacy: 'صيدلية',
  hospital: 'مستشفى',
  clinic: 'عيادة',
  warehouse: 'مستودع',
  other: 'أخرى',
};

function clientTypeLabel(raw: string | null): string {
  if (!raw) return '—';
  return CLIENT_TYPE_LABEL[raw] ?? raw;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function PendingClientsPage() {
  const [clients, setClients] = useState<PendingClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [actionTarget, setActionTarget] = useState<{ client: PendingClientRow; action: 'approve' | 'reject' } | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setClients(await listPendingClients());
    } catch (err) {
      console.error(err);
      setError('تعذر جلب طلبات الانضمام. تأكد من تسجيل الدخول.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    window.setTimeout(() => setSuccessMsg(''), 4000);
  };

  const handleAction = async () => {
    if (!actionTarget) return;
    const { client, action } = actionTarget;
    setBusy(true);
    try {
      if (action === 'approve') {
        await approveClient(client.id);
        showSuccess(`تم قبول طلب "${client.org_name || client.name || client.email}" وتفعيل الحساب.`);
      } else {
        await rejectClient(client.id);
        showSuccess(`تم رفض طلب "${client.org_name || client.name || client.email}".`);
      }
      setClients((prev) => prev.filter((c) => c.id !== client.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء معالجة الطلب');
    } finally {
      setBusy(false);
      setActionTarget(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">طلبات الانضمام المعلّقة</h2>
        <p className="text-muted-foreground text-sm">
          مراجعة طلبات تسجيل العملاء الجدد — قبول أو رفض كل طلب.
        </p>
      </div>

      {successMsg && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
          {successMsg}
        </div>
      )}

      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <div className="p-4"><ErrorMessage message={error} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
                <tr>
                  <th className="px-4 py-3 whitespace-nowrap">اسم المنشأة</th>
                  <th className="px-4 py-3 whitespace-nowrap">النوع</th>
                  <th className="px-4 py-3 whitespace-nowrap">الهاتف</th>
                  <th className="px-4 py-3 whitespace-nowrap">المحافظة / المدينة</th>
                  <th className="px-4 py-3 whitespace-nowrap">تاريخ التسجيل</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {clients.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {c.org_name || c.name || '—'}
                      {c.email && (
                        <div className="text-xs text-muted-foreground font-normal" dir="ltr">
                          {c.email}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-blue-50 text-blue-700 border-blue-200">
                        <UserCheck className="w-3.5 h-3.5" />
                        {clientTypeLabel(c.client_type)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-left" dir="ltr">{c.phone || '—'}</td>
                    <td className="px-4 py-3">
                      {c.governorate || c.city || '—'}
                      {c.governorate && c.city ? ` — ${c.city}` : ''}
                    </td>
                    <td className="px-4 py-3">{formatDate(c.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => setActionTarget({ client: c, action: 'approve' })}
                          disabled={busy}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                        >
                          <CheckCircle className="w-4 h-4" />
                          قبول
                        </button>
                        <button
                          onClick={() => setActionTarget({ client: c, action: 'reject' })}
                          disabled={busy}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-50"
                        >
                          <XCircle className="w-4 h-4" />
                          رفض
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {clients.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      لا توجد طلبات انضمام معلّقة حالياً.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {actionTarget && (
        <ConfirmDialog
          isOpen
          onClose={() => setActionTarget(null)}
          onConfirm={handleAction}
          title={actionTarget.action === 'approve' ? 'قبول طلب انضمام' : 'رفض طلب انضمام'}
          message={
            actionTarget.action === 'approve'
              ? `هل أنت متأكد من قبول طلب "${actionTarget.client.org_name || actionTarget.client.name || actionTarget.client.email}"؟ سيتم تفعيل الحساب فوراً.`
              : `هل أنت متأكد من رفض طلب "${actionTarget.client.org_name || actionTarget.client.name || actionTarget.client.email}"؟ لن يتمكن من استخدام التطبيق.`
          }
          confirmLabel={actionTarget.action === 'approve' ? 'قبول' : 'رفض'}
        />
      )}
    </div>
  );
}