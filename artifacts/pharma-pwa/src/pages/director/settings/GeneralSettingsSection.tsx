import { EditableSettingsSection } from '@/components/director/EditableSettingsSection';

/** ⚙️ الإعدادات العامة — currency + notifications. */
export function GeneralSettingsSection() {
  return (
    <EditableSettingsSection
      title="الإعدادات العامة"
      description="إعدادات التطبيق العامة لمرفق البونص والمحفظة المالية."
      keys={['currency', 'notifications']}
      showUnmodelled
    />
  );
}
