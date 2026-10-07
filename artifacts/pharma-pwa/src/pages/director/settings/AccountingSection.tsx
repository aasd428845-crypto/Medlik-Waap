import { useCallback, useEffect, useState } from 'react';
import { Loader2, Check, Clock, AlertTriangle } from 'lucide-react';
import {
  ACCOUNTING_POLICIES,
  type AccountingPolicy,
  type PolicyOption,
} from '@/lib/accountingPolicies';
import { useBonusSettings } from '@/hooks/useBonusSettings';
import { loadUserNames, type SettingRow } from '@/lib/bonusFinancialApi';
import { ErrorMessage } from '@/components/ErrorMessage';

/**
 * 📜 سياسات المحاسبية للبونص — BD-01 .. BD-10.
 *
 * ⚠️ UI-ONLY — these are SELECTED POLICIES, NOT APPLIED ACCOUNTING.
 *
 * Each choice is persisted under `accounting_policy.<id>` in `bonus_settings`
 * (e.g. `accounting_policy.BD-01` = "A") via the existing upsert path. No new
 * table, no migration. Selecting a policy changes no ledger behaviour today —
 * it is a documented source of truth for the future accounting-posting layer.
 *
 * Audit-trail gap (do not paper over; do not invent a parallel audit table):
 * `bonus_settings` has NO update trigger, and `bonus_audit_trail` has no INSERT
 * policy (only SELECT policies), so a policy selection is NOT auto-logged to
 * the audit trail. Bridging that gap requires a migration-level addition that
 * is explicitly out of scope here. See `accountingPolicies.ts` for the full note.
 *
 * NONE of this writes journal entries, posts to a GL, creates a GL account, or
 * executes debit/credit flows. Actual posting lives in a separate authorised
 * layer out of scope for this task.
 */

function formatDateTime(iso: string | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat('ar-EG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  } catch {
    return iso;
  }
}

/** Resolve the `updated_by` uuids of accounting_policy.* rows to display names. */
function usePolicyActorNames(settings: SettingRow[] | null): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!settings) return;
    const actors = Array.from(
      new Set(
        settings
          .filter((s) => s.key.startsWith('accounting_policy.') && s.updated_by)
          .map((s) => s.updated_by as string),
      ),
    );
    if (actors.length === 0) {
      setNames({});
      return;
    }
    loadUserNames(actors).then(setNames).catch(() => setNames({}));
  }, [settings]);
  return names;
}

function labelForValue(value: string | null): string {
  return typeof value === 'string' && value ? `الخيار ${value}` : 'لا شيء محدد';
}

