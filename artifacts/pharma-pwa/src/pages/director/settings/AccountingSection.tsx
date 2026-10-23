import { useCallback, useEffect, useState } from 'react';
import { Loader2, Check, Clock, AlertTriangle } from 'lucide-react';
import {
  ACCOUNTING_POLICIES,
  type AccountingPolicy,
  type PolicyOption,
} from '@/lib/accountingPolicies';
import { useBonusSettings } from '@/hooks/useBonusSettings';
import {
  loadUserNames,
  listFinancialAccounts,
  listRoleAccountMap,
  upsertRoleAccountMap,
  deleteRoleAccountMap,
  listJournalLegLayouts,
  upsertJournalLegLayout,
  postBonusEarnToGl,
  listPendingGlPostings,
  type SettingRow,
  type FinancialAccount,
  type RoleAccountMapRow,
  type BonusRole,
  type JournalLegLayoutRow,
  type PendingGlPosting,
  type GlPostResult,
} from '@/lib/bonusFinancialApi';
import { readCurrentCompanyId } from '@/lib/bonusAccountingPolicyLive';
import {
  computePolicyReadiness,
  currentPolicyReadiness,
  BD01_REQUIREMENTS,
  STATUS_LABEL,
  statusVariant,
  type ReadinessResult,
} from '@/lib/bonusPolicyReadiness';
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

  // Live chart of accounts (read-only) — used only to compute whether a chosen
  // BD-01 option is realisable today. Failures are fail-closed (empty list).
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    listFinancialAccounts()
      .then((a) => { if (mounted) setAccounts(a); })
      .catch(() => { if (mounted) setAccounts([]); })
      .finally(() => { if (mounted) setAccountsLoaded(true); });
    return () => { mounted = false; };
  }, []);

  // Single-company + director role→account designations (0029). Used to flip a
  // BD-01 role from ACCOUNT_MAPPING_REQUIRED to ACCOUNT_MAPPING_COMPLETE and to
  // feed the mapping editor. RLS is director-only; this page is director-scoped.
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [mappings, setMappings] = useState<RoleAccountMapRow[]>([]);
  const [mappingsLoaded, setMappingsLoaded] = useState(false);
  const [mapError, setMapError] = useState('');

  const loadMappings = useCallback(() => {
    setMappingsLoaded(false);
    setMapError('');
    readCurrentCompanyId()
      .then((cid) => {
        setCompanyId(cid);
        if (!cid) return [];
        return listRoleAccountMap(cid);
      })
      .then((rows) => {
        if (rows) setMappings(rows);
      })
      .catch((e) => { setMapError(e instanceof Error ? e.message : 'تعذر تحميل تعيينات الحسابات.'); })
      .finally(() => { setMappingsLoaded(true); });
  }, []);

  useEffect(() => { loadMappings(); }, [loadMappings]);

  const designationFor = useCallback(
    (role: BonusRole): RoleAccountMapRow | null =>
      mappings.find((m) => m.role === role && m.is_active) ?? null,
    [mappings],
  );

  // Journal leg layout (0029 bonus_journal_leg_mapping): which role is the debit
  // leg and which is the credit leg for each EARN policy option. This is the
  // configurable layer that lets a director re-point a leg to ANY role/account
  // without a code change; apply_bonus_earn_accounting (0028) resolves the layout
  // to concrete account codes and freezes them into the per-earn snapshot.
  const [layouts, setLayouts] = useState<JournalLegLayoutRow[]>([]);

  const loadLayouts = useCallback(() => {
    if (!companyId) { setLayouts([]); return Promise.resolve(); }
    return listJournalLegLayouts(companyId)
      .then((rows) => setLayouts(rows.filter((r) => r.is_active)))
      .catch(() => setLayouts([]));
  }, [companyId]);

  useEffect(() => { void loadLayouts(); }, [loadLayouts]);

  const layoutFor = useCallback(
    (option: string): { debit_role: string | null; credit_role: string | null } => {
      const row = layouts.find((l) => l.process === 'EARN' && l.option === option && l.is_active);
      return { debit_role: row?.debit_role ?? null, credit_role: row?.credit_role ?? null };
    },
    [layouts],
  );

  // The canonical roles per option come from the readiness descriptor (single
  // source with the pure engine). The director only chooses ACCOUNTS; the leg
  // layout (which role is debit vs credit) is written from this canonical spec.
  const layoutRolesFor = useCallback(
    (option: 'A' | 'B'): { debit_role: string | null; credit_role: string | null } => {
      const specs = BD01_REQUIREMENTS[option] ?? [];
      return {
        debit_role: specs.find((s) => s.leg === 'debit')?.role ?? null,
        credit_role: specs.find((s) => s.leg === 'credit')?.role ?? null,
      };
    },
    [],
  );

  // Persist the leg layout for an option (idempotent: writes only when the
  // active layout differs from the canonical spec).
  const ensureLayout = useCallback(
    async (option: 'A' | 'B') => {
      if (!companyId) return;
      const want = layoutRolesFor(option);
      const have = layoutFor(option);
      if (have.debit_role === want.debit_role && have.credit_role === want.credit_role) return;
      await upsertJournalLegLayout(companyId, 'EARN', option, want.debit_role, want.credit_role);
      await loadLayouts();
    },
    [companyId, layoutFor, layoutRolesFor, loadLayouts],
  );

  // Assign / clear a GL account for one BD-01 leg role. Assigning also makes
  // sure the option's leg layout exists so SQL can resolve the role to a code.
  const assignLegAccount = useCallback(
    async (option: 'A' | 'B', role: BonusRole, accountId: string | null) => {
      if (!companyId) return;
      try {
        if (accountId) {
          await upsertRoleAccountMap(companyId, role, accountId);
          await ensureLayout(option);
        } else {
          await deleteRoleAccountMap(companyId, role);
        }
        await loadMappings();
      } catch (e) {
        setMapError(e instanceof Error ? e.message : 'تعذر حفظ تعيين الحساب.');
      }
    },
    [companyId, ensureLayout, loadMappings],
  );

  // E1 earns queued for a director GL post (0030 request queue). The trigger
  // (0028) can never post (JWT-scoped director gate), so posting is this
  // explicit director action over the PENDING rows.
  const [pendingPostings, setPendingPostings] = useState<PendingGlPosting[]>([]);
  const [pendingLoaded, setPendingLoaded] = useState(false);
  const [postingLedgerId, setPostingLedgerId] = useState<string | null>(null);
  const [postResults, setPostResults] = useState<Map<string, GlPostResult>>(new Map());
  const setPostResult = (id: string, r: GlPostResult) =>
    setPostResults((prev) => {
      const next = new Map(prev);
      next.set(id, r);
      return next;
    });
  const [postError, setPostError] = useState('');

  const loadPending = useCallback(() => {
    setPendingLoaded(false);
    setPostError('');
    listPendingGlPostings()
      .then((rows) => { setPendingPostings(rows); })
      .catch((e) => { setPostError(e instanceof Error ? e.message : 'تعذر تحميل طلبات النشر.'); })
      .finally(() => { setPendingLoaded(true); });
  }, []);

  useEffect(() => { loadPending(); }, [loadPending]);

  // Flatten mappings to an array for the readiness resolver (pure caller).
  const mappingsArray = mappingsLoaded ? mappings : [];

  const handleChange = useCallback(
    async (
      policy: AccountingPolicy,
      option: PolicyOption,
      current: string | null,
    ) => {
      const key = `accounting_policy.${policy.id}`;
      const newReadiness = computePolicyReadiness(policy.id, option.value, accounts, mappingsArray);
      const oldReadiness = currentPolicyReadiness(policy.id, current, accounts, mappingsArray);
      setLocalSaveError('');

      // Structurally unavailable options (BD-08 B/C, BD-09 C) are rejected before
      // any confirm/save — they require scheduler infrastructure that doesn't exist.
      // The backend (0028/0030) also fails closed; this is defence-in-depth.
      if (option.unavailable) {
        setLocalSaveError(`الخيار ${option.value} (${policy.id}) غير متاح بعد: ${option.unavailabilityReason ?? 'بنية التوثيق غير مكتملة.'}`);
        return;
      }

      // Never silently activate a policy that is not READY. Switching away from
      // an already-effective (READY) policy also requires confirmation. Saving a
      // non-READY option only records a PREFERENCE (no GL write ever occurs).
      if (!newReadiness.ready) {
        const msg =
          `الخيار ${option.value} (${policy.id}) غير جاهز للتفعيل:\n${newReadiness.reason}\n\n` +
          'يتم حفظه كتفضيل مسجَّل فقط — لن يُنشئ أي قيد GL. حفظ؟';
        if (!window.confirm(msg)) return;
      } else if (oldReadiness.ready && current !== option.value) {
        if (
          !window.confirm(
            'تغيير سياسة محاسبية فعّالة (جاهزة)؟ هذا سيؤثر على الربط المالي القادم. فعلّ؟',
          )
        )
          return;
      }

      try {
        await save(key, option.value);
      } catch (err) {
        setLocalSaveError(
          err instanceof Error ? err.message : 'تعذر حفظ هذه السياسة.',
        );
      }
    },
    [save, accounts],
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
          const readiness = currentPolicyReadiness(p.id, current, accounts, mappingsArray);
          const rv = statusVariant(readiness.status);

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
                  <div className="mt-2 flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${rv.dot}`} />
                    <span className={rv.text}>{STATUS_LABEL[readiness.status]}</span>
                  </div>
                  {!readiness.ready && (
                    <p className={`mt-1.5 text-[10px] leading-tight ${rv.text}`}>
                      {readiness.reason}
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
                  const optStatus = computePolicyReadiness(p.id, opt.value, accounts, mappingsArray);
                  return (
                    <label
                      key={opt.value}
                      className={`flex w-full gap-3 rounded-lg border p-3 text-right transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5 ${
                        busy ? 'opacity-60' : ''
                      } ${opt.unavailable ? 'opacity-50 grayscale' : ''}`}
                    >
                      <input
                        type="radio"
                        name={`policy-${p.id}`}
                        value={opt.value}
                        checked={checked}
                        onChange={() => void handleChange(p, opt, current)}
                        disabled={busy || opt.unavailable}
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
                            {opt.unavailable && (
                              <span
                                className="mr-2 rounded-full border border-gray-300 bg-gray-200/60 px-2 py-0.5 text-[9px] font-medium text-gray-600"
                                title={opt.unavailabilityReason}
                              >
                                غير متاح بعد
                              </span>
                            )}
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
                            {opt.unavailable && (
                              <div className="border-t border-gray-200/60 pt-1">
                                <dt className="font-semibold text-gray-600">حالة الإتاحة:</dt>
                                <dd className="text-right text-gray-600">
                                  غير متاح بعد — {opt.unavailabilityReason}
                                </dd>
                              </div>
                            )}
                            {optStatus.requiredAccounts.length > 0 && (
                              <div className="border-t border-amber-200/60 pt-1">
                                <dt className="font-semibold">الحسابات المطلوبة:</dt>
                                <dd className="text-right">
                                  {optStatus.requiredAccounts.map((r) => (
                                    <span key={r.role} className="block">
                                      {r.label} — المطلوب: {r.codeHint}{' '}
                                      <span className="text-muted-foreground/60">
                                        (متوافق في دليل الحسابات:{' '}
                                        {r.candidates.length > 0
                                          ? r.candidates.map((c) => `${c.code} ${c.name}`).join('، ')
                                          : '—'}{' '}
                                        · مُخصّص؟{' '}
                                        {r.designated ? `${r.designated.code} ${r.designated.name}` : 'لا (ربط غير مكتمل)'})
                                      </span>
                                    </span>
                                  ))}
                                </dd>
                              </div>
                            )}
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

{/* ── E1 accounting configuration: per-option Debit/Credit account ──────── */}
      {/*
        NO account code is hardcoded in the posting logic. For each journal-producing
        BD-01 option the director selects the Debit and Credit ACCOUNTS explicitly:
          Option A → Debit Account [select] / Credit Account [select]
          Option B → Debit Account [select] / Credit Account [select]
          Option C → no journal entry (by design)
        Each selection binds the leg's ROLE to a GL account (bonus_role_account_map,
        0029) and records the leg layout (bonus_journal_leg_mapping: which role is
        debit vs credit). 0028 then resolves layout+role→account to concrete codes
        and freezes them into the per-earn snapshot; 0030 posts from that snapshot.
        No default and no fallback: an unselected leg stays ACCOUNT_MAPPING_REQUIRED
        and no journal is created. Changing a selection never alters an already
        decided earn (the snapshot is history-locked). */}
      <article className="border rounded-xl p-5 bg-card shadow-sm">
        <header className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="font-bold text-lg">تهيئة محاسبة E1 → GL (مدير فقط)</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              اختر حساب المدين وحساب الدائن لكل خيار. لا يوجد أي حساب ثابت في كود
              الترحيل — حتى تختار الحسابين، يبقى القرار{' '}
              <span className="font-medium">ACCOUNT_MAPPING_REQUIRED</span> ولا يُنشر
              أي قيد (0028). الخيار C لا يُنتج قيداً بحكم التصميم.
            </p>
            {!mappingsLoaded && (
              <p className="mt-1 text-xs text-muted-foreground/70">جارٍ تحميل التعيينات...</p>
            )}
            {mappingsLoaded && companyId === null && (
              <p className="mt-1 text-xs text-amber-700">
                لم يتم العثور على شركة مالية — أنشئ الشركة أولاً. لا يمكن تعيين
                الحسابات حتى يتوفر company_id (0009:57 C-3).
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={loadMappings}
            disabled={!mappingsLoaded}
            className="shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            إعادة تحميل
          </button>
        </header>

        {mapError ? (
          <div className="mt-3">
            <ErrorMessage message={mapError} />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {(['A', 'B'] as const).map((option) => {
              const specs = BD01_REQUIREMENTS[option] ?? [];
              const allMapped = specs.every((s) => designationFor(s.role) !== null);
              return (
                <div key={option} className="rounded-md border border-border p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-sm font-bold">الخيار {option}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                        allMapped
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-amber-200 bg-amber-50 text-amber-800'
                      }`}
                    >
                      {allMapped ? 'الربط مكتمل' : 'ربط الحساب مطلوب'}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {specs.map((legSpec) => {
                      const designated = designationFor(legSpec.role);
                      const compatible = accounts.filter(
                        (a) => a.account_type === legSpec.accountType && a.is_postable,
                      );
                      const selectedAccountId = designated?.account_id ?? '';
                      const typeLabel =
                        legSpec.accountType === 'asset'
                          ? 'أصول (11xx)'
                          : legSpec.accountType === 'liability'
                            ? 'التزامات (2xxx)'
                            : legSpec.accountType === 'expense'
                              ? 'نفقات (6xxx)'
                              : legSpec.accountType;
                      return (
                        <div key={legSpec.leg} className="flex flex-col gap-1.5">
                          <label className="text-xs font-semibold">
                            {legSpec.leg === 'debit' ? 'حساب المدين (Debit)' : 'حساب الدائن (Credit)'}
                            <span className="text-muted-foreground/60"> — {legSpec.label}</span>
                          </label>
                          {compatible.length === 0 ? (
                            <span className="text-xs text-muted-foreground/70">
                              لا توجد حسابات {typeLabel} قابلة للترحيل في دليل الحسابات. لا
                              يُخصّص النظام أي حساب تلقائياً.
                            </span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <select
                                value={selectedAccountId}
                                onChange={(e) =>
                                  void assignLegAccount(option, legSpec.role, e.target.value || null)
                                }
                                disabled={!companyId || !mappingsLoaded}
                                className="text-sm"
                              >
                                <option value="">— لم يُختر (ACCOUNT_MAPPING_REQUIRED) —</option>
                                {compatible.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.code} — {a.name}
                                  </option>
                                ))}
                              </select>
                              {designated ? (
                                <span className="text-xs text-emerald-700">
                                  معيّن: {designated.account_code ?? designated.account_id}
                                </span>
                              ) : (
                                <span className="text-xs text-amber-700">غير مُعيّن</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className="rounded-md border border-border p-3">
              <span className="text-sm font-bold">الخيار C</span>
              <p className="mt-1 text-xs text-muted-foreground/70">
                لا إدخال عند المنح — لا يُنشأ أي قيد GL بحكم التصميم (ACC-01). لا يحتاج أي
                حساب ولا يُظهر أي حساب افتراضي.
              </p>
            </div>
          </div>
        )}
      </article>

      {/* ── E1 earns queued for GL posting (director RPC 0030) ───────────────── */}
      {/*
        The trigger (0028) writes a PENDING row here only when a role is mapped and
        BD-08 = A. This panel lists those rows; each "نشر إلى GL" calls
        post_bonus_earn_to_gl under the director's JWT, which calls
        create/post_financial_journal_entry (both director-only, 0010:291/0024:43).
        Idempotent: re-posting a POSTED earn returns the same journal id. */}
      <article className="border rounded-xl p-5 bg-card shadow-sm">
        <header className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="font-bold text-lg">عمليات نشر E1 إلى GL (مدير فقط)</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              عمليات ربح E1 في انتظار النشر إلى دفتر الحسابات العام. كل نشر ينشئ قيد
              موزّن (Dr = Cr) تحت JWT المدير. لا ينشر المشغّل أي قيد.
            </p>
          </div>
          <button
            type="button"
            onClick={loadPending}
            disabled={!pendingLoaded}
            className="shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            تحديث
          </button>
        </header>

        {postError ? (
          <div className="mt-3">
            <ErrorMessage message={postError} />
          </div>
        ) : !pendingLoaded ? (
          <p className="mt-3 text-xs text-muted-foreground/70">جارٍ تحميل طلبات النشر…</p>
        ) : pendingPostings.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground/70">
            لا توجد عمليات ربح E1 معلّقة في النشر. سيظهر الصفوف هنا عندما يحلّل 0028
            ربحاً ويجد دوراً مُعيّناً (ACCOUNT_MAPPING_REQUIRED يُصبح POSTING_… + PENDING).
          </p>
        ) : (
          <table className="mt-3 w-full table-auto text-sm">
            <thead>
              <tr className="text-right text-xs font-medium text-muted-foreground/70">
                <th className="pb-1.5 pr-2">الربح (ledger)</th>
                <th className="pb-1.5 pr-2">المبلغ</th>
                <th className="pb-1.5 pr-2">حالة النشر</th>
                <th className="pb-1.5 pr-2">النتيجة</th>
                <th className="pb-1.5 pl-2 text-left">نشر؟</th>
              </tr>
            </thead>
            <tbody>
              {pendingPostings.map((row) => {
                const res = postResults.get(row.ledger_id);
                return (
                  <tr key={row.ledger_id} className="border-t border-border align-top">
                    <td className="py-1.5 pr-2 font-mono text-xs">{row.ledger_id.slice(0, 8)}…</td>
                    <td className="py-1.5 pr-2">{row.earn_amount ?? '—'} ير</td>
                    <td className="py-1.5 pr-2">
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.25 text-xs font-medium text-amber-800">
                        {row.status}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2">
                      {res ? (
                        res.status === 'POSTED' ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs text-emerald-700"
                            title={res.journalEntryId ?? undefined}
                          >
                            نُشر — القيد{' '}
                            <span className="font-mono">
                              {res.journalEntryId?.slice(0, 8) ?? '—'}…
                            </span>
                          </span>
                        ) : res.reason ? (
                          <span className="text-xs text-red-700" title={res.reason}>
                            فشل
                          </span>
                        ) : null
                      ) : '—'}
                    </td>
                    <td className="py-1.5 pl-2 text-left">
                      <button
                        type="button"
                        disabled={postingLedgerId === row.ledger_id}
                        onClick={async () => {
                          setPostingLedgerId(row.ledger_id);
                          setPostError('');
                          try {
                            const res = await postBonusEarnToGl(row.ledger_id);
                            setPostResult(row.ledger_id, res);
                            await loadPending();
                          } catch (e) {
                            setPostError(
                              e instanceof Error ? e.message : 'فشل النشر إلى GL.',
                            );
                          } finally {
                            setPostingLedgerId(null);
                          }
                        }}
                        className="rounded-md border border-sky-200 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                      >
                        {postingLedgerId === row.ledger_id ? 'جارِ النشر…' : 'نشر إلى GL'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </article>

      {localSaveError && <ErrorMessage message={localSaveError} />}
    </div>
  );
}
