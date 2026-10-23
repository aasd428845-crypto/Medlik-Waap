/**
 * Accounting policy definitions (BD-01 .. BD-10) for the Bonus Settings
 * Control Center → "سياسات المحاسبية للبونص".
 *
 * ⚠️ UI-ONLY — these are SELECTED POLICIES, NOT APPLIED ACCOUNTING.
 *
 * Grounded in PHASE-49 "BONUS ACCOUNTING DECISION MATRIX" (read-only analysis):
 *   - §3  Business events E1..E12 (what the subledger writes per event).
 *   - §4.3 The 7 accounting questions (Q1..Q7) per event.
 *   - §5   The seeded chart of accounts (the 15 `financial_accounts` codes).
 *   - §7   The financial-impact matrix (what is currently invisible to GL).
 *   - §8   The timing matrix (operational clock vs accounting clock).
 *   - §10  Business Policy Register ACC-01..ACC-14 (the owner questions).
 *   - §11  The option space: T-1/2/3 (where posting is triggered),
 *          R-1/2/3 (where the source reference lives),
 *          S-1/2/3 (posting state model),
 *          C-1/2/3 (company resolution),
 *          V-1/2/3 (valuation basis).
 *
 * Every option below is an EXPLICIT, UNRANKED alternative enumerated by that
 * analysis — this file introduces NO preference and makes NO posting rule. The
 * option count per decision (A/B or A/B/C) follows the analysis directly: C
 * appears only where PHASE-49 lists three internally-consistent alternatives
 * (ACC-01, §11.5, ACC-07, §11.1, §11.3, §11.4); it is deliberately NOT added
 * where the analysis is binary (ACC-04, ACC-06).
 *
 * Persistence: each choice is stored under the existing `bonus_settings` key
 * `accounting_policy.<id>` (e.g. `accounting_policy.BD-01`) as the letter A/B/C.
 * This uses the existing `upsertSetting` mechanism — no new table, no migration.
 * `accounting_policy.*` is a director-managed key namespace sibling to the
 * seeded policy keys; it is NOT consumed by any bonus RPC today, so selecting a
 * policy changes no ledger behaviour — it is a documented source of truth for the
 * future accounting-posting layer.
 *
 * AUDIT-TRAIL GAP (do not paper over; do not invent a parallel audit table):
 * Writing `bonus_settings` does NOT produce a `bonus_audit_trail` row. There is
 * no trigger on `bonus_settings` (the only trigger in `0018` is
 * `trg_bonus_ledger_immutable` on `bonus_ledger`), and `bonus_audit_trail` has
 * only SELECT policies — no INSERT policy — so the client cannot insert audit
 * rows; audit rows are written only by the security-definer bonus RPCs.
 * Recording a policy change into the audit trail therefore requires a
 * migration-level addition (a settings-audit trigger or an INSERT policy +
 * helper), which is explicitly out of scope here. The `accounting_policy.*`
 * selection persists and reloads correctly; its audit appearance is a
 * documented, migration-gated follow-up.
 *
 * NONE of this writes journal entries, posts to a GL, creates a GL account, or
 * touches debit/credit execution. Actual posting lives in a separate,
 * authorised layer that is out of scope for this task.
 */

export type PolicyOptionValue = 'A' | 'B' | 'C';

export interface PolicyOption {
  /** The letter persisted to `accounting_policy.<id>` (A / B / C). */
  value: PolicyOptionValue;
  /** Short Arabic title shown next to the radio. */
  title: string;
  /** One-line summary of the alternative. */
  summary: string;
  /** "ما سيحدث" — the operational consequence of choosing this option. */
  consequence: string;
  /** التأثير المحاسبي — what accounting line(s) this implies, once posted. */
  accountingImpact: string;
  /** متى يظهر التأثير — when any impact would appear relative to the event. */
  when: string;
  /** التبعيات — which existing setting / ACC question / event this leans on. */
  dependencies: string;
  /** تحذير تعارض/ازدحام — over-reliance or conflict warning (never empty). */
  warning: string;
  /** When true, the option is structurally unavailable (e.g. missing scheduler
   *  infrastructure) and is rendered with a disabled radio + "غير متاح بعد".
   *  The backend still fails closed if the value is sent (0028/0030 enforce
   *  TIMING_INFRASTRUCTURE_REQUIRED / ACCOUNT_MAPPING_REQUIRED /
   *  POSTING_INFRASTRUCTURE_REQUIRED), but the UI prevents the selection. */
  unavailable?: boolean;
  /** Human-readable reason shown in the tooltip when `unavailable` is true. */
  unavailabilityReason?: string;
}

export interface AccountingPolicy {
  /** BD-01 .. BD-10. */
  id: string;
  /** The decision question, rendered as the card header (Arabic). */
  question: string;
  /** Overall explanation rendered under the header (Arabic). */
  explanation: string;
  /**
   * A real `bonus_settings` key this policy interacts with, if any.
   * Corrected to keys that actually exist (see the registry); omitted where no
   * setting key governs the event (earn, refund, timing, aggregation, and
   * company scope are rule/period/architecture concerns, not setting keys).
   */
  dependsOnKey?: string;
  /** Human note about what the depended-on setting currently does (footer hint). */
  dependsOnNote: string;
  /** 2 options (A/B) or 3 options (A/B/C). Never fewer than 2. */
  options: PolicyOption[];
}

