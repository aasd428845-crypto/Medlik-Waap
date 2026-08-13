import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { LoginPage } from '@/pages/LoginPage';
import { DirectorLayout } from '@/layouts/DirectorLayout';
import { LoadingSpinner } from '@/components/LoadingSpinner';

// Director Pages
import { DashboardPage } from '@/pages/director/DashboardPage';
import { BranchManagersPage } from '@/pages/director/BranchManagersPage';
import { PendingClientsPage } from '@/pages/director/PendingClientsPage';
import { DriversPage } from '@/pages/director/DriversPage';
import { ItemAnalyticsPage } from '@/pages/director/ItemAnalyticsPage';
import { CatalogPage } from '@/pages/director/CatalogPage';
import { InventoryOverviewPage } from '@/pages/director/InventoryOverviewPage';
import { OrdersMonitoringPage } from '@/pages/director/OrdersMonitoringPage';
import { PromotionalOffersPage } from '@/pages/director/PromotionalOffersPage';
import { NewPromotionalOfferPage } from '@/pages/director/NewPromotionalOfferPage';
import { EditPromotionalOfferPage } from '@/pages/director/EditPromotionalOfferPage';
import { BonusOverviewPage } from '@/pages/director/BonusOverviewPage';
import { BonusRulesPage } from '@/pages/director/BonusRulesPage';
import { NewBonusRulePage } from '@/pages/director/NewBonusRulePage';
import { EditBonusRulePage } from '@/pages/director/EditBonusRulePage';

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
              <Route path="branch-managers" element={<BranchManagersPage />} />
              <Route path="pending-clients" element={<PendingClientsPage />} />
              <Route path="drivers" element={<DriversPage />} />
              <Route path="item-analytics" element={<ItemAnalyticsPage />} />
              <Route path="catalog" element={<CatalogPage />} />
              <Route path="inventory-overview" element={<InventoryOverviewPage />} />
              <Route path="orders-monitoring" element={<OrdersMonitoringPage />} />
              <Route path="promotional-offers" element={<PromotionalOffersPage />} />
              <Route path="promotional-offers/new" element={<NewPromotionalOfferPage />} />
              <Route path="promotional-offers/:id/edit" element={<EditPromotionalOfferPage />} />
              <Route path="bonus-overview" element={<BonusOverviewPage />} />
              <Route path="bonus-rules" element={<BonusRulesPage />} />
              <Route path="bonus-rules/new" element={<NewBonusRulePage />} />
              <Route path="bonus-rules/:id/edit" element={<EditBonusRulePage />} />
              <Route path="" element={<Navigate to="dashboard" replace />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
