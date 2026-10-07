import { EditableSettingsSection } from '@/components/director/EditableSettingsSection';

/** 🧮 خصم البونص من الطلب — discount.* keys. */
export function OrderDiscountSection() {
  return (
    <EditableSettingsSection
      title="خصم البونص على الطلب"
      description="إعدادات تطبيق خصم البونص على قيمة الطلب. تُنفّذها RPC apply_bonus_discount على المستوى الخادم."
      keys={[
        'discount.allow_zero_order',
        'discount.funding_scope',
        'discount.min_amount',
        'discount.max_amount',
        'discount.max_percent',
      ]}
      showUnmodelled
    />
  );
}
