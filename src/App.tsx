import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Layout from './components/Layout';
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
  GRADE_VIEW_ROLES,
  STUDENT_DIRECTORY_ROLES,
  STUDENT_RESOURCE_VIEW_ROLES,
  SYSTEM_ADMIN_ROLES,
  USER_DIRECTORY_ROLES,
  hasRole,
} from './lib/rbac';

const LoginPage = lazy(() => import('./modules/auth/LoginPage'));
const DashboardPage = lazy(() => import('./modules/dashboard/DashboardPage'));
const SchoolsPage = lazy(() => import('./modules/schools/SchoolsPage'));
const UsersPage = lazy(() => import('./modules/users/UsersPage'));
const RolesPage = lazy(() => import('./modules/roles/RolesPage'));
const StudentsPage = lazy(() => import('./modules/students/StudentsPage'));
const StudentProfilePage = lazy(() => import('./modules/students/StudentProfilePage'));
const StudentPromotionPage = lazy(() => import('./modules/studentPromotion/StudentPromotionPage'));
const TimetablePage = lazy(() => import('./modules/timetable/TimetablePage'));
const ClassesPage = lazy(() => import('./modules/classes/ClassesPage'));
const SubjectsPage = lazy(() => import('./modules/subjects/SubjectsPage'));
const StudentSubjectsPage = lazy(() => import('./modules/studentSubjects/StudentSubjectsPage'));
const GradesPage = lazy(() => import('./modules/grades/GradesPage'));
const AnalyticsPage = lazy(() => import('./modules/analytics/AnalyticsPage'));
const ResultCardsPage = lazy(() => import('./modules/resultCards/ResultCardsPage'));
const FeesPage = lazy(() => import('./modules/fees/FeesPage'));
const TreasuryPage = lazy(() => import('./modules/treasury/TreasuryPage'));
const EmployeesPage = lazy(() => import('./modules/employees/EmployeesPage'));
const ResultCardVerificationPage = lazy(() => import('./modules/verification/ResultCardVerificationPage'));
const ReceiptVerificationPage = lazy(() => import('./modules/verification/ReceiptVerificationPage'));
const OfficialBookVerificationPage = lazy(() => import('./modules/verification/OfficialBookVerificationPage'));
const OfficialBooksPage = lazy(() => import('./modules/officialBooks/OfficialBooksPage'));
const PrintRecordsPage = lazy(() => import('./modules/printRecords/PrintRecordsPage'));
const PrintResultCardPage = lazy(() => import('./modules/print/PrintResultCardPage'));
const PrintReceiptPage = lazy(() => import('./modules/print/PrintReceiptPage'));
const PrintOfficialBookPage = lazy(() => import('./modules/print/PrintOfficialBookPage'));
const ImportExportPage = lazy(() => import('./modules/importExport/ImportExportPage'));
const SettingsPage = lazy(() => import('./modules/settings/SettingsPage'));

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

function RouteLoading() {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-gray-500" role="status">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
      <p className="text-sm">جاري تحميل الصفحة...</p>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteLoading />}>
          <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Layout><DashboardPage /></Layout>} />

          {/* Admin-only routes */}
          <Route path="/schools" element={<Layout><AdminRoute><SchoolsPage /></AdminRoute></Layout>} />
          <Route path="/users" element={<Layout><RoleGuard allowedRoles={USER_DIRECTORY_ROLES}><UsersPage /></RoleGuard></Layout>} />
          <Route path="/roles" element={<Layout><AdminRoute><RolesPage /></AdminRoute></Layout>} />

          {/* Academic routes */}
          <Route path="/students" element={<Layout><RoleGuard allowedRoles={STUDENT_DIRECTORY_ROLES}><StudentsPage /></RoleGuard></Layout>} />
          <Route path="/students/:id" element={<Layout><RoleGuard allowedRoles={STUDENT_RESOURCE_VIEW_ROLES}><StudentProfilePage /></RoleGuard></Layout>} />
          <Route path="/student-promotion" element={<Layout><RoleGuard allowedRoles={ACADEMIC_MANAGEMENT_ROLES}><StudentPromotionPage /></RoleGuard></Layout>} />
          <Route path="/timetable" element={<Layout><RoleGuard allowedRoles={ACADEMIC_MANAGEMENT_ROLES}><TimetablePage /></RoleGuard></Layout>} />
          <Route path="/classes" element={<Layout><AcademicRoute><ClassesPage /></AcademicRoute></Layout>} />
          <Route path="/subjects" element={<Layout><AcademicRoute><SubjectsPage /></AcademicRoute></Layout>} />
          <Route path="/student-subjects" element={<Layout><AcademicRoute><StudentSubjectsPage /></AcademicRoute></Layout>} />
          <Route path="/grades" element={<Layout><RoleGuard allowedRoles={GRADE_VIEW_ROLES}><GradesPage /></RoleGuard></Layout>} />
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

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
