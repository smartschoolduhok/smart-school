import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import Layout from './components/Layout';
import LoginPage from './modules/auth/LoginPage';
import DashboardPage from './modules/dashboard/DashboardPage';
import SchoolsPage from './modules/schools/SchoolsPage';
import UsersPage from './modules/users/UsersPage';
import RolesPage from './modules/roles/RolesPage';
import StudentsPage from './modules/students/StudentsPage';
import ClassesPage from './modules/classes/ClassesPage';
import SubjectsPage from './modules/subjects/SubjectsPage';
import StudentSubjectsPage from './modules/studentSubjects/StudentSubjectsPage';
import GradesPage from './modules/grades/GradesPage';
import AnalyticsPage from './modules/analytics/AnalyticsPage';
import ResultCardsPage from './modules/resultCards/ResultCardsPage';
import ResultCardVerificationPage from './modules/verification/ResultCardVerificationPage';

// Settings placeholder - Phase 1: active module
function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">إعدادات النظام</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">⚙️</span>
        </div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">قيد التطوير</h2>
        <p className="text-sm text-gray-500">سيتم إضافة إعدادات النظام في المرحلة القادمة</p>
      </div>
    </div>
  );
}

// Disabled module placeholder - redirects to dashboard
// Phase 1: these modules are NOT implemented (students, classes, fees, transport, etc.)
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

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Layout><DashboardPage /></Layout>} />
          <Route path="/schools" element={<Layout><SchoolsPage /></Layout>} />
          <Route path="/users" element={<Layout><UsersPage /></Layout>} />
          <Route path="/roles" element={<Layout><RolesPage /></Layout>} />
          <Route path="/settings" element={<Layout><SettingsPage /></Layout>} />
          {/* Disabled/future module routes - explicit catch to prevent 404 and show clear message */}
          <Route path="/students" element={<Layout><StudentsPage /></Layout>} />
          <Route path="/classes" element={<Layout><ClassesPage /></Layout>} />
          <Route path="/subjects" element={<Layout><SubjectsPage /></Layout>} />
          <Route path="/student-subjects" element={<Layout><StudentSubjectsPage /></Layout>} />
          <Route path="/grades" element={<Layout><GradesPage /></Layout>} />
          <Route path="/analytics" element={<Layout><AnalyticsPage /></Layout>} />
          <Route path="/result-cards" element={<Layout><ResultCardsPage /></Layout>} />
          {/* Public verification route - no auth, no layout */}
          <Route path="/verify/result-card/:token" element={<ResultCardVerificationPage />} />
          <Route path="/fees" element={<Layout><DisabledModulePage moduleName="الأقساط" /></Layout>} />
          <Route path="/treasury" element={<Layout><DisabledModulePage moduleName="الخزنة" /></Layout>} />
          <Route path="/official-books" element={<Layout><DisabledModulePage moduleName="الكتب الرسمية" /></Layout>} />
          <Route path="/print-records" element={<Layout><DisabledModulePage moduleName="السجلات المطبوعة" /></Layout>} />
          <Route path="/employees" element={<Layout><DisabledModulePage moduleName="الموظفون" /></Layout>} />
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
