import { EditableSettingsSection } from '@/components/director/EditableSettingsSection';

/** 🎁 استبداع البونص — redemption_methods. */
export function BonusRedemptionSection() {
  return (
    <EditableSettingsSection
      title="استبداع البونص"
      description="فعّل أو عطّل طرق استبداع البونص (منتج، خصم، سحب نقدي). تُنفّذها RPC redeem_bonus على المستوى الخادم."
      keys={['redemption_methods']}
      showUnmodelled
    />
  );
}
