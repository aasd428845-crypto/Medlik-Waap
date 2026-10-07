/**
 * Metadata registry for the `bonus_settings` key/value table.
 *
 * PURPOSE
 *   This file is the SINGLE source of the human-readable definitions for every
 *   bonus policy key. It deliberately contains NO business logic and NO data
 *   fetching — it only describes *how* each setting should be rendered and
 *   labelled. The actual values live in `public.bonus_settings` (key / jsonb);
 *   the rendering logic lives in `SettingsCategoryCard`.
 *
 *   Keeping the definitions here (separate from the components) satisfies the
 *   requirement that option texts be manageable independently and displayable
 *   to the director, without living inside business logic.
 *
 * FIELD MODEL
 *   Each setting is one row in `bonus_settings` (key + jsonb value).
 *   - Scalar values (e.g. `currency` = "YER", `discount.allow_zero_order` = false)
 *     are rendered with a single field whose `path` is "" (root value).
 *   - Object values (e.g. `withdrawal_policy` = { enabled, min_amount, ... })
 *     are rendered with multiple fields whose `path` points at a property.
 */

export type FieldKind = 'toggle' | 'text' | 'number' | 'select' | 'currency' | 'json';

export interface SettingOption {
  value: string;
  label: string;
  hint?: string;
}

export interface SettingField {
  /** Property path inside the jsonb value. Empty string = the value itself (scalar). */
  path: string;
  label: string;
  hint?: string;
  kind: FieldKind;
  /** Options for `select` fields. */
  options?: SettingOption[];
  /** Min/max/step for `number` / `currency` fields. */
  min?: number;
  max?: number;
  step?: number;
  /** Allow null / empty value (for settings that are intentionally unset). */
  nullable?: boolean;
}

export interface SettingSectionMeta {
  /** DB key in `bonus_settings`. */
  key: string;
  title: string;
  description?: string;
  fields: SettingField[];
}

/**
 * Which sidebar section each settings group belongs to.
 * Keys match the `SECTION_IDS` used by the internal sidebar.
 */
