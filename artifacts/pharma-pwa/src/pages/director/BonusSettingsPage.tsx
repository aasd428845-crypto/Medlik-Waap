import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Save, Settings2 } from 'lucide-react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { listSettings, updateSetting, type SettingRow } from '@/lib/bonusFinancialApi';

const KEY_LABEL: Record<string, { title: string; hint: string }> = {
  redemption_methods: {
    title: 'طرق الاسترداد المسموحة',
    hint: 'مفاتيح منطقية: product / discount / cash',
  },
  withdrawal_policy: {
    title: 'سياسة السحب النقدي',
    hint: 'مثال: enabled, approval_required, min_amount, max_amount, monthly_max',
  },
  notifications: {
    title: 'إشعارات البونص',
    hint: 'تفضيلات الإشعارات حسب الحدث',
  },
  currency: {
    title: 'العملة',
    hint: 'رمز العملة المستخدمة في المحفظة',
  },
};

function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v ?? '');
  }
}

export function BonusSettingsPage() {
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState('');
  const [busy, setBusy] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setRows(await listSettings());
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'تعذر جلب الإعدادات');
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

  const startEdit = (row: SettingRow) => {
    setEditingKey(row.key);
    setDraft(prettyJson(row.value));
    setDraftError('');
  };

  const handleSave = async (key: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch {
      setDraftError('الصيغة ليست JSON صالحًا — راجع الأقواس والفواصل.');
      return;
    }
    setBusy(true);
    try {
      await updateSetting(key, parsed);
      showSuccess(`تم حفظ الإعداد "${key}" بنجاح.`);
      setEditingKey(null);
      await fetchAll();
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'حدث خطأ أثناء الحفظ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">إعدادات البونص المالية</h2>
          <p className="text-muted-foreground text-sm">
            المفاتيح الموجودة في قاعدة البيانات فقط — لا تُنشأ مفاتيح جديدة من هنا
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

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorMessage message={error} />
      ) : rows.length === 0 ? (
        <div className="bg-card border rounded-xl p-10 text-center text-sm text-muted-foreground">
          لا توجد إعدادات بونص مسجلة بعد.
        </div>
      ) : (
        <div className="grid gap-4">
          {rows.map((row) => {
            const meta = KEY_LABEL[row.key];
            const isEditing = editingKey === row.key;
            return (
              <section key={row.key} className="director-panel rounded-2xl p-5 md:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Settings2 className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="font-extrabold">{meta?.title ?? row.key}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground" dir="ltr">
                        {row.key}
                        {meta ? ` — ${meta.hint}` : ''}
                      </p>
                    </div>
                  </div>
                  {!isEditing && (
                    <button
                      type="button"
                      onClick={() => startEdit(row)}
                      className="px-4 py-2 text-sm font-medium border rounded-lg hover:bg-muted shrink-0"
                    >
                      تعديل
                    </button>
                  )}
                </div>

                {isEditing ? (
                  <div className="mt-4 space-y-3">
                    <textarea
                      rows={6}
                      dir="ltr"
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        setDraftError('');
                      }}
                      spellCheck={false}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs focus:ring-2 focus:ring-primary"
                    />
                    {draftError && <ErrorMessage message={draftError} />}
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setEditingKey(null)}
                        className="px-4 py-2 text-sm font-medium border rounded-lg hover:bg-muted"
                      >
                        إلغاء
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSave(row.key)}
                        disabled={busy}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-60"
                      >
                        <Save className="h-4 w-4" />
                        {busy ? 'جارٍ الحفظ...' : 'حفظ'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <pre className="mt-4 rounded-lg bg-muted/50 p-3 text-xs overflow-x-auto" dir="ltr">
                    {prettyJson(row.value)}
                  </pre>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  آخر تحديث: <span dir="ltr">{String(row.updated_at).slice(0, 16).replace('T', ' ')}</span>
                </p>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
