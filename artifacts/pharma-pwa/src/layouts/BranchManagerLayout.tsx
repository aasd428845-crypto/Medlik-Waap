import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Pill, Box, FileText, Tag, PackageSearch, MapPin, LogOut } from 'lucide-react';

export function BranchManagerLayout() {
  const { userProfile, logout } = useAuth();
  const location = useLocation();

  const navItems = [
    { to: '/branch/allocation', label: 'عمليات التخصيص', icon: Box },
    { to: '/branch/invoices', label: 'سجل الفواتير', icon: FileText },
    { to: '/branch/offers', label: 'عروضي', icon: Tag },
    { to: '/branch/inventory', label: 'مخزون المستودع', icon: PackageSearch },
  ];

  return (
    <div className="min-h-screen bg-muted/20 flex flex-col">
      {/* Top Header */}
      <header className="bg-primary text-primary-foreground shadow-md shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 p-2 rounded-lg">
                <Pill className="w-6 h-6 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-lg leading-tight">{userProfile?.branchName || 'فرع الصيدلية'}</span>
                <span className="text-xs text-primary-foreground/80 leading-tight">المدير: {userProfile?.name}</span>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <NavLink 
                to="/branch/addresses" 
                className="hidden md:flex items-center gap-1.5 text-sm font-medium bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-full transition-colors"
              >
                <MapPin className="w-4 h-4" />
                📍 إدارة العناوين
              </NavLink>
              
              <button 
                onClick={logout}
                className="text-primary-foreground/90 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-colors"
                title="تسجيل الخروج"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Tabs Navigation */}
      <div className="bg-card border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-reverse space-x-1 sm:space-x-4 overflow-x-auto hide-scrollbar">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-2 py-4 px-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                    isActive
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
                  }`
                }
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </NavLink>
            ))}
            {/* Mobile Addresses Tab */}
            <NavLink
              to="/branch/addresses"
              className={({ isActive }) =>
                `md:hidden flex items-center gap-2 py-4 px-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
                }`
              }
            >
              <MapPin className="w-4 h-4" />
              العناوين
            </NavLink>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative">
        <Outlet />
      </main>
      
      <style>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
