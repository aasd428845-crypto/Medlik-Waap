/**
 * bonusPolicyReadiness.ts — COA-aware, fail-closed readiness resolver for the
 * Bonus Accounting Policy Control Center (PHASE-3, E1 configuration).
 *
 * BOUNDARIES (honoured exactly):
 *  - This module is PURE: it imports only `bonusAccountingPolicy.ts` as a
 *    TYPE source (the `import type` is erased at runtime), so it holds no
 *    Supabase client and runs under `node --experimental-strip-types` with
 *    zero IO. Readiness is computed from the live chart of accounts passed
 *    in by the caller; no DB is touched here.
 *  - No migration / no new table / no `company_id` added. The chart of
 *    accounts is read from the existing `financial_accounts` table by the
 *    caller (see `listFinancialAccounts`).
 *  - No GL entry is ever created or implied. The resolver only reports
 *    whether a *chosen* option is realisable today.
 *
 * GROUNDING (verified, not assumed):
 *  - BD-01 option→account-ROLE mapping mirrors the pure engine:
 *    `AccountRole['role']` = 'deferred_bonus_liability' (A) / 'bonus_expense' (B).
 *    The `import type` below is erased, so the role strings are locked to the
 *    engine at compile time — no drift possible.
 *  - Seeded COA (committed `0007`): codes 1000..6000 including liability
 *    2000/2100 and expense 6000; NO 2xxx deferred-bonus-liability account
 *    (the `2110` seed lives only in the unapplied/untracked-in-submodule
 *    `0017`). So BD-01 A/B are ACCOUNT_MAPPING_REQUIRED today.
 *  - Project-wide: E1→GL posting is wired but fail-closed and director-scoped
 *    (`0028` is the decision hook that NEVER calls create/post_financial_journal_entry;
 *    it only queues a PENDING request via `0030` when a role is mapped + BD-08=A).
 *    The actual journal is created+posted only by the director-scoped RPC
 *    `post_bonus_earn_to_gl` (0030), which calls create/post_financial_journal_entry
 *    under the director's OWN JWT — the trigger cannot post because the director
 *    gate (0010:291 / 0024:43) is JWT-scoped and un-bypassable by SECURITY DEFINER.
 *    So no BD-01..BD-10 option can ever reach a *posting* READY from the trigger;
 *    BD-01 C is READY only because it is an explicit no-entry at grant — no account
 *    and no posting are required for it.
 */
import type { AccountRole } from './bonusAccountingPolicy';
// Type-only import keeps this module pure (zero IO at runtime — still runnable
// under `node --experimental-strip-types`). Mappings are director designations
// read from `bonus_role_account_map` (0029) and passed in by the caller.
import type { RoleAccountMapRow } from './bonusFinancialApi';

export type PolicyStatus =
  | 'READY'
  | 'CONFIGURATION_REQUIRED'
  | 'POLICY_NOT_CONFIGURED'
  | 'POSTING_INFRASTRUCTURE_REQUIRED'
  | 'POSTING_AUTHORITY_REQUIRED'
  | 'ACCOUNT_MAPPING_REQUIRED'
  | 'ACCOUNT_MAPPING_COMPLETE'
  | 'INVALID_CONFIGURATION';

export type AccountTypeCode = 'liability' | 'expense' | 'asset' | 'revenue' | 'equity' | 'cogs' | string;

/** Subset of `financial_accounts` rows relevant to readiness. */
export interface FinancialAccountLike {
  code: string;
  name: string;
  account_type: AccountTypeCode;
  is_postable: boolean;
}

export interface AccountRequirement {
  /** Generalised role name (any non-empty string; 'cash' included). */
  role: string;
  /** Which side of the journal this leg sits on. */
  leg: 'debit' | 'credit';
  label: string;
  /** Expected COA account type for a compatible account. */
  accountType: AccountTypeCode;
  /** Descriptive code hint (e.g. '2xxx'); NOT a prescriptive code. */
  codeHint: string;
  /** Compatible postable COA accounts currently in the chart (COA display). */
  candidates: { code: string; name: string }[];
  /** A designated account for this role, or null. Director-controlled via 0029
   *  bonus_role_account_map (role is now `text` — any non-empty string). */
  designated: { code: string; name: string } | null;
}

export interface ReadinessResult {
  status: PolicyStatus;
  ready: boolean;
  reason: string;
  requiredAccounts: AccountRequirement[];
  diagnostics: string[];
}

export const STATUS_LABEL: Record<PolicyStatus, string> = {
  READY: 'جاهز',
  CONFIGURATION_REQUIRED: 'الإعداد مطلوب',
  POLICY_NOT_CONFIGURED: 'السياسة غير مهيأة',
  POSTING_INFRASTRUCTURE_REQUIRED: 'بنية التوثيق مطلوبة',
  POSTING_AUTHORITY_REQUIRED: 'صلاحية التوثيق مطلوبة',
  ACCOUNT_MAPPING_REQUIRED: 'ربط الحساب مطلوب',
  ACCOUNT_MAPPING_COMPLETE: 'ربط الحساب مكتمل',
  INVALID_CONFIGURATION: 'تهيئة غير صالحة',
};

