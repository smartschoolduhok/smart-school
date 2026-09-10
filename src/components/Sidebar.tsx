import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowDownUp,
  BarChart3,
  BookMarked,
  BookOpen,
  Calculator,
  CalendarDays,
  ChevronDown,
  CreditCard,
  FileText,
  FolderCog,
  GraduationCap,
  LayoutDashboard,
  Layers,
  LogOut,
  Printer,
  School,
  Settings,
  Shield,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import type { RoleKey } from '../types';
import {
  ACADEMIC_ACCESS_ROLES,
  ACADEMIC_MANAGEMENT_ROLES,
  ANALYTICS_ACCESS_ROLES,
  EMPLOYEE_ACCESS_ROLES,
  FEE_MANAGEMENT_ROLES,
  FINANCE_ACCESS_ROLES,
  GRADE_VIEW_ROLES,
  IMPORT_EXPORT_ROLES,
  OFFICIAL_BOOK_ACCESS_ROLES,
  SETTINGS_VIEW_ROLES,
  STUDENT_DIRECTORY_ROLES,
  SYSTEM_ADMIN_ROLES,
  USER_DIRECTORY_ROLES,
  hasRole,
} from '../lib/rbac';

export interface NavigationItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  allowedRoles?: readonly RoleKey[];
}

interface NavigationGroup {
  key: string;
  label: string;
  icon: React.ReactNode;
  items: NavigationItem[];
}

export const DASHBOARD_NAVIGATION_ITEM: NavigationItem = {
  label: 'لوحة التحكم',
  path: '/',
  icon: <LayoutDashboard size={20} />,
};

export const NAVIGATION_GROUPS: NavigationGroup[] = [
  {
    key: 'students',
    label: 'شؤون الطلاب',
    icon: <GraduationCap size={19} />,
    items: [
      { label: 'الطلاب', path: '/students', icon: <GraduationCap size={18} />, allowedRoles: STUDENT_DIRECTORY_ROLES },
      { label: 'ترفيع الطلاب', path: '/student-promotion', icon: <ArrowDownUp size={18} />, allowedRoles: ACADEMIC_MANAGEMENT_ROLES },
    ],
  },
  {
    key: 'academic',
    label: 'التعليم والجدول',
    icon: <BookOpen size={19} />,
    items: [
      { label: 'الدرجات', path: '/grades', icon: <Calculator size={18} />, allowedRoles: GRADE_VIEW_ROLES },
      { label: 'الجدول الدراسي', path: '/timetable', icon: <CalendarDays size={18} />, allowedRoles: ACADEMIC_MANAGEMENT_ROLES },
      { label: 'الصفوف والشعب', path: '/classes', icon: <Layers size={18} />, allowedRoles: ACADEMIC_ACCESS_ROLES },
      { label: 'المواد', path: '/subjects', icon: <BookOpen size={18} />, allowedRoles: ACADEMIC_ACCESS_ROLES },
      { label: 'مواد الطالب', path: '/student-subjects', icon: <BookMarked size={18} />, allowedRoles: ACADEMIC_ACCESS_ROLES },
    ],
  },
  {
    key: 'finance',
    label: 'المالية والموظفون',
    icon: <Wallet size={19} />,
    items: [
      { label: 'الأقساط', path: '/fees', icon: <CreditCard size={18} />, allowedRoles: FEE_MANAGEMENT_ROLES },
      { label: 'الخزنة', path: '/treasury', icon: <Wallet size={18} />, allowedRoles: FINANCE_ACCESS_ROLES },
      { label: 'الموظفون والرواتب', path: '/employees', icon: <UserCheck size={18} />, allowedRoles: EMPLOYEE_ACCESS_ROLES },
    ],
  },
  {
    key: 'reports',
    label: 'التقارير والوثائق',
    icon: <FileText size={19} />,
    items: [
      { label: 'التحليل', path: '/analytics', icon: <BarChart3 size={18} />, allowedRoles: ANALYTICS_ACCESS_ROLES },
      { label: 'كارتات النتائج', path: '/result-cards', icon: <FileText size={18} />, allowedRoles: ACADEMIC_ACCESS_ROLES },
      { label: 'الكتب الرسمية', path: '/official-books', icon: <BookMarked size={18} />, allowedRoles: OFFICIAL_BOOK_ACCESS_ROLES },
      { label: 'السجلات المطبوعة', path: '/print-records', icon: <Printer size={18} />, allowedRoles: OFFICIAL_BOOK_ACCESS_ROLES },
    ],
  },
  {
    key: 'data',
    label: 'البيانات',
    icon: <ArrowDownUp size={19} />,
    items: [
      { label: 'استيراد وتصدير Excel', path: '/import-export', icon: <ArrowDownUp size={18} />, allowedRoles: IMPORT_EXPORT_ROLES },
    ],
  },
  {
    key: 'administration',
    label: 'الإدارة والإعدادات',
    icon: <FolderCog size={19} />,
    items: [
      { label: 'المدارس', path: '/schools', icon: <School size={18} />, allowedRoles: SYSTEM_ADMIN_ROLES },
      { label: 'المستخدمون', path: '/users', icon: <Users size={18} />, allowedRoles: USER_DIRECTORY_ROLES },
      { label: 'الأدوار والصلاحيات', path: '/roles', icon: <Shield size={18} />, allowedRoles: SYSTEM_ADMIN_ROLES },
      { label: 'إعدادات النظام', path: '/settings', icon: <Settings size={18} />, allowedRoles: SETTINGS_VIEW_ROLES },
    ],
  },
];

