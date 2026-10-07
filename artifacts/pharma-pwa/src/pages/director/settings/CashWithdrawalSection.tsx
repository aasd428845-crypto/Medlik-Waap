import { EditableSettingsSection } from '@/components/director/EditableSettingsSection';

/** 💵 السحب النقدي — withdrawal_policy. */
export function CashWithdrawalSection() {
  return (
    <EditableSettingsSection
      title="السحب النقدي"
      description="إعدادات سحب رضاية البونص نقداً. تُنفّذها RPC withdraw_bonus على المستوى الخادم."
      keys={['withdrawal_policy']}
      showUnmodelled
    />
  );
}
