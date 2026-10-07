import { useCallback, useEffect, useMemo, useState } from 'react';
import { listAudit, loadUserNames, type AuditRow } from '@/lib/bonusFinancialApi';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';

function fmtDate(v?: string | null): string {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return v;
  }
}

function prettyValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function SettingsChangeLogSection() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const all = await listAudit(300);
      const settingsRows = all.filter((r) => r.entity === 'bonus_settings');
      setRows(settingsRows);
      const actorIds = Array.from(new Set(settingsRows.map((r) => r.actor).filter(Boolean) as string[]));
      setNames(await loadUserNames(actorIds));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'تعذر تحميل سجل تغييرات الإعدادات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.entity_id ?? '').toLowerCase().includes(q) ||
        (r.action ?? '').toLowerCase().includes(q) ||
        (r.reference ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-muted-foreground">
        <LoadingSpinner />
        <span>جارٍ تحميل سجل التغييرات…</span>
      </div>
    );
  }
  if (error) return <ErrorMessage message={error} />;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xl font-bold">سجل تغييرات إعدادات البونص</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          سجل غير قابل للتعديل (append-only) لكل تغيير طُبَّق على إعدادات البونص.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث بالمفتاح أو الإجراء أو المرجع..."
          className="w-full max-w-md border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
        />
        <span className="text-xs text-muted-foreground">{filtered.length} سجل</span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">لا توجد تغييرات إعدادات مسجلة بعد.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/30 text-xs font-semibold text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-right">الوقت</th>
                <th className="px-3 py-2 text-right">المُعدّ</th>
                <th className="px-3 py-2 text-right">المفتاح</th>
                <th className="px-3 py-2 text-right">الإجراء</th>
                <th className="px-3 py-2 text-right">من</th>
                <th className="px-3 py-2 text-right">إلى</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr key={r.id} className="odd:bg-card even:bg-muted/10">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.at_time)}</td>
                  <td className="px-3 py-2">{r.actor ? (names[r.actor] ?? r.actor) : '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    {r.entity_id ?? '—'}
                  </td>
                  <td className="px-3 py-2">{r.action ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    <span
                      className="block max-w-[220px] cursor-help truncate"
                      title={prettyValue(r.old_value)}
                    >
                      {prettyValue(r.old_value)}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    <span
                      className="block max-w-[220px] cursor-help truncate"
                      title={prettyValue(r.new_value)}
                    >
                      {prettyValue(r.new_value)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