export function AccountingSection() {
  const {
    settings,
    loading,
    error,
    getValue,
    save,
    savingKey,
    lastSavedKey,
  } = useBonusSettings();
  const actorNames = usePolicyActorNames(settings);
  const [localSaveError, setLocalSaveError] = useState('');

  const handleChange = useCallback(
    async (policy: AccountingPolicy, option: PolicyOption) => {
      const key = `accounting_policy.${policy.id}`;
      setLocalSaveError('');
      try {
        await save(key, option.value);
      } catch (err) {
        setLocalSaveError(
          err instanceof Error ? err.message : 'تعذر حفظ هذه السياسة.',
        );
      }
    },
    [save],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>جارٍ تحميل سياسات البونص…</span>
      </div>
    );
  }
  if (error) return <ErrorMessage message={error} />;

  return (
    <div className="space-y-6" dir="rtl">
      {/* ── Page header (the layout already prints the control-center title) ─ */}
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight">سياسات المحاسبية للبونص</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          اختر سياسة كل عملية حسب سياسة الشركة
        </p>
      </div>

      {/* ── Scope / caveats ─────────────────────────────────────────────── */}
      <div className="rounded-lg border border-amber-200 bg-amber-50/30 p-3 text-xs text-amber-800">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-800/80" />
          <div>
            <p className="font-semibold">
              هذه اللوحـة اختيار سياسات فقط — UI-only، بدون أي توثيق محاسبي.
            </p>
            <p className="mt-1">
              الاختيار يُخزن كـ{' '}
              <code className="rounded bg-amber-100/70 px-1 py-0.5">accounting_policy.&lt;BD-XX&gt;</code>{' '}
              في{' '}
              <code className="rounded bg-amber-100/70 px-1 py-0.5">bonus_settings</code>، ولا يُغيّر
              سلوك عملية البونص — مرجع موثّق لطبقة المحاسبة المستقبلية فقط. لا توجد
              إدخالات يومية ولا حسابات عامة ولا إرسال إلى GL ولا عمليات خصم/إجراء مدين.
            </p>
            <p className="mt-1">
              تنويه توثيقي: كتابة <code className="rounded bg-amber-100/70 px-1 py-0.5">bonus_settings</code> لا تُسجَّل
              تلقائياً في{' '}
              <code className="rounded bg-amber-100/70 px-1 py-0.5">bonus_audit_trail</code> — لا مشغل تحديث على
              الجدول، ولا إذن للكتابة من العميل. الاختيار يُحفظ ويُعاد تحميله، لكنه لن
              يظهر في سجل التوثيق حتى يُضاف مشغل/سياسة إدخال عبر تراكم مستقبلي.
            </p>
          </div>
        </div>
      </div>

      {/* ── Per-decision cards ─────────────────────────────────────────── */}
      <div className="space-y-6">
        {ACCOUNTING_POLICIES.map((p) => {
          const key = `accounting_policy.${p.id}`;
          const current = getValue(key) as string | null;
          const row = settings?.find((s) => s.key === key);
          const lastEditBy = row?.updated_by ?? null;
          const lastEditAt = row?.updated_at ?? null;
          const busy = savingKey === key;
          const saved = lastSavedKey === key && savingKey === null;

          return (
            <article key={p.id} className="border rounded-xl p-5 bg-card shadow-sm">
              {/* Header: question + saved/saving indicator */}
              <header className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="font-bold text-lg">
                    {p.id}: {p.question}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">{p.explanation}</p>
                  {p.dependsOnKey && (
                    <p className="mt-1 text-xs text-muted-foreground/70">
                      <span className="font-medium">يعتمد على الإعداد:</span>{' '}
                      <code className="rounded bg-muted px-1 py-0.5">{p.dependsOnKey}</code>
                      <span className="mx-1">·</span>
                      <span>{p.dependsOnNote}</span>
                    </p>
                  )}
                </div>
                <div
                  className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                    busy
                      ? 'text-sky-600'
                      : saved
                      ? 'text-emerald-600'
                      : 'text-muted-foreground/60'
                  }`}
                  aria-live="polite"
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      جارٍ الحفظ…
                    </>
                  ) : saved ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      محفوظ
                    </>
                  ) : (
                    <>
                      <Clock className="h-3.5 w-3.5" />
                      غير محفوظ
                    </>
                  )}
                </div>
              </header>

              {/* Options: radio + explanatory box per option */}
              <div className="mt-4 space-y-3">
                {p.options.map((opt: PolicyOption) => {
                  const checked = current === opt.value;
                  const isBD06Revenue = p.id === 'BD-06' && opt.value === 'C';
                  return (
                    <label
                      key={opt.value}
                      className={`flex w-full gap-3 rounded-lg border p-3 text-right transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5 ${
                        busy ? 'opacity-60' : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name={`policy-${p.id}`}
                        value={opt.value}
                        checked={checked}
                        onChange={() => void handleChange(p, opt)}
                        disabled={busy}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                      />
                      <div className="flex-1">
                        <div
                          className={`mb-2 flex items-center justify-between rounded-md border px-3 py-2 ${
                            checked
                              ? 'border-primary bg-primary/5'
                              : 'border-border bg-muted/30'
                          }`}
                        >
                          <span className="text-sm font-semibold">
                            الخيار {opt.value}: {opt.title}
                          </span>
                          {checked && (
                            <span className="text-xs font-medium text-primary">مختار</span>
                          )}
                        </div>

                        {/* Explanatory box — always visible; selected one highlighted */}
                        <div
                          className={`rounded-md border px-3 py-2 ${
                            checked
                              ? 'border-primary bg-primary/5'
                              : 'border-border bg-background'
                          }`}
                        >
                          <dl className="grid gap-2 text-xs text-muted-foreground">
                            <div>
                              <dt className="font-semibold">الملخّص:</dt>
                              <dd className="text-right">{opt.summary}</dd>
                            </div>
                            <div>
                              <dt className="font-semibold">ما سيحدث:</dt>
                              <dd className="text-right">{opt.consequence}</dd>
                            </div>
                            <div>
                              <dt className="font-semibold">التأثير المحاسبي:</dt>
                              <dd className="text-right">{opt.accountingImpact}</dd>
                            </div>
                            <div>
                              <dt className="font-semibold">متى يظهر:</dt>
                              <dd className="text-right">{opt.when}</dd>
                            </div>
                            <div>
                              <dt className="font-semibold">التبعيات:</dt>
                              <dd className="text-right">{opt.dependencies}</dd>
                            </div>
                            <div
                              className={`border-t border-amber-200/60 pt-1 ${
                                isBD06Revenue ? 'text-amber-900' : ''
                              }`}
                            >
                              <dt className="font-semibold">التحذير:</dt>
                              <dd className="text-right">{opt.warning}</dd>
                              {isBD06Revenue && (
                                <p className="mt-1 text-right font-medium">
                                  تنبيه حرفي: انتهاء الصلاحية لا يعني تلقائياً أن
                                  البونص يصبح إيراداً. خيار C (إيراد بالتحويل) هو
                                  مسار الإيراد الوحيد — اختيار صريح للمالك لا
                                  يُطبّق أبداً تلقائياً عند الانتهاء.
                                </p>
                              )}
                            </div>
                          </dl>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              {/* Footer: current value + last edit */}
              <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="font-medium">الحالة الحالية:</span>
                  <span className="font-semibold text-foreground">
                    {labelForValue(current)}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="font-medium">آخر تعديل:</span>
                  {lastEditAt ? (
                    <>
                      <span>{lastEditBy ? actorNames[lastEditBy] ?? lastEditBy : '—'}</span>
                      <span className="text-muted-foreground/60">
                        {formatDateTime(lastEditAt)}
                      </span>
                    </>
                  ) : (
                    <span>لم يُحفظ بعد</span>
                  )}
                </span>
              </footer>
            </article>
          );
        })}
      </div>

      {localSaveError && <ErrorMessage message={localSaveError} />}
    </div>
  );
}