export const SETTINGS_BY_SECTION: Record<string, SettingSectionMeta[]> = {
  /** ⚙️ الإعدادات العامة */
  general: [
    {
      key: 'currency',
      title: 'العملة',
      description: 'رمز العملة المستخدمة في محفظة البونص. لا يتوفر حوالة عملات.',
      fields: [
        { path: '', label: 'رمز العملة', hint: 'مثال: YER', kind: 'text', nullable: false },
      ],
    },
    {
      key: 'notifications',
      title: 'إشعارات البونص',
      description: 'إعدادات إرسال الإشعارات للعملاء حسب نوع الحدث (jsonb).',
      fields: [
        { path: '', label: 'إعدادات الإشعارات', kind: 'json', hint: 'أرسل كائن JSON فارغ {} لتعطيل الاشعارات، أو عين المفاتيح حسب الحدث.' },
      ],
    },
  ],

  /** 💵 السحب النقدي */
  withdrawal: [
    {
      key: 'withdrawal_policy',
      title: 'سياسة السحب النقدي',
      description: 'يتحكم في إتاحة وقواعد سحب البونص نقداً. ملزمة من قبل RPC withdraw_bonus (server-side).',
      fields: [
        { path: 'enabled', label: 'تفعيل السحب النقدي', hint: ' يتيح للعملاء سحب رضاهم نقداً.', kind: 'toggle' },
        { path: 'approval_required', label: 'يتطلب موافقة إدارية', hint: 'يتطلب موافقة مدير قبل التنفيذ.', kind: 'toggle' },
        { path: 'min_amount', label: 'الحد الأدنى للسحب (ر.ي)', kind: 'number', min: 0, step: 100, nullable: true },
        { path: 'max_amount', label: 'الحد الأقصى للسحب (ر.ي)', kind: 'number', min: 0, step: 100, nullable: true },
        { path: 'monthly_max', label: 'الحد الشهري الأقصى (ر.ي)', kind: 'number', min: 0, step: 100, nullable: true },
      ],
    },
  ],

  /** 🎁 استبداع البونص */
  redemption: [
    {
      key: 'redemption_methods',
      title: 'طرق الاسترداد المسموحة',
      description: 'فعّل أو عطّل كل نوع من استبداع البونص. ملزمة من قبل RPC redeem_bonus (server-side).',
      fields: [
        { path: 'product', label: 'إرفاق منتجات', hint: 'استبداع البونص بمنتج مجاني.', kind: 'toggle' },
        { path: 'discount', label: 'خصم على الطلب', hint: 'تحويل البونص إلى خصم على الطلب.', kind: 'toggle' },
        { path: 'cash', label: 'سحب نقدي', hint: 'تحويل البونص إلى سحب نقدي.', kind: 'toggle' },
      ],
    },
  ],

  /** 🧮 خصم البونص من الطلب */
  order_discount: [
    {
      key: 'discount.allow_zero_order',
      title: 'السماح بطلب بقيمة صفر',
      description: 'هل يُسمح للعميل بإرسال طلب بقيمة صفر مع تطبيق خصم البونص؟ ملزمة من قبل RPC apply_bonus_discount (server-side).',
      fields: [
        { path: '', label: 'السماح بطلب بقيمة صفر', kind: 'toggle', hint: 'نعم — يُسمح بإرسال طلب فارغ مع الخصم. لا — يتطلب الطلب قيمة موجبة.' },
      ],
    },
    {
      key: 'discount.funding_scope',
      title: 'نطاق تمويل الخصم',
      description: 'أي محملات بونص تُستهلك عند تطبيق الخصم. ملزمة من قبل RPC apply_bonus_discount (server-side).',
      fields: [
        {
          path: '',
          label: 'نطاق التمويل',
          kind: 'select',
          hint: 'جميع الكميات المؤهلة — يُستهلك من كل محمل بونص صالح للخصم. تفعيل فقط — يُستهلك من أقدم محمل واحد.',
          options: [
            { value: 'ALL_ELIGIBLE_LOTS', label: 'جميع الكميات المؤهلة' },
            { value: 'NARROW_ONLY', label: 'أقدم كمية واحدة' },
          ],
        },
      ],
    },
    {
      key: 'discount.min_amount',
      title: 'الحد الأدنى للطلب (ر.ي)',
      description: 'أقل قيمة طلب يُطبَّق عليه خصم البونص. فارغ = بدون حد أدنى.',
      fields: [
        { path: '', label: 'الحد الأدنى للطلب (ر.ي)', kind: 'number', min: 0, step: 100, nullable: true },
      ],
    },
    {
      key: 'discount.max_amount',
      title: 'الحد الأقصى للخصم (ر.ي)',
      description: 'أقصى مبلغ خصم ثابت لكل طلب. فارغ = بدون حد.',
      fields: [
        { path: '', label: 'الحد الأقصى (ر.ي)', kind: 'number', min: 0, step: 100, nullable: true },
      ],
    },
    {
      key: 'discount.max_percent',
      title: 'الحد الأقصى للنسبة (%)',
      description: 'أقصى نسبة خصم لكل طلب. فارغ = بدون حد.',
      fields: [
        { path: '', label: 'الحد الأقصى للنسبة (%)', kind: 'number', min: 0, max: 100, step: 0.1, nullable: true },
      ],
    },
  ],

  /** ↩️ الإلغاء والعكس */
  cancellation: [
    {
      key: 'discount.cancellation_mode',
      title: 'طريقة معالجة إلغاء الخصم',
      description: 'ماذا يحدث لخصم البونص عند إلغاء أو إرجاع الطلب؟ ملزمة من قبل RPC cancel_order / refund_bonus (server-side).',
      fields: [
        {
          path: '',
          label: 'طريقة الإلغاء',
          kind: 'select',
          hint: 'عكس تلقائي — يُعكس الخصم آلياً عند الإلغاء. عكس يدوي — يظل الخصم معلقاً حتى مراجعته يدوياً.',
          options: [
            { value: 'AUTOMATIC_REVERSAL', label: 'عكس تلقائي' },
            { value: 'MANUAL_REVERSAL', label: 'عكس يدوي' },
          ],
        },
      ],
    },
  ],

  /** ⏳ انتهاء البونص */
  expiration: [
    {
      key: 'expiry_policy',
      title: 'سياسة انتهاء صلاحية البونص',
      description: 'عدد الأيام بعد اكتساب البونص قبل أن يُنتهي صلاحيته تلقائياً. ملزمة من قبل RPC expire_bonus (server-side).',
      fields: [
        { path: 'expiry_days', label: 'عدد أيام الصلاحية', hint: 'مثال: 365. البونص غير المستخدم يُنتهي بعد هذا العدد من الأيام.', kind: 'number', min: 1, step: 1, nullable: true },
      ],
    },
  ],
};

/** Flat lookup of every modelled setting key → its metadata. */
export const SETTINGS_BY_KEY: Record<string, SettingSectionMeta> = (() => {
  const map: Record<string, SettingSectionMeta> = {};
  for (const sections of Object.values(SETTINGS_BY_SECTION)) {
    for (const s of sections) map[s.key] = s;
  }
  return map;
})();

/**
 * Returns every known setting key (used to detect settings that exist in the
 * DB but are not yet modelled — they still render via the generic fallback).
 */
export function knownSettingKeys(): string[] {
  const keys: string[] = [];
  for (const sections of Object.values(SETTINGS_BY_SECTION)) {
    for (const s of sections) {
      if (!keys.includes(s.key)) keys.push(s.key);
    }
  }
  return keys;
}
