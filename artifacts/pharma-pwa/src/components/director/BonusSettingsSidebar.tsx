import type React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Settings,
  Gift,
  Layers,
  BookOpenText,
  Landmark,
  Banknote,
  PackageCheck,
  Receipt,
  RotateCcw,
  AlarmClock,
  FileSearch,
  BarChart3,
} from 'lucide-react';

export interface SettingsSection {
  id: string;
  title: string;
  label: string;
  icon: React.ElementType;
  /** Path relative to `/director/bonus-fin/settings`. */
  path: string;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'general', title: 'الإعدادات العامة', label: 'العامة', icon: Settings, path: 'general' },
  { id: 'bonus-system', title: 'نظام البونص', label: 'نظام البونص', icon: Gift, path: 'bonus-system' },
  { id: 'manage-rules', title: 'إدارة قواعد البونص', label: 'القواعد', icon: Layers, path: 'manage-rules' },
  { id: 'financial-rules', title: 'القواعد المالية', label: 'المالية', icon: BookOpenText, path: 'financial-rules' },
  { id: 'accounting-policies', title: 'سياسات المحاسبة', label: 'سياسات', icon: Landmark, path: 'accounting-policies' },
  { id: 'cash-withdrawal', title: 'السحب النقدي', label: 'السحب', icon: Banknote, path: 'cash-withdrawal' },
  { id: 'bonus-redemption', title: 'استبداع البونص', label: 'الاستبداع', icon: PackageCheck, path: 'bonus-redemption' },
  { id: 'order-discount', title: 'خصم البونص من الطلب', label: 'الخصم', icon: Receipt, path: 'order-discount' },
  { id: 'cancellation', title: 'الإلغاء والعكس', label: 'الإلغاء', icon: RotateCcw, path: 'cancellation' },
  { id: 'expiry', title: 'انتهاء صلاحية البونص', label: 'الانتهاء', icon: AlarmClock, path: 'expiry' },
  { id: 'change-log', title: 'سجل تغييرات الإعدادات', label: 'السجل', icon: FileSearch, path: 'change-log' },
];

export function BonusSettingsSidebar() {
  return (
    <nav className="flex w-full min-w-[250px] flex-col gap-1 overflow-y-auto border-l border-border bg-card/60 p-3 md:w-[264px] md:shrink-0">
      <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70">
        إعدادات البونص
      </p>
      {SETTINGS_SECTIONS.map((s) => (
        <NavLink
          key={s.id}
          to={s.path}
          end
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all duration-200 ${
              isActive
                ? 'bg-primary/10 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/.18)]'
                : 'text-sidebar-foreground/65 hover:bg-white/[0.045] hover:text-sidebar-foreground'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <s.icon className="h-[17px] w-[17px] shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
              <span>{s.title}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
