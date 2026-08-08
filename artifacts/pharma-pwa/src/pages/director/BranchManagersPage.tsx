import { useCallback, useEffect, useState } from 'react';
import { Search, Plus, Users, KeyRound, CheckCircle, XCircle, ShieldCheck, ShieldOff } from 'lucide-react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  listBranchManagers,
  listBranches,
  createBranchManager,
  updateBranchManagerStatus,
  resetBranchManagerPassword,
  type BranchManagerRow,
  type BranchRow,
} from '@/lib/branchManagerApi';

interface CreateForm {
  name: string;
  email: string;
  phone: string;
  password: string;
  branchId: string;
}

const EMPTY_FORM: CreateForm = { name: '', email: '', phone: '', password: '', branchId: '' };

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  active: { label: 'نشط', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  suspended: { label: 'موقوف', className: 'bg-red-50 text-red-700 border-red-200' },
  pending_approval: { label: 'قيد المراجعة', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  rejected: { label: 'مرفوض', className: 'bg-gray-100 text-gray-600 border-gray-200' },
};

export function BranchManagersPage() {
  const [managers, setManagers] = useState<BranchManagerRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_FORM);
  const [createBusy, setCreateBusy] = useState(false);

  const [statusTarget, setStatusTarget] = useState<BranchManagerRow | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const [resetTarget, setResetTarget] = useState<BranchManagerRow | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [m, b] = await Promise.all([listBranchManagers(), listBranches()]);
      setManagers(m);
      setBranches(b);
    } catch (err) {
      console.error(err);
      setError('تعذر جلب بيانات مدراء الفروع. تأكد من تسجيل الدخول.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    window.setTimeout(() => setSuccessMsg(''), 4000);
  };

  const branchNameOf = (m: BranchManagerRow): string =>
    (m.branch_name as string) ??
    (branches.find((b) => b.id === m.branch_id)?.name as string) ??
    '—';

  const filtered = managers.filter((m) => {
    if (statusFilter && m.account_status !== statusFilter) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const name = (m.name ?? '').toLowerCase();
      const email = m.email.toLowerCase();
      if (!name.includes(q) && !email.includes(q)) return false;
    }
    return true;
  });

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCreateBusy(true);
    try {
      await createBranchManager({
        name: createForm.name,
        email: createForm.email,
        phone: createForm.phone,
        password: createForm.password,
        branchId: createForm.branchId || undefined,
      });
      setIsCreateOpen(false);
      setCreateForm(EMPTY_FORM);
      showSuccess('تم إنشاء حساب مدير الفرع بنجاح.');
      await fetchAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء إنشاء الحساب');
    } finally {
      setCreateBusy(false);
    }
  };

  const handleStatusToggle = async (m: BranchManagerRow) => {
    const next = m.account_status === 'active' ? 'suspended' : 'active';
    setStatusBusy(true);
    try {
      await updateBranchManagerStatus(m.id, next);
      showSuccess(next === 'active' ? 'تم تفعيل الحساب.' : 'تم إيقاف الحساب.');
      setManagers((prev) =>
        prev.map((x) => (x.id === m.id ? { ...x, account_status: next } : x)),
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء تحديث الحالة');
    } finally {
      setStatusBusy(false);
      setStatusTarget(null);
    }
  };

  const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!resetTarget) return;
    setResetBusy(true);
    try {
      await resetBranchManagerPassword(resetTarget.id, newPassword);
      setResetTarget(null);
      setNewPassword('');
      showSuccess('تم إعادة تعيين كلمة المرور. سيُطلب من المدير تغييرها عند أول تسجيل دخول.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء إعادة تعيين كلمة المرور');
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">إدارة حسابات مدراء الفروع</h2>
          <p className="text-muted-foreground text-sm">إنشاء وتفعيل وإدارة حسابات مدراء الفروع</p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          إضافة مدير فرع
        </button>
      </div>

      {successMsg && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
          {successMsg}
        </div>
      )}

      <div className="bg-card border rounded-xl shadow-sm">
        <div className="p-4 border-b flex flex-col sm:flex-row gap-4 items-center bg-muted/20">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute right-3 top-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="بحث بالاسم أو البريد الإلكتروني..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-3 pr-10 py-2 border rounded-lg bg-background text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border rounded-lg bg-background px-3 py-2 text-sm w-full sm:w-auto focus:ring-2 focus:ring-primary"
          >
            <option value="">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="suspended">موقوف</option>
            <option value="pending_approval">قيد المراجعة</option>
          </select>
        </div>

        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <div className="p-4"><ErrorMessage message={error} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
                <tr>
                  <th className="px-4 py-3 whitespace-nowrap">الاسم</th>
                  <th className="px-4 py-3 whitespace-nowrap">البريد الإلكتروني</th>
                  <th className="px-4 py-3 whitespace-nowrap">الهاتف</th>
                  <th className="px-4 py-3 whitespace-nowrap">الفرع</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">الحالة</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((m) => {
                  const badge = STATUS_BADGE[m.account_status] ?? STATUS_BADGE.pending_approval;
                  return (
                    <tr key={m.id} className={`hover:bg-muted/30 transition-colors ${m.account_status !== 'active' ? 'opacity-70 bg-muted/10' : ''}`}>
                      <td className="px-4 py-3 font-medium text-foreground">
                        <div className="flex flex-col">
                          <span className="flex items-center gap-1.5">
                            {m.name || '—'}
                            {m.requires_password_change && (
                              <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                                <KeyRound className="w-3 h-3" /> تغيير كلمة المرور مطلوب
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-left" dir="ltr">{m.email}</td>
                      <td className="px-4 py-3 text-left" dir="ltr">{m.phone || '—'}</td>
                      <td className="px-4 py-3">{branchNameOf(m)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${badge.className}`}>
                          {m.account_status === 'active' ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => setStatusTarget(m)}
                            disabled={statusBusy}
                            className="p-1.5 rounded transition-colors hover:bg-muted disabled:opacity-50"
                            title={m.account_status === 'active' ? 'إيقاف الحساب' : 'تفعيل الحساب'}
                          >
                            {m.account_status === 'active' ? (
                              <XCircle className="w-4 h-4 text-red-600" />
                            ) : (
                              <CheckCircle className="w-4 h-4 text-emerald-600" />
                            )}
                          </button>
                          <button
                            onClick={() => { setResetTarget(m); setNewPassword(''); }}
                            disabled={statusBusy}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50"
                            title="إعادة تعيين كلمة المرور"
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      لا يوجد مدراء فروع مطابقون.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-lg my-8 animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b flex justify-between items-center bg-muted/20">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                إضافة مدير فرع جديد
              </h3>
              <button onClick={() => setIsCreateOpen(false)} className="text-muted-foreground hover:text-foreground">
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">اسم المدير *</label>
                <input
                  required
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder="مثال: أحمد محمد"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">البريد الإلكتروني *</label>
                <input
                  required
                  type="email"
                  dir="ltr"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  placeholder="manager@example.com"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">رقم الهاتف</label>
                  <input
                    dir="ltr"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left"
                    value={createForm.phone}
                    onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
                    placeholder="7XXXXXXXX"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">الفرع</label>
                  <select
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                    value={createForm.branchId}
                    onChange={(e) => setCreateForm({ ...createForm, branchId: e.target.value })}
                  >
                    <option value="">بدون فرع</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}{b.governorate ? ` — ${b.governorate}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">كلمة المرور المؤقتة * (6 أحرف على الأقل)</label>
                <input
                  required
                  minLength={6}
                  dir="ltr"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  placeholder="كلمة المرور"
                />
                <p className="text-xs text-muted-foreground">
                  سيُطلب من المدير تغيير كلمة المرور عند أول تسجيل دخول.
                </p>
              </div>

              <div className="mt-6 flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 text-sm font-medium border rounded-lg hover:bg-muted"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={createBusy}
                  className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-60"
                >
                  {createBusy ? 'جارٍ الإنشاء...' : 'إنشاء الحساب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Status toggle confirm */}
      {statusTarget && (
        <ConfirmDialog
          isOpen
          onClose={() => setStatusTarget(null)}
          onConfirm={() => handleStatusToggle(statusTarget)}
          title={statusTarget.account_status === 'active' ? 'إيقاف حساب مدير فرع' : 'تفعيل حساب مدير فرع'}
          message={
            statusTarget.account_status === 'active'
              ? `هل أنت متأكد من إيقاف حساب "${statusTarget.name || statusTarget.email}"؟ لن يتمكن من تسجيل الدخول أو إدارة الفرع.`
              : `هل أنت متأكد من تفعيل حساب "${statusTarget.name || statusTarget.email}"؟`
          }
          confirmLabel={statusTarget.account_status === 'active' ? 'إيقاف' : 'تفعيل'}
        />
      )}

      {/* Reset password modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b flex justify-between items-center bg-muted/20">
              <h3 className="font-bold text-lg">إعادة تعيين كلمة المرور</h3>
              <button onClick={() => setResetTarget(null)} className="text-muted-foreground hover:text-foreground">
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleResetPassword} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">الحساب</label>
                <div className="text-sm text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 border">
                  {resetTarget.name || resetTarget.email} — {resetTarget.email}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">كلمة المرور الجديدة * (6 أحرف على الأقل)</label>
                <input
                  required
                  minLength={6}
                  dir="ltr"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="كلمة المرور الجديدة"
                />
                <p className="text-xs text-muted-foreground">
                  سيُطلب من المدير تغييرها عند أول تسجيل دخول.
                </p>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="px-4 py-2 text-sm font-medium border rounded-lg hover:bg-muted"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={resetBusy}
                  className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-60"
                >
                  {resetBusy ? 'جارٍ الحفظ...' : 'إعادة التعيين'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
