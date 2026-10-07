import { Outlet, useLocation } from 'react-router-dom';
import { BonusSettingsSidebar, SETTINGS_SECTIONS } from '@/components/director/BonusSettingsSidebar';

/**
 * Internal layout for the Bonus Settings Control Center.
 *
 * Renders inside the existing DirectorLayout `<main>` (which already provides
 * the top page header and the left application navigation), so this layout only
 * owns the *internal* sidebar that switches between the 11 settings sections.
 *
 * The default (index) section is handled by a nested `<Route index>` in
 * `App.tsx` that redirects to `general`, so this layout only needs to read
 * the active section from the URL for the header.
 */
export function BonusSettingsLayout() {
  const location = useLocation();

  const activeSection =
    SETTINGS_SECTIONS.find((s) => location.pathname === `/director/bonus-fin/settings/${s.path}`) ??
    SETTINGS_SECTIONS[0]!;

  return (
    <div className="flex h-full min-h-[calc(100dvh-74px)] flex-col">
      <div className="flex items-center justify-between border-b border-border/80 px-1 pb-3 pt-1">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight">مركز إعدادات البونص والمالية</h2>
          <p className="text-xs text-muted-foreground">
            {activeSection.title} — إدارة إعدادات البونص، القواعد، السحب والاستبداع والسياسات المحاسبية.
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <BonusSettingsSidebar />

        <main className="director-scrollbar min-h-0 flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