function isItemVisible(item: NavigationItem, roleKey?: RoleKey | null): boolean {
  if (!roleKey) return false;
  return !item.allowedRoles?.length || hasRole(roleKey, item.allowedRoles);
}

export function getVisibleNavigationItems(roleKey?: RoleKey | null): NavigationItem[] {
  if (!roleKey) return [];
  return [
    DASHBOARD_NAVIGATION_ITEM,
    ...NAVIGATION_GROUPS.flatMap(group => group.items).filter(item => isItemVisible(item, roleKey)),
  ];
}

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isOpen = false, onClose = () => {} }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  const visibleGroups = useMemo(() => NAVIGATION_GROUPS
    .map(group => ({ ...group, items: group.items.filter(item => isItemVisible(item, user?.role_key)) }))
    .filter(group => group.items.length > 0), [user?.role_key]);

  const activeGroup = visibleGroups.find(group => group.items.some(item => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)));
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroup?.key || null);

  useEffect(() => {
    if (activeGroup) setOpenGroup(activeGroup.key);
  }, [activeGroup?.key]);

  function go(path: string) {
    navigate(path);
    onClose();
  }

  return (
    <aside
      id="application-sidebar"
      className={`fixed right-0 top-0 z-50 flex h-full w-72 max-w-[88vw] flex-col bg-sidebar-bg text-white shadow-xl transition-transform duration-200 lg:w-64 lg:max-w-none lg:translate-x-0 lg:shadow-none ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
      aria-label="التنقل الرئيسي"
    >
      <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-5">
        <div className="mb-6 flex items-center gap-3 px-1">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-600">
            <School size={24} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold leading-tight">نظام المدرسة الذكي</h1>
            <p className="truncate text-xs text-gray-400">{user?.school_name || 'الإدارة المركزية'}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-300 hover:bg-sidebar-hover hover:text-white lg:hidden" aria-label="إغلاق القائمة">
            <X size={20} />
          </button>
        </div>

        <nav className="space-y-2">
          <button
            type="button"
            onClick={() => go('/')}
            aria-current={location.pathname === '/' ? 'page' : undefined}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              location.pathname === '/' ? 'bg-primary-600 text-white' : 'text-gray-300 hover:bg-sidebar-hover hover:text-white'
            }`}
          >
            {DASHBOARD_NAVIGATION_ITEM.icon}
            <span>{DASHBOARD_NAVIGATION_ITEM.label}</span>
          </button>

          {visibleGroups.map(group => {
            const expanded = openGroup === group.key;
            const groupActive = group.items.some(item => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`));
            const panelId = `navigation-group-${group.key}`;
            return (
              <div key={group.key} className="rounded-lg">
                <button
                  type="button"
                  onClick={() => setOpenGroup(expanded ? null : group.key)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                    groupActive ? 'bg-gray-800 text-white' : 'text-gray-300 hover:bg-sidebar-hover hover:text-white'
                  }`}
                  aria-expanded={expanded}
                  aria-controls={panelId}
                >
                  {group.icon}
                  <span>{group.label}</span>
                  <ChevronDown size={16} className={`mr-auto transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>
                {expanded && (
                  <div id={panelId} className="mr-4 mt-1 space-y-1 border-r border-gray-700 pr-2">
                    {group.items.map(item => {
                      const active = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
                      const label = user?.role_key === 'parent' && item.path === '/students' ? 'أبنائي' : item.label;
                      return (
                        <button
                          type="button"
                          key={item.path}
                          onClick={() => go(item.path)}
                          aria-current={active ? 'page' : undefined}
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                            active ? 'bg-primary-600 text-white' : 'text-gray-400 hover:bg-sidebar-hover hover:text-white'
                          }`}
                        >
                          {item.icon}
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      <div className="shrink-0 border-t border-gray-800 bg-sidebar-bg p-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-700 text-sm font-bold">
            {user?.full_name?.charAt(0) || 'م'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user?.full_name || 'مستخدم'}</p>
            <p className="truncate text-xs text-gray-400">{user?.role_name || '---'}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { onClose(); void logout(); }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm text-red-400 transition-colors hover:bg-red-900/20"
        >
          <LogOut size={17} />
          تسجيل الخروج
        </button>
      </div>
    </aside>
  );
}
