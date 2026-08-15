import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  Activity,
  AlarmClock,
  ArrowDownLeft,
  BarChart3,
  Bell,
  BookOpenText,
  Database,
  Gift,
  Landmark,
  LayoutDashboard,
  LayoutList,
  LogOut,
  Pill,
  Receipt,
  Search,
  Truck,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';

const navItems = [
  { to: '/director/dashboard', label: 'لوحة القيادة', icon: LayoutDashboard, group: 'المركز' },
  { to: '/director/branch-managers', label: 'مدراء الفروع', icon: Users, group: 'المركز' },
  { to: '/director/pending-clients', label: 'طلبات الانضمام', icon: UserCheck, group: 'المركز' },
  { to: '/director/drivers', label: 'المندوبون', icon: Truck, group: 'التشغيل' },
  { to: '/director/item-analytics', label: 'تحليلات الأصناف', icon: BarChart3, group: 'التشغيل' },
  { to: '/director/catalog', label: 'كتالوج المنتجات', icon: Database, group: 'التشغيل' },
  { to: '/director/inventory-overview', label: 'نظرة المخزون', icon: Activity, group: 'التشغيل' },
  { to: '/director/orders-monitoring', label: 'مراقبة الطلبات', icon: LayoutList, group: 'التشغيل' },
  { to: '/director/promotional-offers', label: 'العروض الترويجية', icon: Gift, group: 'النمو' },
  { to: '/director/bonus-overview', label: 'نظام البونص', icon: Gift, group: 'النمو' },
  { to: '/director/expiry-alerts', label: 'انتهاء الصلاحية', icon: AlarmClock, group: 'المخاطر' },
  { to: '/director/financial/expenses', label: 'المصروفات', icon: Receipt, group: 'المالية' },
  { to: '/director/financial/receipts', label: 'السندات', icon: ArrowDownLeft, group: 'المالية' },
  { to: '/director/financial/journal', label: 'دفتر اليومية', icon: BookOpenText, group: 'المالية' },
  { to: '/director/financial', label: 'الإدارة المالية', icon: Landmark, group: 'المالية' },
  { to: '/director/receivables', label: 'الذمم المدينة', icon: Wallet, group: 'المالية' },
  { to: '/director/send-notification', label: 'إرسال إشعار', icon: Bell, group: 'المركز' },
];

const mobileItems = navItems.slice(0, 4);

function getPageTitle(pathname: string) {
  return navItems.find((item) => pathname.startsWith(item.to))?.label ?? 'لوحة القيادة';
}

export function DirectorLayout() {
  const { userProfile, logout } = useAuth();
  const location = useLocation();
  const pageTitle = getPageTitle(location.pathname);
  const groups = Array.from(new Set(navItems.map((item) => item.group)));

  return (
    <div className="director-shell flex min-h-[100dvh] flex-col text-foreground">
      <div className="flex min-h-[100dvh] flex-1 overflow-hidden">
        <aside className="hidden w-[272px] shrink-0 flex-col border-l border-sidebar-border bg-sidebar/95 md:flex">
          <div className="relative border-b border-sidebar-border px-5 pb-5 pt-6">
            <div className="absolute inset-x-0 bottom-0 h-px director-glow-line opacity-50" />
            <div className="flex items-center gap-3">
              <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/40 bg-primary/10 text-primary shadow-[0_0_24px_hsl(var(--primary)/.12)]">
                <Pill className="h-6 w-6" strokeWidth={1.8} />
                <span className="absolute -bottom-1 -left-1 h-2.5 w-2.5 rounded-full border-2 border-sidebar bg-emerald-400" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">NOVA DISTRIBUTION</p>
                <h1 className="mt-1 text-lg font-extrabold text-sidebar-foreground">مركز القيادة</h1>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-xs font-bold text-accent">
                  {(userProfile?.name || 'مدير').slice(0, 1)}
                </span>
                <div>
                  <p className="text-xs font-bold text-sidebar-foreground">{userProfile?.name || 'مدير النظام'}</p>
                  <p className="text-[10px] text-muted-foreground">المدير العام</p>
                </div>
              </div>
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.6)]" />
            </div>
          </div>

          <nav className="director-scrollbar flex-1 overflow-y-auto px-3 py-5">
            {groups.map((group) => (
              <div key={group} className="mb-5">
                <p className="mb-2 px-3 text-[10px] font-bold tracking-[0.15em] text-muted-foreground/70">{group}</p>
                <div className="space-y-1">
                  {navItems.filter((item) => item.group === group).map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all duration-200 ${
                          isActive
                            ? 'bg-primary/10 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/.18)]'
                            : 'text-sidebar-foreground/65 hover:bg-white/[0.045] hover:text-sidebar-foreground'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span className="absolute bottom-2 top-2 right-0 w-0.5 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary))]" />}
                          <item.icon className="h-[17px] w-[17px] shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
                          <span>{item.label}</span>
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-sidebar-border p-3">
            <button onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-xs font-semibold text-destructive/80 transition-colors hover:bg-destructive/10 hover:text-destructive">
              <LogOut className="h-[17px] w-[17px]" />
              تسجيل الخروج
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="relative z-10 flex h-[74px] shrink-0 items-center justify-between border-b border-border/80 bg-background/80 px-4 backdrop-blur-xl md:px-8">
            <div className="flex items-center gap-3">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-semibold text-muted-foreground">
                  <span>مركز القيادة</span><span className="text-primary">/</span><span className="text-primary">{pageTitle}</span>
                </div>
                <h2 className="mt-1 text-lg font-extrabold tracking-tight md:text-xl">{pageTitle}</h2>
              </div>
            </div>
            <div className="flex items-center gap-2 md:gap-3">
              <div className="hidden items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground lg:flex">
                <Search className="h-3.5 w-3.5" />
                <span>بحث في النظام</span>
                <kbd className="rounded border border-border px-1.5 py-0.5 text-[9px]">⌘ K</kbd>
              </div>
              <span className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card/70 text-muted-foreground" aria-label="الإشعارات">
                <Bell className="h-4 w-4" />
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
              </span>
            </div>
          </header>

          <main className="director-grid director-scrollbar min-h-0 flex-1 overflow-auto p-4 pb-24 md:p-8 md:pb-8">
            <Outlet />
          </main>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex h-[68px] items-center justify-around border-t border-border bg-sidebar/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {mobileItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `flex min-w-[62px] flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[10px] font-semibold transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
          >
            <item.icon className="h-[18px] w-[18px]" />
            {item.label.split(' ')[0]}
          </NavLink>
        ))}
        <button onClick={logout} className="flex min-w-[62px] flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[10px] font-semibold text-destructive/80">
          <LogOut className="h-[18px] w-[18px]" />
          خروج
        </button>
      </nav>
    </div>
  );
}