import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Layout from './components/Layout';
import LoginPage from './modules/auth/LoginPage';
import DashboardPage from './modules/dashboard/DashboardPage';
import SchoolsPage from './modules/schools/SchoolsPage';
import UsersPage from './modules/users/UsersPage';
import RolesPage from './modules/roles/RolesPage';
import StudentsPage from './modules/students/StudentsPage';
import StudentProfilePage from './modules/students/StudentProfilePage';
import StudentPromotionPage from './modules/studentPromotion/StudentPromotionPage';
import ClassesPage from './modules/classes/ClassesPage';
import SubjectsPage from './modules/subjects/SubjectsPage';
import StudentSubjectsPage from './modules/studentSubjects/StudentSubjectsPage';
import GradesPage from './modules/grades/GradesPage';
import AnalyticsPage from './modules/analytics/AnalyticsPage';
import ResultCardsPage from './modules/resultCards/ResultCardsPage';
import FeesPage from './modules/fees/FeesPage';
import TreasuryPage from './modules/treasury/TreasuryPage';
import EmployeesPage from './modules/employees/EmployeesPage';
import ResultCardVerificationPage from './modules/verification/ResultCardVerificationPage';
import ReceiptVerificationPage from './modules/verification/ReceiptVerificationPage';
import OfficialBookVerificationPage from './modules/verification/OfficialBookVerificationPage';
import OfficialBooksPage from './modules/officialBooks/OfficialBooksPage';
import PrintRecordsPage from './modules/printRecords/PrintRecordsPage';
import PrintResultCardPage from './modules/print/PrintResultCardPage';
import PrintReceiptPage from './modules/print/PrintReceiptPage';
import PrintOfficialBookPage from './modules/print/PrintOfficialBookPage';
import ImportExportPage from './modules/importExport/ImportExportPage';

import SettingsPage from './modules/settings/SettingsPage';
import type { RoleKey } from './types';
import {
  ACADEMIC_ACCESS_ROLES,
  ACADEMIC_MANAGEMENT_ROLES,
  ANALYTICS_ACCESS_ROLES,
  EMPLOYEE_ACCESS_ROLES,
  FEE_MANAGEMENT_ROLES,
  FINANCE_ACCESS_ROLES,
  IMPORT_EXPORT_ROLES,
  OFFICIAL_BOOK_ACCESS_ROLES,
  SETTINGS_VIEW_ROLES,
  SYSTEM_ADMIN_ROLES,
  hasRole,
} from './lib/rbac';

// ===========================================
// RBAC Route Guards
// ===========================================

interface RouteGuardProps {
  children: React.ReactNode;
  allowedRoles: readonly RoleKey[];
  fallback?: React.ReactNode;
}

function RoleGuard({ children, allowedRoles, fallback }: RouteGuardProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="p-12 flex flex-col items-center justify-center gap-3 text-gray-500">
        <div className="w-8 h-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">جاري التحميل...</p>
      </div>
    );
  }

  if (!hasRole(user?.role_key, allowedRoles)) {
    return (
      <>
        {fallback || (
          <div className="p-12 flex flex-col items-center justify-center gap-3 text-red-600">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-2">
              <span className="text-2xl">🚫</span>
            </div>
            <h2 className="text-lg font-bold text-gray-900">غير مسموح بالوصول</h2>
            <p className="text-sm text-gray-500">ليس لديك الصلاحية للوصول إلى هذه الصفحة</p>
            <button
              onClick={() => window.location.href = '/'}
              className="px-4 py-2 bg-primary-50 hover:bg-primary-100 text-primary-700 rounded-lg text-sm font-medium transition-colors"
            >
              العودة للرئيسية
            </button>
          </div>
        )}
      </>
    );
  }

  return <>{children}</>;
}

// Disabled module placeholder - redirects to dashboard
function DisabledModulePage({ moduleName }: { moduleName: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{moduleName}</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">🔒</span>
        </div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">الموديل غير مفعّل</h2>
        <p className="text-sm text-gray-500">هذا الموديل غير متاح في الوقت الحالي وسيتم تفعيله في المرحلة القادمة</p>
      </div>
    </div>
  );
}

// Admin-only route wrapper
function AdminRoute({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allowedRoles={SYSTEM_ADMIN_ROLES}>
      {children}
    </RoleGuard>
  );
}

// Settings viewers may inspect their school; mutation permissions are enforced separately.
function SettingsRoute({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allowedRoles={SETTINGS_VIEW_ROLES}>
      {children}
    </RoleGuard>
  );
}

