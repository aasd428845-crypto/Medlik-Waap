import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, XCircle, CheckCircle, Trash2, Search, Layers } from 'lucide-react';
import {
  listBonusRules,
  setBonusRuleActive,
  deleteBonusRule,
  type BonusRuleRow,
} from '@/lib/bonusRulesApi';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';

interface Props {
  compact?: boolean;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function ruleStatus(r: BonusRuleRow): { label: string; cls: string } {
  const today = todayStr();
  if (!r.is_active) return { label: 'موقوف', cls: 'bg-red-50 text-red-700 border-red-200' };
  if (r.end_date && String(r.end_date).slice(0, 10) < today) {
    return { label: 'منتهي', cls: 'bg-gray-100 text-gray-600 border-gray-200' };
  }
  if (r.start_date && String(r.start_date).slice(0, 10) > today) {
    return { label: 'قادم', cls: 'bg-blue-50 text-blue-700 border-blue-200' };
  }
  return { label: 'نشط', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
}

export function BonusRulesPanel({ compact = false }: Props) {
  const [rules, setRules] = useState<BonusRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const [toggleTarget, setToggleTarget] = useState<BonusRuleRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BonusRuleRow | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchAll = async () => {
    try {
      setLoading(true);
      setError('');
      setRules(await listBonusRules());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر جلب قواعد البونص');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    window.setTimeout(() => setSuccessMsg(''), 4000);
  };

  const handleToggle = async (r: BonusRuleRow) => {
    setBusy(true);
    try {
      await setBonusRuleActive(r.id, !r.is_active);
      showSuccess(r.is_active ? 'تم إيقاف القاعدة.' : 'تم تفعيل القاعدة.');
      await fetchAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء تغيير حالة القاعدة');
    } finally {
      setBusy(false);
      setToggleTarget(null);
    }
  };

  const handleDelete = async (r: BonusRuleRow) => {
    setBusy(true);
    try {
      await deleteBonusRule(r.id);
      showSuccess('تم حذف القاعدة.');
      await fetchAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء حذف القاعدة');
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  };

  const filtered = rules.filter((r) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (r.product_name ?? 'جميع الأصناف').toLowerCase().includes(q);
  });

  return (
    <div className="bg-card border rounded-xl shadow-sm">
      <div className="p-4 border-b bg-muted/20">
        <div className="relative max-w-sm">
          <Search className="w-4 h-4 absolute right-3 top-2.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="بحث عن قاعدة بونص..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-3 pr-10 py-2 border rounded-lg bg-background text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>
      </div>

      {successMsg && (
        <div className="mx-4 mt-4 rounded-md bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-sm text-emerald-700">
          {successMsg}
        </div>
      )}

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <div className="p-4"><ErrorMessage message={error} /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap">الصنف</th>
                <th className="px-4 py-3 whitespace-nowrap">القاعدة</th>
                {!compact && <th className="px-4 py-3 whitespace-nowrap text-center">التراكم</th>}
                {!compact && <th className="px-4 py-3 whitespace-nowrap">الفترة</th>}
                {!compact && <th className="px-4 py-3 whitespace-nowrap">المحافظة</th>}
                <th className="px-4 py-3 whitespace-nowrap text-center">الحالة</th>
                <th className="px-4 py-3 whitespace-nowrap text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => {
                const status = ruleStatus(r);
                return (
                  <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {r.product_name || 'جميع الأصناف'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-foreground">
                        اشترِ {r.buy_quantity} واحصل على {r.free_quantity} مجاناً
                      </span>
                    </td>
                    {!compact && (
                      <td className="px-4 py-3 text-center">
                        {r.is_stackable ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full">
                            <Layers className="w-3 h-3" /> نعم
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">لا</span>
                        )}
                      </td>
                    )}
                    {!compact && (
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {r.start_date ? String(r.start_date).slice(0, 10) : '—'}
                        {r.end_date ? ` ← ${String(r.end_date).slice(0, 10)}` : ''}
                      </td>
                    )}
                    {!compact && (
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.target_governorate || 'الكل'}
                      </td>
                    )}
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${status.cls}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <Link
                          to={`/director/bonus-rules/${r.id}/edit`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
                          title="تعديل القاعدة"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          تعديل
                        </Link>
                        <button
                          onClick={() => setToggleTarget(r)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50"
                          title={r.is_active ? 'إيقاف القاعدة' : 'تفعيل القاعدة'}
                        >
                          {r.is_active ? (
                            <>
                              <XCircle className="w-3.5 h-3.5 text-red-600" />
                              <span className="text-red-700">إيقاف</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="text-emerald-700">تفعيل</span>
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => setDeleteTarget(r)}
                          disabled={busy}
                          className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                          title="حذف القاعدة"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={compact ? 4 : 7} className="px-4 py-8 text-center text-muted-foreground">
                    {rules.length === 0 ? 'لا توجد قواعد بونص حتى الآن.' : 'لا توجد نتائج مطابقة.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {toggleTarget && (
        <ConfirmDialog
          isOpen
          onClose={() => setToggleTarget(null)}
          onConfirm={() => handleToggle(toggleTarget)}
          title={toggleTarget.is_active ? 'إيقاف القاعدة' : 'تفعيل القاعدة'}
          message={
            toggleTarget.is_active
              ? `هل أنت متأكد من إيقاف قاعدة "اشترِ ${toggleTarget.buy_quantity} واحصل على ${toggleTarget.free_quantity} مجاناً"؟ لن تُطبَّق حتى تُفعَّل مجدداً.`
              : `هل أنت متأكد من تفعيل قاعدة "اشترِ ${toggleTarget.buy_quantity} واحصل على ${toggleTarget.free_quantity} مجاناً"؟`
          }
          confirmLabel={toggleTarget.is_active ? 'إيقاف' : 'تفعيل'}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          isOpen
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => handleDelete(deleteTarget)}
          title="حذف القاعدة"
          message={`هل أنت متأكد من حذف قاعدة "اشترِ ${deleteTarget.buy_quantity} واحصل على ${deleteTarget.free_quantity} مجاناً" نهائياً؟ لا يمكن التراجع عن هذه الخطوة.`}
          confirmLabel="حذف"
        />
      )}
    </div>
  );
}
