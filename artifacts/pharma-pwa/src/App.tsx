import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { LoginPage } from '@/pages/LoginPage';
import { DirectorLayout } from '@/layouts/DirectorLayout';
import { BranchManagerLayout } from '@/layouts/BranchManagerLayout';
import { LoadingSpinner } from '@/components/LoadingSpinner';

// Director Pages
import { DashboardPage } from '@/pages/director/DashboardPage';
import { CatalogPage } from '@/pages/director/CatalogPage';
import { InventoryOverviewPage } from '@/pages/director/InventoryOverviewPage';
import { OrdersMonitoringPage } from '@/pages/director/OrdersMonitoringPage';

// Branch Pages
import { AllocationPage } from '@/pages/branch/AllocationPage';
import { InvoicesPage } from '@/pages/branch/InvoicesPage';
import { OffersPage } from '@/pages/branch/OffersPage';
import { WarehouseInventoryPage } from '@/pages/branch/WarehouseInventoryPage';
import { AddressesPage } from '@/pages/branch/AddressesPage';

function ProtectedRoute({ allowedRoles }: { allowedRoles: string[] }) {
  const { userProfile, loading } = useAuth();

  if (loading) return <div className="h-screen flex items-center justify-center"><LoadingSpinner /></div>;
  if (!userProfile) return <Navigate to="/login" replace />;
  if (!allowedRoles.includes(userProfile.role)) {
    return (
      <div className="h-screen flex flex-col items-center justify-center p-4 text-center">
        <h2 className="text-2xl font-bold text-destructive mb-2">عذراً، غير مصرح لك</h2>
        <p className="text-muted-foreground">ليس لديك الصلاحيات الكافية لعرض هذه الصفحة.</p>
        <div className="mt-6">
          <Navigate to="/login" replace />
        </div>
      </div>
    );
  }

  return <Outlet />;
}

function RootRedirect() {
  const { userProfile, loading } = useAuth();
  if (loading) return <div className="h-screen flex items-center justify-center"><LoadingSpinner /></div>;
  
  if (userProfile?.role === 'company_director') return <Navigate to="/director/dashboard" replace />;
  if (userProfile?.role === 'branch_manager') return <Navigate to="/branch/allocation" replace />;
  
  return <Navigate to="/login" replace />;
}

function App() {
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '');
  return (
    <AuthProvider>
      <BrowserRouter basename={basename}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<RootRedirect />} />

          {/* Director Routes */}
          <Route path="/director" element={<ProtectedRoute allowedRoles={['company_director']} />}>
            <Route element={<DirectorLayout />}>
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="catalog" element={<CatalogPage />} />
              <Route path="inventory-overview" element={<InventoryOverviewPage />} />
              <Route path="orders-monitoring" element={<OrdersMonitoringPage />} />
              <Route path="" element={<Navigate to="dashboard" replace />} />
            </Route>
          </Route>

          {/* Branch Manager Routes */}
          <Route path="/branch" element={<ProtectedRoute allowedRoles={['branch_manager']} />}>
            <Route element={<BranchManagerLayout />}>
              <Route path="allocation" element={<AllocationPage />} />
              <Route path="invoices" element={<InvoicesPage />} />
              <Route path="offers" element={<OffersPage />} />
              <Route path="inventory" element={<WarehouseInventoryPage />} />
              <Route path="addresses" element={<AddressesPage />} />
              <Route path="" element={<Navigate to="allocation" replace />} />
            </Route>
          </Route>
          
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
