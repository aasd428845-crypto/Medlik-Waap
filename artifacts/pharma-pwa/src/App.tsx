import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { LoginPage } from '@/pages/LoginPage';
import { DirectorLayout } from '@/layouts/DirectorLayout';
import { LoadingSpinner } from '@/components/LoadingSpinner';
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
import { ExpiryAlertsPage } from '@/pages/director/ExpiryAlertsPage';
import { ReceivablesPage } from '@/pages/director/ReceivablesPage';
import { SendNotificationPage } from '@/pages/director/SendNotificationPage';
import { FinancialPage } from '@/pages/director/FinancialPage';
import { FinancialDashboardPage } from '@/pages/director/FinancialDashboardPage';
import { FinancialModulePage } from '@/pages/director/FinancialModulePage';
import { ExpensesPage } from '@/pages/director/ExpensesPage';
import { ReceiptsPage } from '@/pages/director/ReceiptsPage';
import { JournalPage } from '@/pages/director/JournalPage';

function ProtectedRoute({ allowedRoles }: { allowedRoles: string[] }) { const { userProfile, loading } = useAuth(); if (loading) return <div className="h-screen flex items-center justify-center"><LoadingSpinner /></div>; if (!userProfile) return <Navigate to="/login" replace />; if (!allowedRoles.includes(userProfile.role)) return <Navigate to="/login" replace />; return <Outlet />; }
function RootRedirect() { const { userProfile, loading } = useAuth(); if (loading) return <div className="h-screen flex items-center justify-center"><LoadingSpinner /></div>; return userProfile?.role === 'company_director' ? <Navigate to="/director/dashboard" replace /> : <Navigate to="/login" replace />; }

export default function App() { const basename = import.meta.env.BASE_URL.replace(/\/$/, ''); return <AuthProvider><BrowserRouter basename={basename}><Routes><Route path="/login" element={<LoginPage />} /><Route path="/" element={<RootRedirect />} /><Route path="/director" element={<ProtectedRoute allowedRoles={['company_director']} />}><Route element={<DirectorLayout />}><Route path="dashboard" element={<DashboardPage />} /><Route path="financial" element={<FinancialPage />} /><Route path="financial/dashboard" element={<FinancialDashboardPage />} /><Route path="financial/expenses" element={<ExpensesPage />} /><Route path="financial/receipts" element={<ReceiptsPage />} /><Route path="financial/journal" element={<JournalPage />} /><Route path="financial/:module" element={<FinancialModulePage />} /><Route path="branch-managers" element={<BranchManagersPage />} /><Route path="pending-clients" element={<PendingClientsPage />} /><Route path="drivers" element={<DriversPage />} /><Route path="item-analytics" element={<ItemAnalyticsPage />} /><Route path="catalog" element={<CatalogPage />} /><Route path="inventory-overview" element={<InventoryOverviewPage />} /><Route path="orders-monitoring" element={<OrdersMonitoringPage />} /><Route path="promotional-offers" element={<PromotionalOffersPage />} /><Route path="promotional-offers/new" element={<NewPromotionalOfferPage />} /><Route path="promotional-offers/:id/edit" element={<EditPromotionalOfferPage />} /><Route path="bonus-overview" element={<BonusOverviewPage />} /><Route path="bonus-rules" element={<BonusRulesPage />} /><Route path="bonus-rules/new" element={<NewBonusRulePage />} /><Route path="bonus-rules/:id/edit" element={<EditBonusRulePage />} /><Route path="expiry-alerts" element={<ExpiryAlertsPage />} /><Route path="receivables" element={<ReceivablesPage />} /><Route path="send-notification" element={<SendNotificationPage />} /><Route path="" element={<Navigate to="dashboard" replace />} /></Route></Route><Route path="*" element={<Navigate to="/" replace />} /></Routes></BrowserRouter></AuthProvider>; }
