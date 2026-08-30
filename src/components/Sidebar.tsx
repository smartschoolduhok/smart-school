import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, School, Users, Shield, Settings, GraduationCap, BookOpen, Calculator, CreditCard, Wallet, FileText, Printer, Bus, Globe, Brain, BookMarked, Layers, UserCheck, HeartHandshake, BarChart3, ArrowDownUp } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import type { RoleKey } from '../types';
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
} from '../lib/rbac';

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  section?: string;
  // Role visibility: which roles can see this item
  // If undefined/empty, visible to all authenticated users
  allowedRoles?: readonly RoleKey[];
}

// ===========================================
// RBAC Sidebar Rules
// ===========================================
// system_admin: sees everything (all modules + admin-only)
// school_owner, principal, vice_principal: sees school management modules
// teacher: sees academic modules only
// accountant: sees finance modules
// registrar: sees student/academic modules
// parent: sees parent portal (future)
//
// Admin-only modules: المدارس, المستخدمون, الأدوار والصلاحيات
// ===========================================

const activeModules: NavItem[] = [
  // Core - visible to all authenticated users
  { label: 'لوحة التحكم', path: '/', icon: <LayoutDashboard size={20} />, active: true },

  // Admin-only: system_admin only
  { label: 'المدارس', path: '/schools', icon: <School size={20} />, active: true, allowedRoles: SYSTEM_ADMIN_ROLES },
  { label: 'المستخدمون', path: '/users', icon: <Users size={20} />, active: true, allowedRoles: SYSTEM_ADMIN_ROLES },
  { label: 'الأدوار والصلاحيات', path: '/roles', icon: <Shield size={20} />, active: true, allowedRoles: SYSTEM_ADMIN_ROLES },

  // Phase 2 modules - academic (admin + school staff)
  { label: 'الطلاب', path: '/students', icon: <GraduationCap size={20} />, active: true, allowedRoles: ACADEMIC_ACCESS_ROLES },
  { label: 'ترفيع الطلاب', path: '/student-promotion', icon: <ArrowDownUp size={20} />, active: true, allowedRoles: ACADEMIC_MANAGEMENT_ROLES },
  { label: 'الصفوف والشعب', path: '/classes', icon: <Layers size={20} />, active: true, allowedRoles: ACADEMIC_ACCESS_ROLES },
  { label: 'المواد', path: '/subjects', icon: <BookOpen size={20} />, active: true, allowedRoles: ACADEMIC_ACCESS_ROLES },
  { label: 'مواد الطالب', path: '/student-subjects', icon: <BookMarked size={20} />, active: true, allowedRoles: ACADEMIC_ACCESS_ROLES },
  { label: 'الدرجات', path: '/grades', icon: <Calculator size={20} />, active: true, allowedRoles: ACADEMIC_ACCESS_ROLES },
  { label: 'التحليل', path: '/analytics', icon: <BarChart3 size={20} />, active: true, allowedRoles: ANALYTICS_ACCESS_ROLES },
  { label: 'كارتات النتائج', path: '/result-cards', icon: <FileText size={20} />, active: true, allowedRoles: ACADEMIC_ACCESS_ROLES },

  // Phase 7 modules - finance (admin + accountant)
  { label: 'الأقساط', path: '/fees', icon: <CreditCard size={20} />, active: true, allowedRoles: FEE_MANAGEMENT_ROLES },
  { label: 'الخزنة', path: '/treasury', icon: <Wallet size={20} />, active: true, allowedRoles: FINANCE_ACCESS_ROLES },

  // Phase 9 modules - HR (school management + accountant salary access)
  { label: 'الموظفون', path: '/employees', icon: <UserCheck size={20} />, active: true, allowedRoles: EMPLOYEE_ACCESS_ROLES },

  // Phase 13A modules - data (admin + school staff)
  { label: 'استيراد وتصدير Excel', path: '/import-export', icon: <ArrowDownUp size={20} />, active: true, allowedRoles: IMPORT_EXPORT_ROLES },

  // Phase 12 modules - official books (admin + registrar)
  { label: 'الكتب الرسمية', path: '/official-books', icon: <BookMarked size={20} />, active: true, allowedRoles: OFFICIAL_BOOK_ACCESS_ROLES },
  { label: 'السجلات المطبوعة', path: '/print-records', icon: <Printer size={20} />, active: true, allowedRoles: OFFICIAL_BOOK_ACCESS_ROLES },

  // Settings - authenticated school roles may view; mutation remains management-only.
  { label: 'إعدادات النظام', path: '/settings', icon: <Settings size={20} />, active: true, allowedRoles: SETTINGS_VIEW_ROLES },
];

const futureModules: NavItem[] = [
  { label: 'النقل المدرسي', path: '#', icon: <Bus size={20} />, active: false, disabled: true },
  { label: 'بوابة المدرس', path: '#', icon: <Globe size={20} />, active: false, disabled: true },
  { label: 'بوابة ولي الأمر', path: '#', icon: <HeartHandshake size={20} />, active: false, disabled: true },
  { label: 'المساعد الذكي', path: '#', icon: <Brain size={20} />, active: false, disabled: true },
];

function isModuleVisible(item: NavItem, roleKey?: RoleKey | null): boolean {
  // Not authenticated - show only public items (none in activeModules)
  if (!roleKey) return false;
  // No role restriction - visible to all authenticated users
  if (!item.allowedRoles || item.allowedRoles.length === 0) return true;
  // Check if user's role is in allowed list
  return hasRole(roleKey, item.allowedRoles);
}

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  const visibleModules = activeModules.filter(item => isModuleVisible(item, user?.role_key));

  return (
    <aside className="fixed right-0 top-0 h-full w-64 bg-sidebar-bg text-white z-50 flex flex-col">
      <div className="p-6 flex-1 min-h-0 overflow-y-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-primary-600 rounded-lg flex items-center justify-center">
            <School size={24} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">نظام المدرسة</h1>
            <p className="text-xs text-gray-400">الذكي</p>
          </div>
        </div>

        <nav className="space-y-1">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-3">القائمة الرئيسية</p>
          {visibleModules.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                location.pathname === item.path
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-300 hover:bg-sidebar-hover hover:text-white'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}

          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mt-6 mb-2 px-3">الموديلات المستقبلية</p>
          {futureModules.map((item) => (
            <button
              key={item.label}
              onClick={(e) => {
                e.preventDefault();
                // Intentionally blocked - disabled module
              }}
              disabled
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 cursor-not-allowed opacity-60 disabled:cursor-not-allowed"
              title="غير مفعّل"
            >
              {item.icon}
              <span>{item.label}</span>
              <span className="mr-auto text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">غير مفعّل</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="shrink-0 p-4 border-t border-gray-800 bg-sidebar-bg">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 bg-primary-700 rounded-full flex items-center justify-center text-sm font-bold">
            {user?.full_name?.charAt(0) || 'م'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.full_name || 'مستخدم'}</p>
            <p className="text-xs text-gray-400 truncate">{user?.role_name || '---'}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full py-2 px-3 rounded-lg text-sm text-red-400 hover:bg-red-900/20 transition-colors text-right"
        >
          تسجيل الخروج
        </button>
      </div>
    </aside>
  );
}
