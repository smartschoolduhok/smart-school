import {
  ArrowDownUp,
  BarChart3,
  BookMarked,
  BookOpen,
  Calculator,
  CalendarDays,
  ClipboardCheck,
  Clock3,
  CreditCard,
  DoorOpen,
  FileText,
  FolderCog,
  GraduationCap,
  LayoutDashboard,
  Layers,
  NotebookPen,
  Printer,
  School,
  Settings,
  Shield,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';
import type { RoleKey } from '../types';
import {
  ACADEMIC_ACCESS_ROLES,
  ACADEMIC_MANAGEMENT_ROLES,
  ANALYTICS_ACCESS_ROLES,
  ATTENDANCE_VIEW_ROLES,
  GATE_ATTENDANCE_VIEW_ROLES,
  HOMEWORK_VIEW_ROLES,
  COMMUNICATION_ROLES,
  STAFF_ATTENDANCE_VIEW_ROLES,
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

export interface NavigationItem { label: string; path: string; icon: React.ReactNode; allowedRoles?: readonly RoleKey[]; }
export interface NavigationGroup { key: string; label: string; description: string; icon: React.ReactNode; items: NavigationItem[]; }
export const DASHBOARD_NAVIGATION_ITEM: NavigationItem = { label: 'لوحة التحكم', path: '/', icon: <LayoutDashboard size={19} /> };
export const NAVIGATION_GROUPS: NavigationGroup[] = [
  { key: 'students', label: 'شؤون الطلاب', description: 'الملفات والقيد والقبول', icon: <GraduationCap size={19} />, items: [
    { label: 'الطلاب', path: '/students', icon: <GraduationCap size={18} />, allowedRoles: STUDENT_DIRECTORY_ROLES },
    { label: 'القبول والنقل', path: '/admissions', icon: <ArrowDownUp size={18} />, allowedRoles: ACADEMIC_MANAGEMENT_ROLES },
    { label: 'ترفيع الطلاب', path: '/student-promotion', icon: <ArrowDownUp size={18} />, allowedRoles: ACADEMIC_MANAGEMENT_ROLES },
    { label: 'مراجعة أعمار الطلاب', path: '/student-age-review', icon: <UserCheck size={18} />, allowedRoles: ACADEMIC_MANAGEMENT_ROLES },
  ] },
  { key: 'academic', label: 'التعليم والجدول', description: 'الصفوف والمواد وتكليفات التدريس', icon: <CalendarDays size={19} />, items: [
    { label: 'الجدول الدراسي', path: '/timetable', icon: <CalendarDays size={18} />, allowedRoles: ACADEMIC_MANAGEMENT_ROLES },
    { label: 'الصفوف والشعب', path: '/classes', icon: <Layers size={18} />, allowedRoles: ACADEMIC_ACCESS_ROLES },
    { label: 'المواد', path: '/subjects', icon: <BookOpen size={18} />, allowedRoles: ACADEMIC_ACCESS_ROLES },
    { label: 'مواد الطالب', path: '/student-subjects', icon: <BookMarked size={18} />, allowedRoles: ACADEMIC_ACCESS_ROLES },
    { label: 'مرشدو الصفوف', path: '/section-advisors', icon: <UserCheck size={18} />, allowedRoles: ACADEMIC_MANAGEMENT_ROLES },
  ] },
  { key: 'assessment', label: 'الدرجات والنتائج', description: 'إدخال الدرجات والمتابعة والتقارير', icon: <Calculator size={19} />, items: [
    { label: 'الدرجات', path: '/grades', icon: <Calculator size={18} />, allowedRoles: GRADE_VIEW_ROLES },
    { label: 'متابعة الدرجات', path: '/grade-progress', icon: <BookOpen size={18} />, allowedRoles: ACADEMIC_ACCESS_ROLES },
    { label: 'كارتات النتائج', path: '/result-cards', icon: <FileText size={18} />, allowedRoles: ACADEMIC_ACCESS_ROLES },
    { label: 'التحليل', path: '/analytics', icon: <BarChart3 size={18} />, allowedRoles: ANALYTICS_ACCESS_ROLES },
  ] },
  { key: 'daily', label: 'الحضور والتواصل', description: 'المتابعة اليومية والتواصل مع الأسرة', icon: <ClipboardCheck size={19} />, items: [
    { label: 'الحضور والغياب', path: '/attendance', icon: <ClipboardCheck size={18} />, allowedRoles: ATTENDANCE_VIEW_ROLES },
    { label: 'بوابة المدرسة', path: '/gate-attendance', icon: <DoorOpen size={18} />, allowedRoles: GATE_ATTENDANCE_VIEW_ROLES },
    { label: 'الواجبات المنزلية', path: '/homework', icon: <NotebookPen size={18} />, allowedRoles: HOMEWORK_VIEW_ROLES },
    { label: 'تواصل ولي الأمر', path: '/communication', icon: <Users size={18} />, allowedRoles: COMMUNICATION_ROLES },
  ] },
  { key: 'finance', label: 'المالية', description: 'الأقساط والتحصيل وحركة الخزنة', icon: <Wallet size={19} />, items: [
    { label: 'الأقساط', path: '/fees', icon: <CreditCard size={18} />, allowedRoles: FEE_MANAGEMENT_ROLES },
    { label: 'الخزنة', path: '/treasury', icon: <Wallet size={18} />, allowedRoles: FINANCE_ACCESS_ROLES },
  ] },
  { key: 'staff', label: 'الكادر والرواتب', description: 'ملفات الموظفين والحضور والكشوف', icon: <UserCheck size={19} />, items: [
    { label: 'الموظفون والرواتب', path: '/employees', icon: <UserCheck size={18} />, allowedRoles: EMPLOYEE_ACCESS_ROLES },
    { label: 'سجل الكادر', path: '/staff-register', icon: <Users size={18} />, allowedRoles: EMPLOYEE_ACCESS_ROLES },
    { label: 'كشف استلام الرواتب', path: '/salary-receipts', icon: <FileText size={18} />, allowedRoles: EMPLOYEE_ACCESS_ROLES },
    { label: 'حضور الموظفين', path: '/staff-attendance', icon: <Clock3 size={18} />, allowedRoles: STAFF_ATTENDANCE_VIEW_ROLES },
  ] },
  { key: 'documents', label: 'الوثائق والبيانات', description: 'الكتب الرسمية والسجلات والاستيراد', icon: <FileText size={19} />, items: [
    { label: 'الكتب الرسمية', path: '/official-books', icon: <BookMarked size={18} />, allowedRoles: OFFICIAL_BOOK_ACCESS_ROLES },
    { label: 'السجلات المطبوعة', path: '/print-records', icon: <Printer size={18} />, allowedRoles: OFFICIAL_BOOK_ACCESS_ROLES },
    { label: 'استيراد وتصدير Excel', path: '/import-export', icon: <ArrowDownUp size={18} />, allowedRoles: IMPORT_EXPORT_ROLES },
  ] },
  { key: 'administration', label: 'الإدارة والإعدادات', description: 'الحسابات والصلاحيات وإعداد المدرسة', icon: <FolderCog size={19} />, items: [
    { label: 'المدارس', path: '/schools', icon: <School size={18} />, allowedRoles: SYSTEM_ADMIN_ROLES },
    { label: 'المستخدمون', path: '/users', icon: <Users size={18} />, allowedRoles: USER_DIRECTORY_ROLES },
    { label: 'الأدوار والصلاحيات', path: '/roles', icon: <Shield size={18} />, allowedRoles: SYSTEM_ADMIN_ROLES },
    { label: 'لوائح القبول والنقل', path: '/regulations', icon: <BookOpen size={18} />, allowedRoles: ACADEMIC_MANAGEMENT_ROLES },
    { label: 'إعدادات النظام', path: '/settings', icon: <Settings size={18} />, allowedRoles: SETTINGS_VIEW_ROLES },
  ] },
];

export function getVisibleNavigationGroups(roleKey?: RoleKey | null): NavigationGroup[] {
  if (!roleKey) return [];
  return NAVIGATION_GROUPS.map(group => ({ ...group, items: group.items
    .filter(item => !item.allowedRoles?.length || hasRole(roleKey, item.allowedRoles))
    .map(item => roleKey === 'parent' && item.path === '/students' ? { ...item, label: 'أبنائي' }
      : roleKey === 'parent' && item.path === '/grades' ? { ...item, label: 'متابعة الدرجات' } : item) }))
    .filter(group => group.items.length > 0);
}
export function getVisibleNavigationItems(roleKey?: RoleKey | null): NavigationItem[] {
  return roleKey ? [DASHBOARD_NAVIGATION_ITEM, ...getVisibleNavigationGroups(roleKey).flatMap(group => group.items)] : [];
}
export function isNavigationPathActive(pathname: string, path: string): boolean {
  return pathname === path || (path !== '/' && pathname.startsWith(path + '/'));
}
export function getNavigationLocation(pathname: string, roleKey?: RoleKey | null) {
  const canonicalPath = roleKey === 'parent' && pathname === '/grade-progress' ? '/grades' : pathname;
  for (const group of getVisibleNavigationGroups(roleKey)) {
    const item = group.items.find(item => isNavigationPathActive(canonicalPath, item.path));
    if (item) return { group, item };
  }
  return { group: null, item: DASHBOARD_NAVIGATION_ITEM };
}
export function normalizeNavigationSearch(value: string): string {
  return value.trim().toLocaleLowerCase('ar').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي');
}
const DAILY_PATHS: Partial<Record<RoleKey, string[]>> = {
  system_admin: ['/schools', '/users', '/settings', '/analytics', '/students', '/timetable'],
  school_owner: ['/students', '/grades', '/timetable', '/attendance', '/employees', '/fees'],
  principal: ['/students', '/grades', '/timetable', '/attendance', '/employees', '/admissions'],
  vice_principal: ['/students', '/grades', '/timetable', '/attendance', '/admissions', '/section-advisors'],
  registrar: ['/students', '/admissions', '/attendance', '/gate-attendance', '/student-age-review', '/classes'],
  teacher: ['/grades', '/attendance', '/homework', '/grade-progress', '/communication', '/staff-attendance'],
  accountant: ['/fees', '/treasury', '/employees', '/salary-receipts', '/students', '/staff-attendance'],
};
export function getDailyNavigationItems(roleKey?: RoleKey | null): NavigationItem[] {
  const items = getVisibleNavigationItems(roleKey).filter(item => item.path !== '/');
  const paths = roleKey && DAILY_PATHS[roleKey];
  return paths ? paths.flatMap(path => items.filter(item => item.path === path)) : items.slice(0, 6);
}