// Academic route wrapper (teaching staff)
function AcademicRoute({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allowedRoles={ACADEMIC_ACCESS_ROLES}>
      {children}
    </RoleGuard>
  );
}

// Finance route wrapper
function FinanceRoute({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allowedRoles={FINANCE_ACCESS_ROLES}>
      {children}
    </RoleGuard>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Layout><DashboardPage /></Layout>} />

          {/* Admin-only routes */}
          <Route path="/schools" element={<Layout><AdminRoute><SchoolsPage /></AdminRoute></Layout>} />
          <Route path="/users" element={<Layout><AdminRoute><UsersPage /></AdminRoute></Layout>} />
          <Route path="/roles" element={<Layout><AdminRoute><RolesPage /></AdminRoute></Layout>} />

          {/* Academic routes */}
          <Route path="/students" element={<Layout><AcademicRoute><StudentsPage /></AcademicRoute></Layout>} />
          <Route path="/students/:id" element={<Layout><AcademicRoute><StudentProfilePage /></AcademicRoute></Layout>} />
          <Route path="/student-promotion" element={<Layout><RoleGuard allowedRoles={ACADEMIC_MANAGEMENT_ROLES}><StudentPromotionPage /></RoleGuard></Layout>} />
          <Route path="/classes" element={<Layout><AcademicRoute><ClassesPage /></AcademicRoute></Layout>} />
          <Route path="/subjects" element={<Layout><AcademicRoute><SubjectsPage /></AcademicRoute></Layout>} />
          <Route path="/student-subjects" element={<Layout><AcademicRoute><StudentSubjectsPage /></AcademicRoute></Layout>} />
          <Route path="/grades" element={<Layout><AcademicRoute><GradesPage /></AcademicRoute></Layout>} />
          <Route path="/result-cards" element={<Layout><AcademicRoute><ResultCardsPage /></AcademicRoute></Layout>} />

          {/* Analytics - wider access */}
          <Route path="/analytics" element={<Layout><RoleGuard allowedRoles={ANALYTICS_ACCESS_ROLES}><AnalyticsPage /></RoleGuard></Layout>} />

          {/* Finance routes */}
          <Route path="/fees" element={<Layout><RoleGuard allowedRoles={FEE_MANAGEMENT_ROLES}><FeesPage /></RoleGuard></Layout>} />
          <Route path="/treasury" element={<Layout><FinanceRoute><TreasuryPage /></FinanceRoute></Layout>} />

          {/* HR routes */}
          <Route path="/employees" element={<Layout><RoleGuard allowedRoles={EMPLOYEE_ACCESS_ROLES}><EmployeesPage /></RoleGuard></Layout>} />

          {/* Official books - admin + registrar */}
          <Route path="/official-books" element={<Layout><RoleGuard allowedRoles={OFFICIAL_BOOK_ACCESS_ROLES}><OfficialBooksPage /></RoleGuard></Layout>} />
          <Route path="/print-records" element={<Layout><RoleGuard allowedRoles={OFFICIAL_BOOK_ACCESS_ROLES}><PrintRecordsPage /></RoleGuard></Layout>} />

          {/* Import/Export - admin + school staff */}
          <Route path="/import-export" element={<Layout><RoleGuard allowedRoles={IMPORT_EXPORT_ROLES}><ImportExportPage /></RoleGuard></Layout>} />

          {/* Settings - school staff */}
          <Route path="/settings" element={<Layout><SettingsRoute><SettingsPage /></SettingsRoute></Layout>} />

          {/* Public verification routes — no auth, no layout */}
          <Route path="/verify/result-card/:token" element={<ResultCardVerificationPage />} />
          <Route path="/verify/receipt/:token" element={<ReceiptVerificationPage />} />
          <Route path="/verify/official-book/:token" element={<OfficialBookVerificationPage />} />

          {/* Print routes - no layout */}
          <Route path="/print/result-card/:id" element={<PrintResultCardPage />} />
          <Route path="/print/receipt/:id" element={<PrintReceiptPage />} />
          <Route path="/print/official-book/:id" element={<PrintOfficialBookPage />} />

          {/* Disabled/future modules */}
          <Route path="/transport" element={<Layout><DisabledModulePage moduleName="النقل المدرسي" /></Layout>} />
          <Route path="/teacher-portal" element={<Layout><DisabledModulePage moduleName="بوابة المدرس" /></Layout>} />
          <Route path="/parent-portal" element={<Layout><DisabledModulePage moduleName="بوابة ولي الأمر" /></Layout>} />
          <Route path="/ai-assistant" element={<Layout><DisabledModulePage moduleName="المساعد الذكي" /></Layout>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
