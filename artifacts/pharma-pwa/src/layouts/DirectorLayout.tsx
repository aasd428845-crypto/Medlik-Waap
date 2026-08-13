import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Pill, LayoutDashboard, Users, UserCheck, Truck, BarChart3, Database, Activity, LayoutList, BadgePercent, Gift, AlarmClock, Wallet, LogOut } from 'lucide-react';

export function DirectorLayout() {
  const { userProfile, logout } = useAuth();
  const location = useLocation();

  const getPageTitle = () => {
    if (location.pathname.includes('dashboard')) return 'لوحة التحكم';
    if (location.pathname.includes('branch-managers')) return 'إدارة حسابات مدراء الفروع';
    if (location.pathname.includes('pending-clients')) return 'طلبات الانضمام المعلّقة';
    if (location.pathname.includes('drivers')) return 'السائقون';
    if (location.pathname.includes('item-analytics')) return 'تحليلات الأصناف';
    if (location.pathname.includes('catalog')) return 'كتالوج المنتجات';
    if (location.pathname.includes('inventory-overview')) return 'نظرة المخزون';
    if (location.pathname.includes('orders-monitoring')) return 'مراقبة الطلبات';
    if (location.pathname.includes('promotional-offers')) return 'العروض الترويجية';
    if (location.pathname.includes('bonus')) return 'نظام البونص';
    if (location.pathname.includes('expiry-alerts')) return 'تنبيهات انتهاء الصلاحية';
    if (location.pathname.includes('receivables')) return 'الذمم المدينة';
    return 'لوحة التحكم';
  };

  const navItems = [
    { to: '/director/dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
    { to: '/director/branch-managers', label: 'مدراء الفروع', icon: Users },
    { to: '/director/pending-clients', label: 'طلبات الانضمام', icon: UserCheck },
    { to: '/director/drivers', label: 'السائقون', icon: Truck },
    { to: '/director/item-analytics', label: 'تحليلات الأصناف', icon: BarChart3 },
    { to: '/director/catalog', label: 'كتالوج المنتجات', icon: Database },
    { to: '/director/inventory-overview', label: 'نظرة المخزون', icon: Activity },
    { to: '/director/orders-monitoring', label: 'مراقبة الطلبات', icon: LayoutList },
    { to: '/director/promotional-offers', label: 'العروض الترويجية', icon: BadgePercent },
    { to: '/director/bonus-overview', label: 'نظام البونص', icon: Gift },
    { to: '/director/expiry-alerts', label: 'انتهاء الصلاحية', icon: AlarmClock },
    { to: '/director/receivables', label: 'الذمم المدينة', icon: Wallet },
  ];

  return (
    <div className="flex flex-col h-screen">
      <div className="flex flex-1 bg-muted/20 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-sidebar border-l border-sidebar-border flex flex-col hidden md:flex shrink-0">
        <div className="p-6 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-lg text-primary">
              <Pill className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-sidebar-foreground text-lg">المدير العام</h1>
              <p className="text-xs text-muted-foreground">{userProfile?.name || 'مدير النظام'}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-sidebar-foreground hover:bg-muted'
                }`
              }
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <button
            onClick={logout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-destructive hover:bg-destructive/10 w-full transition-colors"
          >
            <LogOut className="w-5 h-5" />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header (mobile & desktop) */}
        <header className="bg-card border-b h-16 flex items-center justify-between px-6 shrink-0 shadow-sm">
          <h2 className="text-xl font-bold text-foreground">{getPageTitle()}</h2>
          <div className="md:hidden flex items-center">
            <button onClick={logout} className="text-destructive font-medium text-sm">
              خروج
            </button>
          </div>
        </header>

        {/* Mobile Navigation (bottom bar) - very simplified for this context */}
        <div className="md:hidden flex items-center justify-around bg-card border-t py-2 shrink-0 fixed bottom-0 w-full z-10">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 p-2 text-xs ${
                  isActive ? 'text-primary' : 'text-muted-foreground'
                }`
              }
            >
              <item.icon className="w-5 h-5" />
              {item.label.split(' ')[0]}
            </NavLink>
          ))}
        </div>

        {/* Page Content */}
        <main className="flex-1 overflow-auto p-4 md:p-6 pb-20 md:pb-6 relative">
          <Outlet />
        </main>
      </div>
      </div>
    </div>
  );
}