export const STATUS_VARIANT: Record<PolicyStatus, { dot: string; text: string; border: string }> = {
  READY: { dot: 'bg-emerald-500', text: 'text-emerald-700', border: 'border-emerald-200' },
  POLICY_NOT_CONFIGURED: { dot: 'bg-gray-400', text: 'text-gray-600', border: 'border-gray-200' },
  CONFIGURATION_REQUIRED: { dot: 'bg-amber-500', text: 'text-amber-800', border: 'border-amber-200' },
  POSTING_INFRASTRUCTURE_REQUIRED: { dot: 'bg-amber-500', text: 'text-amber-800', border: 'border-amber-200' },
  POSTING_AUTHORITY_REQUIRED: { dot: 'bg-red-500', text: 'text-red-800', border: 'border-red-200' },
  ACCOUNT_MAPPING_REQUIRED: { dot: 'bg-amber-500', text: 'text-amber-800', border: 'border-amber-200' },
  ACCOUNT_MAPPING_COMPLETE: { dot: 'bg-emerald-400', text: 'text-emerald-800', border: 'border-emerald-200' },
  INVALID_CONFIGURATION: { dot: 'bg-red-500', text: 'text-red-800', border: 'border-red-200' },
};

/** Typo-safe lookup helper (avoids a typo'd status silently rendering nothing). */
export function statusVariant(status: PolicyStatus) {
  return STATUS_VARIANT[status] ?? STATUS_VARIANT.CONFIGURATION_REQUIRED;
}

/**
 * BD-01 account-role requirements per option (single source = the engine's
 * `AccountRole` union). A/B need one account each; C needs none.
 */
interface Bd01RequirementSpec {
  role: string;
  leg: 'debit' | 'credit';
  label: string;
  accountType: AccountTypeCode;
  codeHint: string;
}
export const BD01_REQUIREMENTS: Record<string, Bd01RequirementSpec[]> = {
  A: [
    { role: 'cash', leg: 'debit', label: 'النقود النقدية (DR — التكافؤ النقدي)', accountType: 'asset', codeHint: '11xx' },
    { role: 'deferred_bonus_liability', leg: 'credit', label: 'تعهيد البونص المؤجل (CR — التزام)', accountType: 'liability', codeHint: '2xxx' },
  ],
  B: [
    { role: 'bonus_expense', leg: 'debit', label: 'نفقى البونص عند المنح (DR)', accountType: 'expense', codeHint: '6xxx' },
    { role: 'cash', leg: 'credit', label: 'النقود النقدية (CR — التكافؤ النقدي)', accountType: 'asset', codeHint: '11xx' },
  ],
  C: [],
};

/** Project-wide posting reality (see module header): E1→GL posting is wired but
 *  fail-closed + director-scoped. 0028 (trigger) only queues a PENDING request;
 *  0030's director RPC actually posts. Account readiness here covers ONLY the
 *  account-mapping gate; the BD-08=A timing gate and director authority are
 *  enforced fail-closed by the SQL layer (0028/0030), not by this pure module. */
const POSTING_NOTE =
  'بنية توثيق البونص→GL مُوصَّلة بخط واحد فشل-مغلق: 0028 (المشغّل فقط) يضع طلب PENDING، و0030 (دالة مديرٍ فقط) تنشئ+تنشر القيد تحت JWT الدليل نفسه. أولويات الجدولة (BD-08=C) والسلطة غير الموجبة للمشغّل لا يمكن تجاوزهما.';

function findCandidates(req: Bd01RequirementSpec, accounts: FinancialAccountLike[]): { code: string; name: string }[] {
  return accounts
    .filter((a) => a.account_type === req.accountType && a.is_postable)
    .map((a) => ({ code: a.code, name: a.name }))
    .sort((x, y) => Number(x.code) - Number(y.code));
}

/**
 * Readiness for a single BD-01 option against the live chart of accounts +
 * director role→account mappings (0029).
 * - C → READY (explicit no-entry: no account, no posting required).
 * - A/B with ALL legs designated (both debit + credit roles mapped) →
 *   ACCOUNT_MAPPING_COMPLETE: the account gate is satisfied; the BD-08=A
 *   timing gate and director authority are still enforced fail-closed by the
 *   SQL layer (0028/0030), not here.
 * - A/B with ANY leg unmapped → ACCOUNT_MAPPING_REQUIRED (fail-closed: we
 *   never auto-pick 2000/2100/6000/1110 for a bonus role — every leg is
 *   director-configurable via 0029).
 * `designated` is populated from `mappings` when present.
 */
