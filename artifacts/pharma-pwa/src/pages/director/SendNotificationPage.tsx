import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Send, Search, X, Check } from 'lucide-react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import {
  listUsersByRole,
  listSentNotifications,
  sendNotification,
  type TargetUserRow,
  type SentNotificationRow,
} from '@/lib/sendNotificationApi';

const ROLE_OPTIONS = [
  { value: 'client', label: 'عميل' },
  { value: 'branch_manager', label: 'مدير فرع' },
  { value: 'driver', label: 'مندوب' },
] as const;

const SCOPE_OPTIONS = [
  { value: 'all', label: 'الكل ضمن هذا الدور' },
  { value: 'group', label: 'مجموعة محددة' },
  { value: 'single', label: 'فرد واحد' },
] as const;

function roleLabel(value: string | null): string {
  const opt = ROLE_OPTIONS.find((o) => o.value === value);
  return opt?.label ?? '—';
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('ar', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function SendNotificationPage() {
  const [role, setRole] = useState<string>('');
  const [scope, setScope] = useState<string>('all');
  const [users, setUsers] = useState<TargetUserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [log, setLog] = useState<SentNotificationRow[]>([]);
  const [loadingLog, setLoadingLog] = useState(true);
  const [logError, setLogError] = useState('');

  const loadLog = useCallback(async () => {
    try {
      setLoadingLog(true);
      setLogError('');
      setLog(await listSentNotifications());
    } catch (err) {
      console.error(err);
      setLogError('تعذر جلب سجل الإشعارات المرسلة.');
    } finally {
      setLoadingLog(false);
    }
  }, []);

  useEffect(() => { loadLog(); }, [loadLog]);

  // تحميل مستخدمي الدور عند الحاجة (نطاق غير "الكل")
  useEffect(() => {
    if (!role || scope === 'all') return;
    let cancelled = false;
    (async () => {
      try {
        setLoadingUsers(true);
        const rows = await listUsersByRole(role);
        if (!cancelled) setUsers(rows);
      } catch (err) {
        console.error(err);
        if (!cancelled) setUsers([]);
      } finally {
        if (!cancelled) setLoadingUsers(false);
      }
    })();
    return () => { cancelled = true; };
  }, [role, scope]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      (u.name ?? '').toLowerCase().includes(q) ||
      (u.phone ?? '').toLowerCase().includes(q) ||
      (u.branch_name ?? '').toLowerCase().includes(q),
    );
  }, [users, query]);

  const selectedUsers = useMemo(
    () => users.filter((u) => selected.has(u.id)),
    [users, selected],
  );

  const toggleUser = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (scope === 'single') {
        next.clear();
        next.add(id);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSend = async () => {
    if (!role) {
      alert('اختر الدور المستهدف أولاً.');
      return;
    }
    if (!title.trim() || !body.trim()) {
      alert('أدخل عنوان الإشعار ونصّه.');
      return;
    }
    if (scope === 'group' && selected.size < 1) {
      alert('اختر مستخدماً واحداً على الأقل.');
      return;
    }
    if (scope === 'single' && selected.size !== 1) {
      alert('اختر مستخدماً واحداً بالضبط.');
      return;
    }
    setBusy(true);
    try {
      await sendNotification({
        title: title.trim(),
        body: body.trim(),
        targetRole: role,
        targetUserIds: scope === 'all' ? [] : Array.from(selected),
      });
      setSuccessMsg('تم إرسال الإشعار بنجاح.');
      setTitle('');
      setBody('');
      setQuery('');
      setSelected(new Set());
      await loadLog();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء إرسال الإشعار');
    } finally {
      setBusy(false);
    }
  };

  const needSelection = scope !== 'all';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">إرسال إشعار</h2>
        <p className="text-muted-foreground text-sm">
          أرسل إشعاراً لجميع مستخدمي دور معيّن، أو لمجموعة محددة، أو لفرد واحد.
        </p>
      </div>

      {successMsg && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
          {successMsg}
        </div>
      )}

      {/* الخطوة 1: الدور المستهدف */}
      <div className="bg-card border rounded-xl shadow-sm p-5">
        <h3 className="font-bold text-foreground mb-1">الخطوة 1: اختر الدور المستهدف</h3>
        <p className="text-sm text-muted-foreground mb-4">الإشعار سيصل للمستخدمين من هذا الدور فقط.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {ROLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setRole(opt.value);
                setSelected(new Set());
                setQuery('');
              }}
              className={`flex items-center justify-between gap-2 border rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                role === opt.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-foreground hover:bg-muted'
              }`}
            >
              <span>{opt.label}</span>
              <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${role === opt.value ? 'border-primary' : 'border-muted-foreground/40'}`}>
                {role === opt.value && <Check className="w-3 h-3 text-primary" />}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* الخطوة 2: نطاق الإرسال */}
      <div className="bg-card border rounded-xl shadow-sm p-5 space-y-4">
        <div>
          <h3 className="font-bold text-foreground mb-1">الخطوة 2: نطاق الإرسال</h3>
          <p className="text-sm text-muted-foreground">حدّد من سيستلم الإشعار.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {SCOPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setScope(opt.value);
                setSelected(new Set());
                setQuery('');
              }}
              className={`flex items-center justify-between gap-2 border rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                scope === opt.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-foreground hover:bg-muted'
              }`}
            >
              <span>{opt.label}</span>
              <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${scope === opt.value ? 'border-primary' : 'border-muted-foreground/40'}`}>
                {scope === opt.value && <Check className="w-3 h-3 text-primary" />}
              </span>
            </button>
          ))}
        </div>

        {needSelection && (
          <div className="border-t pt-4">
            {!role ? (
              <p className="text-sm text-muted-foreground">اختر الدور المستهدف أولاً لعرض المستخدمين.</p>
            ) : loadingUsers ? (
              <LoadingSpinner />
            ) : (
              <>
                <div className="flex flex-wrap gap-2 mb-3">
                  {selectedUsers.length === 0 ? (
                    <span className="text-sm text-muted-foreground">
                      {scope === 'single'
                        ? 'اختر مستخدماً واحداً بالضبط.'
                        : 'اختر مستخدماً واحداً أو أكثر من القائمة.'}
                    </span>
                  ) : (
                    selectedUsers.map((u) => (
                      <span key={u.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-primary/10 text-primary border-primary/30">
                        {u.name || u.phone || 'مستخدم'}
                        <button
                          type="button"
                          onClick={() => toggleUser(u.id)}
                          className="hover:text-destructive"
                          aria-label="إزالة"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))
                  )}
                  <span className="text-xs text-muted-foreground self-center">
                    (المحدد: {selected.size})
                  </span>
                </div>

                <div className="relative mb-3">
                  <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="ابحث بالاسم أو الهاتف أو الفرع..."
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary bg-background pr-9"
                  />
                </div>

                {users.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا يوجد مستخدمون بهذا الدور بعد.</p>
                ) : filteredUsers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد نتائج مطابقة للبحث.</p>
                ) : (
                  <div className="border rounded-lg overflow-hidden max-h-64 overflow-y-auto divide-y divide-border">
                    {filteredUsers.map((u) => {
                      const isSelected = selected.has(u.id);
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => toggleUser(u.id)}
                          className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-right text-sm transition-colors ${
                            isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'
                          }`}
                        >
                          <span className="flex-1 min-w-0">
                            <span className="block font-medium text-foreground truncate">
                              {u.name || '—'}
                              {u.branch_name && (
                                <span className="text-xs text-muted-foreground font-normal"> — {u.branch_name}</span>
                              )}
                            </span>
                            {u.phone && (
                              <span className="block text-xs text-muted-foreground" dir="ltr">
                                {u.phone}
                              </span>
                            )}
                          </span>
                          <span className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${
                            isSelected ? 'bg-primary border-primary text-white' : 'border-muted-foreground/40'
                          }`}>
                            {isSelected && <Check className="w-3.5 h-3.5" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* الخطوة 3: العنوان والنص */}
      <div className="bg-card border rounded-xl shadow-sm p-5 space-y-4">
        <div>
          <h3 className="font-bold text-foreground mb-1">الخطوة 3: العنوان والنص</h3>
          <p className="text-sm text-muted-foreground">اكتب محتوى الإشعار ثم أرسله.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">عنوان الإشعار</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            placeholder="مثال: عرض حصري اليوم فقط"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary bg-background"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">نص الإشعار</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder="اكتب نص الإشعار هنا..."
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary bg-background resize-none"
          />
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button
            type="button"
            onClick={handleSend}
            disabled={busy}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {busy ? <LoadingSpinner /> : <Send className="w-4 h-4" />}
            إرسال الإشعار
          </button>
        </div>
      </div>

      {/* سجل آخر 20 إشعاراً مُرسلاً */}
      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b bg-muted/20 flex items-center gap-2.5">
          <Bell className="w-4 h-4 text-primary" />
          <h3 className="font-bold text-foreground">آخر الإشعارات المُرسلة (آخر 20)</h3>
        </div>
        {loadingLog ? (
          <div className="p-6"><LoadingSpinner /></div>
        ) : logError ? (
          <div className="p-4"><ErrorMessage message={logError} /></div>
        ) : log.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground text-sm">لا توجد إشعارات مرسلة بعد.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
                <tr>
                  <th className="px-4 py-2.5 whitespace-nowrap">النطاق</th>
                  <th className="px-4 py-2.5 whitespace-nowrap">الدور</th>
                  <th className="px-4 py-2.5 whitespace-nowrap">العنوان</th>
                  <th className="px-4 py-2.5 whitespace-nowrap">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {log.map((n) => (
                  <tr key={n.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {n.target_user_ids.length > 0 ? (
                        <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium border bg-blue-50 text-blue-700 border-blue-200">
                          {n.target_user_ids.length} محدد
                        </span>
                      ) : (
                        <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium border bg-emerald-50 text-emerald-700 border-emerald-200">
                          الكل
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {n.target_user_ids.length > 0 ? 'محددون' : roleLabel(n.target_role)}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-foreground">{n.title || '—'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{formatDateTime(n.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