/** Shared note for decisions whose event is rule/period/architecture-driven
 *  rather than setting-driven (BD-01 Earn, BD-05 Refund, BD-08 Timing,
 *  BD-09 Aggregation, BD-10 Company COA). */
const NO_SETTING = 'الحدث يُدار عبر قاعدة البونص أو فترةٍ أو بنية معماريةٍ، وليس عبر مفتاح إعداد.';

export const ACCOUNTING_POLICIES: AccountingPolicy[] = [
  // ---------------------------------------------------------------- BD-01
  {
    id: 'BD-01',
    question: 'عند منح البونص (آلياً عند التسليم أو يدوياً من المدير)، كيف يُعترف به في المحاسبة؟',
    explanation:
      'يأتي هذا القرار من سؤال ACC-01 في مصفوق PHASE-49: عند المنح، هل يُعامل البونص إلزاماً مستقبلياً (خصماً)، نفقة، أم لا شيء حتى الاستخدام؟ الحدثان ذوا الصلة: E1 (منح آلي عند التسليم، 0019:397) وE2 (منح يدوي، 0018:777). لا يقرأ أي منهما مفتاح إعداد، لذا يعتمد الاعتراف على قاعدة البونص وليس على إعداد حالي.',
    dependsOnNote: NO_SETTING,
    options: [
      {
        value: 'A',
        title: 'التزام عند المنح',
        summary: 'يُسجَّل البونص المكتسب كالتزام مستقبلي عند المنح، وتُعاد صافيته نفقة على مدار فترة الاستفادة.',
        consequence: 'عند منح بونص، يُفتتح خصم مستقبلي (عادة تحت فرع المسؤوليات 2xxx) بقيمة المنح. تُوزّع النفقة على مدار الفترة الفعلية للمكافأة.',
        accountingImpact: 'الخصم المستقبلي يتراكم؛ الإيراد غير منقوص حتى يُستهلك. لا يُعترف بإيراد ولا بنفقة كاملة عند المنح.',
        when: 'عند المنح (يفتح التزاماً)، مع توزيع النفقة على طول فترة الاستخدام.',
        dependencies: 'ACC-01 (طبيعة المنحة)؛ E1/E2. لا يعتمد على إعداد بونص حالي — يعتمد على قواعد البونص.',
        warning: 'المالك المالي (D7) غير مُعيَّن بعد؛ بدونه لا يمكن إقفال شركة الإدخال (ACC-10). لا تدمج هذا مع "درجة المعوزة" الحالية.',
      },
      {
        value: 'B',
        title: 'نفقة عند المنح',
        summary: 'يُعترف بالبونص كنفقة كاملة في لحظة المنح، قبل أي استهلاك.',
        consequence: 'كل منحة بونص تتحوّل إلى نفقة فورية (6000 وما يناط) عند المنح؛ لا يُفتتح أي خصم مستقبلي.',
        accountingImpact: 'ترتفع النفقة في الربع الذي يقع فيه المنح؛ دفق نقدي قد يختل بالبيع.',
        when: 'لحظة المنح فوراً (POSTED على صفّ البونص).',
        dependencies: 'ACC-01 (نفقة)؛ E1/E2. ملزم بأن يربط المنح بمنتج مُعتمد أو أمر.',
        warning: 'يسرّع الاعتراف الكامل؛ تأكّد ألا يخلق نفقةً مضاعفة مع بند آخر.',
      },
      {
        value: 'C',
        title: 'لا شيء حتى الاستخدام',
        summary: 'لا يُسجل شيء في المحاسبة عند المنح؛ يُعترف فقط عندما يُستهلك البونص.',
        consequence: 'محفظة البونص تنمو دون تسجيل إيراد ولا خصم مستقبلي؛ الاعتراف يتأخر حتى الاستهلاك الأول.',
        accountingImpact: 'صافر في دورة المسؤولية؛ لا نفقة ولا التزام عند المنح.',
        when: 'عند الاستهلاك الأول للبونص (E5/E7/E4)؛ ليس عند المنح.',
        dependencies: 'ACC-01 (لا شيء حتى الاستخدام)؛ يتطلب أن يبقى الاستهلاك مرئياً للمحاسبة عبر ربط مصدري (ACC-12).',
        warning: 'بدون ربط واضح بين صفّ البونص وقيد المحاسبة، يصبح من الصعب إثبات أن كل سطر استهلاك تم تغطيته. لا تختاره إذا لم يكن ربط المصدر مضموناً.',
      },
    ],
  },
  // ---------------------------------------------------------------- BD-02
  {
    id: 'BD-02',
    question: 'عند صرف البونص نقداً، كيف تُعالج العملية المالية؟',
    explanation:
      'يأتي هذا القرار من سؤال ACC-04 في PHASE-49: هل يُعامل السحب النقدي تسوية للالتزام، أم شراء نقدي للالتزام؟ الحدث E4 (الدفع، 0018:1282). أثناء ذلك، لا يزال السحب غير مرتبطاً بأي حركة نقدية بنكية (الكشف X1 غير مسجل)، لذا يحدّد هذا الاختيار شكل القيد المستقبلي فقط.',
    dependsOnKey: 'withdrawal_policy',
    dependsOnNote:
      'يتحكم withdrawal_policy في إتاحة وقواعد السحب (مُهيأ بـ {enabled:false، approval_required:true}). هذا القرار المالي مستقل عنه لكنه يتفاعل معه: يمكن تفعيل السحب قبل تحديد شكله المالي.',
    options: [
      {
        value: 'A',
        title: 'تسوية التزام بالنقد',
        summary: 'السحب يخفض التزاماً مستقبلياً: النقد يخرج، والتزام ينخفض.',
        consequence: 'عند الدفع، يُصدر قيد يقلل التزاماً مستقبياً ويسجل الصرف كحركة نقدية (1110/1120).',
        accountingImpact: 'التزام مستقبلي يُقلّص؛ النقد/البنك يُقلّص. لا إيراد ولا نفقة.',
        when: 'عند mark_withdrawal_paid (لحظة الدفع، 0018:1282) — ليس عند الطلب.',
        dependencies: 'ACC-04 (تسوية التزام)؛ ACC-05 (أي حساب نقدي — 1110 صندوق أم 1120 بنك)؛ E4. يتفاعل مع withdrawal_policy.',
        warning: 'لا يوجد قيد نقدي أو بنكي حالياً للسحب (X1)؛ هذا الاختيار يتطلب بناء ذلك أولاً. لا يدمجه مع "شراء" البونص نفسه.',
      },
      {
        value: 'B',
        title: 'شراء التزام بالنقد',
        summary: 'السحب يُعامل كشراء نقدي للتزام من العميل — النقد يخرج مقابل إزالة التزام.',
        consequence: 'يُسجل مدخنة نقدية ويُقلّص التزام؛ لكن التفسير هو "شراء" وليس "تسوية"، ما قد يُعاد النظر فيه بالتقارير.',
        accountingImpact: 'النقد يُقلّص؛ التزام مستقبلي يُقلّص — تأثير عددي متطابق، تفسير مختلف.',
        when: 'عند الدفع (mark_withdrawal_paid)؛ يتطلب حساباً نقدياً مُحدَّثاً.',
        dependencies: 'ACC-04 (شراء التزام)؛ ACC-05 (حساب النقد)؛ E4. يتفاعل مع withdrawal_policy.',
        warning: 'اختيار بين "تسوية" و"شراء" لغويات محاسبية؛ لا يغيّر حركة بالفعل إذا لم يُبنَ الجانب النقدي. لا يعوّض ربطاً نقدياً بالبنك.',
      },
    ],
  },
  // ---------------------------------------------------------------- BD-03
  {
    id: 'BD-03',
    question: 'عند استبدال البونص بمنتج، كيف تُقَيَّم التكلفة وتُعترف بها؟',
    explanation:
      'يأتي هذا القرار من سؤال ACC-03 في PHASE-49 (نقطة ومقياس تكلفة الاعتراف) وفضاء القيم §11.5 (V-1/V-2/V-3). الحدث E6 (التوفيد، 0018:931): لا يُكتب أي حركة مخزون ولا تكلفة مبيعات اليوم، ولا يقرأ أي عمود تكلفة. يحدّد هذا الاختيار قاعدة التكلفة إذا أُقيم ربطٌ مالي لاحقاً.',
    dependsOnKey: 'redemption_methods',
    dependsOnNote:
      'يتحكم redemption_methods في تفعيل/إلغاء استبدال المنتجات/الخصوم/النقد. هذا القرار المالي يتفاعل معه: إذا أُلغي استبدال المنتجات، فهذا الاختيار بلا معنى.',
    options: [
      {
        value: 'A',
        title: 'بسعر البيع',
        summary: 'قيمة الاستبدال = سعر بيع المنتج (unit_price × الكمية) — وهو ما يقرأه الكود اليوم (0018:831).',
        consequence: 'يُقلّص البونص ويُسلّم المنتج؛ إذا أُضيف ربطٌ مالي، يُستَخدم سعر البيع كقاعدة تكلفة.',
        accountingImpact: 'المخزون (1140) يُنقّص بسعر البيع، وتكلفة المبيعات (5000) تُعتمد بنفسه — ما يُهمش التكلفة الحقيقية.',
        when: 'عند التوفيد (FULFILL)؛ لا يوجد قيد حالياً.',
        dependencies: 'ACC-03 (نقطة تكلفة الاعتراف)؛ V-1 (سعر البيع) في §11.5؛ E6. يتفاعل مع redemption_methods.',
        warning: 'سعر البيع ليس التكلفة؛ قد يُظلّق التكلفة ويُنخّف الأرباح. لا تختاره إذا كانت لديك تكلفة حقيقية مُعرّفة.',
      },
      {
        value: 'B',
        title: 'بتكلفة المنتج',
        summary: 'قيمة الاستبدال = التكلفة الفعلية للمنتج. لا يوجد عمود تكلفة اليوم.',
        consequence: 'يتطلب إضافة عمود أو مصدر تكلفة على المنتجات ثم استخدامه في التوفيد.',
        accountingImpact: 'المخزون (1140) وتكلفة المبيعات (5000) تُعتمدان بتكلفة حقيقية — أدق.',
        when: 'عند التوفيد؛ تتطلب التكلفة المتاحة قبل النشر.',
        dependencies: 'ACC-03؛ V-2 (تكلفة المنتج) في §11.5؛ E6. يتطلب تكلفة مُعرّفة.',
        warning: 'ثغرة تطويرية: لا يوجد عمود تكلفة حالياً (X2 — الكشف غير مسجل). لا تختاره إذا لم تُحدَّد التكاليف بعد.',
      },
      {
        value: 'C',
        title: 'بقيمة القاعدة',
        summary: 'قيمة الاستبدال = القيمة الواردة في القاعدة (bonus_value/bonus_percent) بغض النظر عن الكتالوج.',
        consequence: 'التكلفة تُستند إلى ما جاء في القاعدة، غير مرتبطة بسعر أو تكلفة المنتج.',
        accountingImpact: 'تُعتمد 5000 على القيمة الواردة في القاعدة؛ قد لا تتفق مع تكلفة البضائع المتدفقة.',
        when: 'عند التوفيد؛ القيمة مأخوذة من القاعدة.',
        dependencies: 'ACC-03؛ V-3 (قيمة القاعدة) في §11.5؛ E6. يتفاعل مع redemption_methods.',
        warning: 'V-3 غير مرتبطة بتكلفة البضائع، لذا قد تنتج تكلفة مبيعات غير واقعية. لا تدمجها مع "بتكلفة المنتج" إذا كانت التكاليف مُعرّفة.',
      },
    ],
  },
  // ---------------------------------------------------------------- BD-04
  {
    id: 'BD-04',
    question: 'عند تطبيق خصم البونص على الطلب، كيف يُعرض الفاتورة؟',
    explanation:
      'يأتي هذا القرار من سؤال ACC-06 في PHASE-49: الفاتورة المُخفّضة تُعرض صافية (كما اليوم) أم إجماليةً مع تسويل البونص المنفصل؟ الحدث E8 (التوزيع، 0021:345). اليوم يُنشئ المشغل فاتورة صافية بمبلغ الخصم مطبقاً (0009:118-119).',
    dependsOnKey: 'discount.funding_scope',
    dependsOnNote:
      'يتحكم discount.funding_scope في محملات البونص التي تُستهلك (ALL_ELIGIBLE_LOTS / NARROW_ONLY). هذا القرار يثيره: المصادف التي تمويلها ضمن "نطاق ضيق" قد تُعرض بوضوح مختلفة.',
    options: [
      {
        value: 'A',
        title: 'فاتورة صافية (كما اليوم)',
        summary: 'الخصم يُخصم من إجمالي الطلب قبل الفاتورة؛ الإيراد = المبلغ الصافي.',
        consequence: 'يُنشأ قيد 1130/4000 على المبلغ الصافي؛ لا يوجد التزام بونص ولا قيد منفصل.',
        accountingImpact: 'العملاء (1130) والإيراد (4000) على الصافي فقط؛ الخصم غير مرئي للمحاسبة.',
        when: 'عند إنشاء الفاتورة بعد التوزيع (0009:108-133، E8).',
        dependencies: 'ACC-06 (صافٍ مقابل إجمالي)؛ E8؛ discount.funding_scope (أي محمل يموله).',
        warning: 'هذا هو السلوك الحالي ولا يُظهر الخصم المنفّذ من البونص. لا يعوّض ربط الفاتورة بالطلب (§6.3 — التتبع غير موجود).',
      },
      {
        value: 'B',
        title: 'فاتورة إجمالية مع تسويل مستقل',
        summary: 'الفاتورة على القيمة الكلية؛ يُسجَّل الخصم كتسويل بونص منفصل (يخفّض المستحقات / يفتح التزاماً).',
        consequence: 'يُنشأ قيد 1130/4000 على الإجمالي، ويُنشأ قيد منفصل لتسويل الخصم.',
        accountingImpact: 'العملاء (1130) والإيراد (4000) على الإجمالي؛ قيد منفصل يخفّض المستحقات أو يفتح التزاماً مستقبياً.',
        when: 'عند التوزيع؛ القيد الثانوي يرتبط بسطر البونص.',
        dependencies: 'ACC-06؛ E7/E8؛ discount.funding_scope؛ ACC-12 (ربط البونص بالقيد).',
        warning: 'يتطلب ربطاً بين الفاتورة والطلب (§6.3 — التتبع غير موجود) ورموزاً للتسويل المنفصل. لا تدمجه مع "صافٍ" إذا لم يُبنَ الربط.',
      },
    ],
  },
  // ---------------------------------------------------------------- BD-05
  {
    id: 'BD-05',
    question: 'عند إزالة عنصر من الطلب وإرجاع البونص الزائد (0026)، كيف يُعاد معالجة الخصم السابق؟',
    explanation:
      'الحدث: عند حذف عنصر من طلب، يُعاد حساب الخصم تناسبياً، ويُعاد البونص الزائد كصفّ REFUND في المُربّع (0026:108). هذا القرار يحدّد معالجة المحاسبة للإلغاء المناسب. يرتبط بقرار D7 (المالك المالي) — بدون مالك مالي مُعيَّن، لا يمكن إقفال شركة مناسبة له (ACC-10).',
    dependsOnNote: NO_SETTING,
    options: [
      {
        value: 'A',
        title: 'عكس تعويضي',
        summary: 'يُصدر قيداً مرآةً يعكس اعتراف الخصم الأصلي، ويرتبط بالصف الأصلي عبر reverses_id.',
        consequence: 'الإرجاع يُرجع التزام/الخصم إلى ما كان عليه قبل الخصم عند إزالة العنصر؛ يُسجَّل كـ REVERSAL/REFUND POSTED.',
        accountingImpact: 'قيد مرآة بنفس الحسابات والعلامة المعاكسة؛ يُلغي أو يُعدّل قيد E7/E8 الأصلي.',
        when: 'عند معالجة إزالة العنصر (0026)؛ يرتبط بصفّ البونص الأصلي.',
        dependencies: 'ACC-01 (طبيعة الخصم الأصلي)؛ ACC-06 (كيف كان الخصم معروضاً)؛ ACC-12 (ربط المصدر عبر reverses_id)؛ E9/E10.',
        warning: 'العكس يجب أن يعكس بالضبط كيف سُجِّل الخصم في BD-04؛ لا تعكسه بعكس مختلف. يتطلب مالكاً مالياً (D7) للموافقة.',
      },
      {
        value: 'B',
        title: 'تعديل ضمني في إعادة التسعير',
        summary: 'بدون قيد منفصل — يُمحّى الخصم ويُعاد تسعير الفاتورة، والفرق يُمحى.',
        consequence: 'الإرجاع يُعادل ضمن إعادة تسعير الفاتورة؛ لا يُنشئ قيداً مرآةً منفصلاً.',
        accountingImpact: 'تعديل الفاتورة الأصلية (أو إلغاؤها وإنشاء أخرى)؛ لا قيد محاسبي منفصل.',
        when: 'مع إعادة تسعير الفاتورة بعد إزالة العنصر.',
        dependencies: 'ACC-06 (فاتورة صافية/إجمالية)؛ E8 (الربط بين الفاتورة والخصم).',
        warning: 'لا يعمل إذا كانت الفاتورة مُرسّخة (posted) ولا يمكن تعديلها. لا تدمجه مع "عكس تعويضي" — اختر إحدى الطريقتين.',
      },
    ],
  },
  // ---------------------------------------------------------------- BD-06
  {
    id: 'BD-06',
    // الحرف المنع شبه: انتهاء الصلاحية لا يعني تلقائياً تحويل البونص إلى إيراد.
    question: 'ما هو أثر انتهاء صلاحية البونص غير المستخدم؟',
    explanation:
      'تنبّه أمني: انتهاء الصلاحية لا يعني تلقائياً أن البونص يصبح إيراداً. يأتي هذا القرار من سؤال ACC-07 في PHASE-49: ماذا يحدث عند الانتهاء — إلغاء، تخفيض التزام (مقابض مضادة)، أو إيراد بالتحويل؟ الحدث E11 (expire_bonus، 0018:1466). اختيار "إيراد بالتحويل" هو قرار صريح للمالك، وليس نتيجة تلقائية لانتهاء الصلاحية.',
    dependsOnKey: 'expiry_policy',
    dependsOnNote:
      'يتحكم expiry_policy.expiry_days في نافذة الانتهاء (يجب تكوينه بقيمة > 0 لتشغيل expire_bonus، 0018:1430-1439). هذا القرار يحدّد ما يُسجل عند الانتهاء.',
    options: [
      {
        value: 'A',
        title: 'بدون إدخال',
        summary: 'ينتهي البونص ولا يُنشئ قيداً؛ يُمحى التزامه من المشتقات فقط.',
        consequence: 'انتهاء الصلاحية يزيل القيمة من مشتقات العميل؛ لا يُعترف بإيراد ولا يُقلّص أي التزام مسجّل.',
        accountingImpact: 'لا يوجد أي تأثير محاسبي — هذه هي الحالة الحالية (لا يكتب أي journal، §3.13/§7.7.11).',
        when: 'عند تشغيل expire_bonus (E11)؛ لا يوجد تأثير في أي فترة.',
        dependencies: 'ACC-07 (بدون شيء)؛ E11؛ expiry_policy.expiry_days.',
        warning: 'يترك التزاماً غير مسجل في أي تقرير مالي — هذا هو الانطباع غير المرئي X3. لا يغطي التزاماً حقيقياً.',
      },
      {
        value: 'B',
        title: 'تخفيض التزام (مقابض مضادة، بدون إيراد)',
        summary: 'ينتهي البونص ويُقلّص التزامه المستقبلي عبر مقابض مضادة — دون أن يُعامل كإيراد.',
        consequence: 'الانتهاء يقلّص التزاماً مستقبلياً (مثلاً عبر مقابض مضادة ضده)؛ القيمة المنتهية تُنتقل إلى حساب تسويل/حيفظة، وليس إلى إيراد.',
        accountingImpact: 'مقابض مضادة على التزام مستقبلي؛ لا إيراد مُعترف به. لا يُنتج إيراداً ولا يقلّص صافي الإيراد.',
        when: 'عند expire_bonus (E11)؛ يُنشأ المقابض المضادة في نفس الوقت أو عند إغلاق الفترة.',
        dependencies: 'ACC-07 (تخفيض التزام / مقابض مضادة)؛ E11؛ ACC-05 (حساب التسويل).',
        warning: 'هذا الاختيار لا يفترض إيراداً — الصياغة "بدون إيراد" جوهرية. لا تخلطه بـ "إيراد بالتحويل". يتطلب حساب تسويل مُعرّف.',
      },
      {
        value: 'C',
        title: 'إيراد بالتحويل (اختيار صريح للمالك)',
        summary: 'يُحوَّل البونص المنتهي إلى إيراد بالتحويل — لكن هذا قرار صريح للمالك، وليس نتيجة تلقائية لانتهاء الصلاحية.',
        consequence: 'القيمة المنتهية تُعترف بها كإيراد بالتحويل؛ هذا يعدل صافي الإيراد.',
        accountingImpact: 'إيراد بالتحويل (فرع 4000) مع إلغاء المقابض ضد التزام مستقبلي.',
        when: 'عند expire_bonus أو إغلاق الفترة — يحدده المالك.',
        dependencies: 'ACC-07 (إيراد بالتحويل)؛ ACC-14 (المالك المسمّى يوافق)؛ E11؛ ACC-08 (أي فترة تملك الإيراد).',
        warning: '⚠️ هذا الخيار هو الوحيد الذي يُنتج إيراداً. انتهاء الصلاحية لا يعني تلقائياً إيراداً — إنه اختيار صريح يتطلب موافقة المالك (ACC-14/D7). لا تُطبّقه بشكل افتراضي ولا كنتيجة متراكمة للانتهاء.',
      },
    ],
  },
  // ---------------------------------------------------------------- BD-07
  {
    id: 'BD-07',
    question: 'عند عكس معاملة بونصية، كيف يُعاد معالجة الاعتراف المحاسبية؟',
    explanation:
      'مرتبط بـ E9 (عكس تلقائي للخصم عند الإلغاء، 0021:134) وE10 (عكس يدوي من المدير، 0018:1393). القاعدة الأساسية: كل مراجعة تحمل reverses_id على العكس (0018:1395، 0021:134-138)، لذا لا قيد "دائم". يحدّد هذا الاختيار ما إذا يُنشئ العكس قيداً مرآة أم يُختزل صافياً في الفترة.',
    dependsOnKey: 'discount.cancellation_mode',
    dependsOnNote:
      'يتحكم discount.cancellation_mode في معالجة إلغاء الخصم (AUTOMATIC_REVERSAL / MANUAL_REVERSAL). هذا القرار المالي يتفاعل معه: الوضع MANUAL_REVERSAL يتطلب تعريف عكس المحاسبة يدوياً.',
    options: [
      {
        value: 'A',
        title: 'قيد مرآة',
        summary: 'لكل عكس يُنشأ قيد مرآة (نفسه المعاكس) موجّه إلى الصف الأصلي عبر reverses_id، بتاريخ العكس.',
        consequence: 'العكس يغلق القيد الأصلي بقيد مضاد؛ السجل الكامل يظل مرئياً.',
        accountingImpact: 'قيد مرآة بنفس الحسابات والعلامة المعاكسة؛ لا يُدمج في غيره.',
        when: 'مع كل صفّ REVERSAL (E9/E10/E11) — يرافقه قيد محاسبي في نفس المعاملة.',
        dependencies: 'ACC-12 (ربط العكس بالأصل عبر reverses_id)؛ E9/E10/E11؛ القاعدة: العكس لا يُعكس.',
        warning: 'ليس خطأ تاريخياً، لكن إنشاء قيد مرآة يتطلب أن يكون لكل حساب مصغّر مُعرّف. لا يدمجه مع "تسويل صافي".',
      },
      {
        value: 'B',
        title: 'تسويل صافي',
        summary: 'العكس لا يُنشئ قيداً منفصلاً؛ يُختزل في صافي الفترة دون سطر مرآة.',
        consequence: 'النتيجة الصافية عبر الفترة تتحقق بينما تُختزل التفاصيل الفردية.',
        accountingImpact: 'تأثير صافية في دفاتر الفترة؛ لا قيد مرآة مرئي لكل عملية.',
        when: 'عند غلق الفترة — يُختزل المتبقي.',
        dependencies: 'ACC-08 (ما تملكه الفترة)؛ ACC-09 (سلوك الفترات المغلقة)؛ E9/E10.',
        warning: 'يقلّص الشفافية؛ لا يمكن تتبع عملية بوضوح. غير مناسب لبيئات تتطلب تدقيقاً تفصيلياً لكل عملية.',
      },
    ],
  },
  // ---------------------------------------------------------------- BD-08
  {
    id: 'BD-08',
    question: 'متى وكيف يُشغَّل التوثيق المالي بالنسبة لحدث البونص؟',
    explanation:
      'يأتي هذا القرار من §11.1 (أين يُشغَّل النشر: T-1 منبثق/ T-2 صريح/ T-3 دوري) و§11.3 (حالة النشر S-1 مسودة/ S-2 فوري/ S-3 جزئي) وACC-08/ACC-09. يحدّد متى وكيف يُنشر القيد — ليس ما إذا يُنشر (محتوى مشاركة مالية)، بل متى وكيف.',
    dependsOnNote: NO_SETTING,
    options: [
      {
        value: 'A',
        title: 'فوري عند الحدث',
        summary: 'يُنشر قيد المحاسبة في لحظة وقوع الحدث على البونص (استدعاء صريح T-2، أو منبثق T-1 على إدراج الصف) ويُنشر فوراً.',
        consequence: 'قيود المحاسبة تظهر في نفس الفترة مهما وقع فيها الحدث.',
        accountingImpact: 'تسجيل فوري لكل حدث؛ لا تأخير.',
        when: 'مع كل صفّ POSTED على مُربّع البونص (E1-E12).',
        dependencies: '§11.1 (T-1/T-2)؛ §11.3 (S-2)؛ ACC-09 (ليس مسودة).',
        warning: 'المنشور فوراً لا يمكن تعديله (0008:29-44)؛ يتطلب إغلاقاً صحيحاً للفترات. غير مناسب لبيئات غير مستقرة.',
      },
      {
        value: 'B',
        title: 'مسودة عند الحدث، نشر لاحق',
        summary: 'يُنشئ القيد مسودة عند الحدث (S-1) ويُنشر بعد موافقة يدوية.',
        consequence: 'الحدث يُسجَّل كمسودة؛ يضغط المالك على "نشر" لتثبيته.',
        accountingImpact: 'مسودات تنتظر المراجعة؛ الصافي غير مُعتمد حتى النشر.',
        when: 'مسودة عند الحدث؛ نشر عند الموافقة (يدوي/آلي).',
        dependencies: '§11.3 (S-1)؛ ACC-11 (مسودة مقابل فوري)؛ دور المالك المسؤول.',
        warning: 'قد تتجمع المسودات غير المنشورة بلا رقابة. لا تختارها إذا لم يكن المالك متاحاً للمراجعة الدورية.',
        unavailable: true,
        unavailabilityReason: 'BD-08 B يتطلب مُنسق جدولة (T-1 draft → T-2 review) غير متوفر؛ الخلفية SQL تُغلق الفشل بـ ACCOUNT_MAPPING_REQUIRED (قاعدة التقييم غير متوفرة).',
      },
      {
        value: 'C',
        title: 'دفعة دورية (مقطوعة)',
        summary: 'تُتراكم أحداث البونص وتُنشر في دفعة مجدولة (T-3 — Sweep)، مفككة عن اللحظة التشغيلية.',
        consequence: 'يُنشر قيد واحد أو عدة قيد لكل دفعة؛ قد يتأخر إلى فترة أخرى.',
        accountingImpact: 'قيد مُجمّع في دفاتر الدفعة؛ تأخير محتمل.',
        when: 'عند تشغيل المهمة الدورية (T-3) — ليس عند الحدث.',
        dependencies: '§11.1 (T-3)؛ §11.3 (S-3/S-1)؛ ACC-08 (أي فترة تملك الحدث المتأخير)؛ ACC-09 (للفترات المغلقة).',
        warning: 'التأخير يعني أن حدثاً قد يُنشر في فترة مختلفة عن وقوعه. يتطلب علامة "منشور" غير موجودة اليوم (§4.3 السؤال Q6 — التتبع غير موجود).',
        unavailable: true,
        unavailabilityReason: 'BD-08 C يتطلب مهامة جدولة دورية (T-3 Sweep) غير متوفرة؛ الخلفية SQL (0028) تُغلق الفشل بـ TIMING_INFRASTRUCTURE_REQUIRED.',
      },
    ],
  },
  // ---------------------------------------------------------------- BD-09
  {
    id: 'BD-09',
    question: 'كيف تُجمع إدخالات المحاسبة الناتجة عن أحداث البونص؟',
    explanation:
      'مرتبط بـ §11.3 (حالة النشر S-1/S-2/S-3) وACC-11 (نشر فوري مقابل مسودة مقابل جزئي). اليوم، مسار الفاتورة ينشئ قيداً واحداً لكل فاتورة (0009:108-133، E8) — لا يوجد آلية تجميع للبونص.',
    dependsOnNote: NO_SETTING,
    options: [
      {
        value: 'A',
        title: 'قيد واحد لكل حدث',
        summary: 'كل صفّ بونص POSTED يُنتج قيداً محاسبياً منفصلاً (1:1) — أقصى تفصيل.',
        consequence: 'يدخل سطر منفرد لكل عملية بونص؛ سهل التتبع لكنه قد يكون كثيفاً.',
        accountingImpact: 'كمّية قيد منفرد؛ كل قيد يحمل مرجعاً لصف البونص (ACC-12).',
        when: 'مع كل صفّ POSTED (نفس اللحظة التي يحددها BD-08).',
        dependencies: 'ACC-12 (مرجع إلزامي)؛ §11.3 (S-2 فوري)؛ نموذج E8 الآن.',
        warning: 'قد ينتج كمّية كبيرة من القيد. غير مناسب لبيئات عالية الحجم بدون تجميع إداري.',
      },
      {
        value: 'B',
        title: 'مسودة لكل حدث، إصدار مراجعة',
        summary: 'كل حدث يُنشئ مسودة قيد؛ يمراجعها المالك ويصدر دفعات مراجعة.',
        consequence: 'تُنشأ مسودات فردية ثم تُدفع حزمةً بعد الموافقة.',
        accountingImpact: 'مسودات منفردة في انتظار الإصدار؛ إمكان مراجعة قبل التثبيت.',
        when: 'مسودة عند الحدث؛ إصدار دُفأة من المراجعة.',
        dependencies: 'ACC-11 (نموذج المسودة)؛ §11.3 (S-1)؛ D7 (المالك يصدر).',
        warning: 'يتطلب مالكاً مالياً نشطاً للمراجعة (D7). بدونه، تُتراكم المسودات غير المنشورة.',
      },
      {
        value: 'C',
        title: 'توحيد دوري',
        summary: 'تُتراكم أحداث البونص وتُنشر كبيان صافية واحدة في إغلاق الفترة.',
        consequence: 'يُلغي التفاصيل الداخلية للفترة في صفيحة واحدة مُجمّعة.',
        accountingImpact: 'قيد واحد مُجمّع/صفيحة دورية؛ التفاصيل الداخلية غير مرئية.',
        when: 'عند إغلاق الفترة — دوري.',
        dependencies: 'ACC-08 (الفترة المالكة)؛ ACC-11 (S-3 جزئي / T-3 sweep)؛ نموذج E8/E9 للمراجعة.',
        warning: '⚠️ يحذف التفاصيل الداخلية؛ غير مناسب لبيئات تتطلب تدقيقاً تفصيلياً (ACC-12 قد يصبح غير كافٍ).',
        unavailable: true,
        unavailabilityReason: 'BD-09 C يتطلب مهامة جدولة دورية (T-3 Sweep) غير متوفرة، بالإضافة إلى مفتاح توحيد محدد بشركة (ACC-10 — bonus_ledger لا يحمل company_id). الخلفية SQL (0030) تُغلق الفشل بـ POSTING_INFRASTRUCTURE_REQUIRED.',
      },
    ],
  },
  // ---------------------------------------------------------------- BD-10
  {
    id: 'BD-10',
    question: 'كيف يُنسّق محاسبة البونص مع شركة المجموعة وإطار الحسابات (COA)؟',
    explanation:
      'يأتي هذا القرار من ACC-10 (أي شركة تملك حدث البونص — العلاقة المنضمة) و§11.4 (أهيل الشركة: C-1 إضافة عمود/ C-2 ربط الفرع/ C-3 فرضية شركة واحدة) و§5.2 (الإطار الحسابي المزروع — 15 رمزاً). لا توجد رموز خصم مستقبلي أو تكلفة بونص في الإطار الحالي.',
    dependsOnNote: NO_SETTING,
    options: [
      {
        value: 'A',
        title: 'شركة واحدة + إطار حسابات موجود',
        summary: 'محفظة بونص واحدة؛ يُنشر ضد الإطار الحسابي المزروع (§5.2) مع إضافة رمز خصم مستقبلي لاحقاً.',
        consequence: 'جميع قيد البونص تُنسب إلى شركة واحدة؛ يُعاد استخدام الإطار الحالي.',
        accountingImpact: 'إعادة استخدام أكواد 1130/4000/5000/6000... مع إضافة رمز خصم مستقبلي (2xxx) لاحقاً.',
        when: 'عند النشر — تُحلّ الشركة كما يفعل المساعد الحالي (order by created_at limit 1، 0009:57-60).',
        dependencies: 'ACC-10 (شركة واحدة)؛ §11.4 (C-3)؛ §5.2؛ لا يعتمد على إعداد بونص.',
        warning: 'يعمل فقط بينما توجد شركة واحدة. بمجرد إضافة شركة ثانية، يُسجَّل كل شيء على الشركة الخاطئة.',
      },
      {
        value: 'B',
        title: 'محفظة متعددة الشركات',
        summary: 'تُضاف أعمدة شركة إلى جداول البونص بحيث يُنسّب كل انتاجية إلى شركتها.',
        consequence: 'كل حدث بونص يحمل company_id؛ النشر يُنسّق بدقة.',
        accountingImpact: 'تكوين قيد موجه بدقة لكل شركة؛ لا تداخل.',
        when: 'بعد إضافة أعمدة الشركة وتحديث جميع RPC.',
        dependencies: 'ACC-10؛ §11.4 (C-1)؛ §4.2 (الحاجة المنضمة).',
        warning: '⚠️ هذا تغيير مخطط — يتطلب مهاجرة (ممنوعة في هذه المرحلة). لا تختاره إذا لم يُقبل التعديل.',
      },
      {
        value: 'C',
        title: 'ربط الفرع بالشركة عند النشر',
        summary: 'لا تُضاف أعمدات شركة؛ بل يُحلّ الشراب من الفرع/النطاق عند النشر.',
        consequence: 'الربط يعتمد على بيانات الفرع/المستخدم؛ يُنسّب الحدث إلى شركة الفرع الصالح.',
        accountingImpact: 'تكوين قيد موجه لشركة فرع مرتبطة؛ يتطلب خريطة فرع→شركة.',
        when: 'عند النشر — يُحلّ الشركة.',
        dependencies: 'ACC-10؛ §11.4 (C-2)؛ §4.2؛ خريطة فرع→شركة غير موجودة اليوم.',
        warning: '⚠️ بعض أحداث البونص غير مرتبطة بفرع (سحب، انتهاء صلاحية — على مستوى العميل). ربما لا ينجح الربط. يتطلب خريطة فرع→شركة.',
      },
    ],
  },
];

/**
 * Look up a policy by its id (e.g. "BD-03"). Returns `undefined` if unknown.
 */
export function getPolicy(id: string): AccountingPolicy | undefined {
  return ACCOUNTING_POLICIES.find((p) => p.id === id);
}