export function computeBd01Readiness(
  option: string,
  accounts: FinancialAccountLike[],
  mappings: RoleAccountMapRow[] = [],
): ReadinessResult {
  const specs = BD01_REQUIREMENTS[option];
  if (!specs) {
    return {
      status: 'INVALID_CONFIGURATION',
      ready: false,
      reason: `خيار BD-01 "${option}" غير صالح (غير أحد A/B/C).`,
      requiredAccounts: [],
      diagnostics: [],
    };
  }
  if (option === 'C') {
    return {
      status: 'READY',
      ready: true,
      reason: 'BD-01 C = لا إدخال عند البعث (سياسة "بدون إقرار"). قابلة للتنفيذ اليوم بدون أي حساب ولا قيد GL.',
      requiredAccounts: [],
      diagnostics: [],
    };
  }
  const byRole = new Map<string, RoleAccountMapRow>();
  for (const m of mappings) byRole.set(m.role, m);

  const requiredAccounts: AccountRequirement[] = specs.map((s) => {
    const mapped = byRole.get(s.role);
    let designated: { code: string; name: string } | null = null;
    if (mapped && mapped.account_code) {
      designated = { code: mapped.account_code, name: mapped.account_name ?? '' };
    }
    return {
      role: s.role,
      leg: s.leg,
      label: s.label,
      accountType: s.accountType,
      codeHint: s.codeHint,
      candidates: findCandidates(s, accounts),
      designated,
    };
  });
  // ALL legs must be mapped for the option to be configuration-complete.
  const allMapped = requiredAccounts.every((r) => r.designated !== null);
  const anyMapped = requiredAccounts.some((r) => r.designated !== null);
  const diagnostics = [POSTING_NOTE];
  const cands = requiredAccounts.flatMap((r) => r.candidates);
  const mappedNote = allMapped
    ? 'جميع الأدوار المطلوبة مُعيَّنة (DR + CR) → ACCOUNT_MAPPING_COMPLETE. باقي البوابات (BD-08=A + صلاحية مدير) تُفرض منعًا بفشل مغلق في 0028/0030.'
    : anyMapped
      ? 'بعض الأدوار مُعيَّنة لكن باقيها لا — ACCOUNT_MAPPING_REQUIRED. ALL legs must be designated before posting.'
      : 'الأدوار المطلوبة غير مُعيَّنة (لا يوجد تعيين دور→حساب) → ACCOUNT_MAPPING_REQUIRED. سياسة التعيين مديرية ولا تُخصّص أي حساب تلقائياً.';
  const reason =
    `BD-01 ${option}: ${option === 'A' ? 'إقرار ملكية مؤجل (DR نقداً/CR التزام)' : 'مصاريف عند البعث (DR مصاريف/CR نقداً)'}.\n` +
    `العقود المطلوبة: ${requiredAccounts.map((r) => `${r.label} (${r.codeHint})`).join('، ')}.\n` +
    `حسابات متوافقة موجودة في دليل الحسابات: ${cands.length > 0 ? cands.map((c) => `${c.code} ${c.name}`).join('، ') : '—'}.\n` +
    `${mappedNote}\n` +
    `${POSTING_NOTE}`;
  return {
    status: allMapped ? 'ACCOUNT_MAPPING_COMPLETE' : 'ACCOUNT_MAPPING_REQUIRED',
    ready: false, // never READY from account mapping alone — BD-08/authority remain
    reason,
    requiredAccounts,
    diagnostics,
  };
}

/**
 * Readiness for an arbitrary bonus accounting policy.
 * BD-01 is COA-aware (above). BD-02..BD-10 remain fail-closed at
 * POSTING_INFRASTRUCTURE_REQUIRED because no bonus→GL posting is wired; we
 * deliberately do NOT assert per-option account roles for them (those engines'
 * role maps are not re-derived here to avoid drift) — their options stay
 * selectable as *preferences* only, and are never reported READY.
 */
export function computePolicyReadiness(
  policyId: string,
  option: string,
  accounts: FinancialAccountLike[],
  mappings: RoleAccountMapRow[] = [],
): ReadinessResult {
  if (policyId === 'BD-01') return computeBd01Readiness(option, accounts, mappings);
  return {
    status: 'POSTING_INFRASTRUCTURE_REQUIRED',
    ready: false,
    reason: `سياسة ${policyId}: المحرك مُطوَّر كخيط فشل مغلق دونّ (dormant seam). بنية توثيق البونص→GL مُوصَّلة عبر 0028/0030 فقط لصالح المدير، لذا الاختيار يُسجَّل كتفضيل مسجَّل فقط ولا يُفعِّل أي توثيق.`,
    requiredAccounts: [],
    diagnostics: [POSTING_NOTE],
  };
}

export function currentPolicyReadiness(
  policyId: string,
  currentOption: string | null,
  accounts: FinancialAccountLike[],
  mappings: RoleAccountMapRow[] = [],
): ReadinessResult {
  if (!currentOption) {
    return {
      status: 'POLICY_NOT_CONFIGURED',
      ready: false,
      reason: 'لم يُحفظ أي خيار لسياسة المحاسبة بعد.',
      requiredAccounts: [],
      diagnostics: [],
    };
  }
  return computePolicyReadiness(policyId, currentOption, accounts, mappings);
}
