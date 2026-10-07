import { EditableSettingsSection } from '@/components/director/EditableSettingsSection';

/** ⏳ انتهاء صلاحية البونص — expiry_policy. */
export function BonusExpirationSection() {
  return (
    <EditableSettingsSection
      title="انتهاء صلاحية البونص"
      description="عدد الأيام بعد اكتساب البونص قبل أن يُنتهي صلاحيته تلقائياً. ملزمة من قبل RPC expire_bonus (server-side)."
      keys={['expiry_policy']}
      showUnmodelled
    />
  );
}
