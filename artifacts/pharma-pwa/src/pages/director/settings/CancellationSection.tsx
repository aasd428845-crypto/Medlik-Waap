import { EditableSettingsSection } from '@/components/director/EditableSettingsSection';

/** ↩️ الإلغاء والعكس — discount.cancellation_mode. */
export function CancellationSection() {
  return (
    <EditableSettingsSection
      title="الإلغاء والعكس"
      description="ماذا يحدث لخصم البونص وعند إلغاء أو إرجاع الطلب. ملزمة من قبل RPC cancel_order / refund_bonus (server-side)."
      keys={['discount.cancellation_mode']}
      showUnmodelled
    />
  );
}
