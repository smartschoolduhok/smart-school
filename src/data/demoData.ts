// ===========================================
// Demo Data for Phase 1
// All mock data for development and testing
// ===========================================

import type { School, UserWithSchoolAndRole, Role, Permission, RoleWithPermissions, Module, SchoolModule, AcademicYear } from '../types';

export const demoSchools: School[] = [
  { id: 1, name: 'مدرسة النخبة الأهلية', logo_url: null, school_type: 'خاص', city: 'بغداد', status: 'active', created_at: '2024-09-01' },
  { id: 2, name: 'مدرسة الرافدين الدولية', logo_url: null, school_type: 'دولي', city: 'البصرة', status: 'active', created_at: '2024-08-15' },
  { id: 3, name: 'مدرسة الإيمان المختلطة', logo_url: null, school_type: 'مختلط', city: 'النجف', status: 'active', created_at: '2024-07-20' },
  { id: 4, name: 'مدرسة البراءة الخاصة', logo_url: null, school_type: 'خاص', city: 'أربيل', status: 'inactive', created_at: '2024-06-10' },
];

export const demoRoles: Role[] = [
  { id: 1, name: 'مدير النظام', description: 'صلاحيات كاملة على كل المدارس والمستخدمين', key: 'system_admin' },
  { id: 2, name: 'صاحب المدرسة', description: 'إدارة مدرسته وكل بياناتها', key: 'school_owner' },
  { id: 3, name: 'المدير', description: 'إدارة شؤون المدرسة اليومية', key: 'principal' },
  { id: 4, name: 'المعاون', description: 'مساعد المدير في الإدارة', key: 'vice_principal' },
  { id: 5, name: 'المدرس', description: 'إدخال الدرجات ومتابعة الطلاب', key: 'teacher' },
  { id: 6, name: 'المحاسب', description: 'إدارة الأقساط والخزنة', key: 'accountant' },
  { id: 7, name: 'التسجيل', description: 'تسجيل الطلاب وإدارة البيانات', key: 'registrar' },
  { id: 8, name: 'ولي الأمر', description: 'متابعة ابنه وبياناته', key: 'parent' },
];

export const demoPermissions: Permission[] = [
  { id: 1, key: 'schools.view', name: 'عرض المدارس', description: 'عرض قائمة المدارس' },
  { id: 2, key: 'schools.create', name: 'إنشاء مدرسة', description: 'إضافة مدرسة جديدة' },
  { id: 3, key: 'schools.edit', name: 'تعديل مدرسة', description: 'تعديل بيانات المدرسة' },
  { id: 4, key: 'schools.delete', name: 'حذف مدرسة', description: 'حذف مدرسة من النظام' },
  { id: 5, key: 'users.view', name: 'عرض المستخدمين', description: 'عرض قائمة المستخدمين' },
  { id: 6, key: 'users.create', name: 'إنشاء مستخدم', description: 'إضافة مستخدم جديد' },
  { id: 7, key: 'users.edit', name: 'تعديل مستخدم', description: 'تعديل بيانات المستخدم' },
  { id: 8, key: 'users.delete', name: 'حذف مستخدم', description: 'حذف مستخدم من النظام' },
  { id: 9, key: 'roles.manage', name: 'إدارة الأدوار', description: 'إدارة الأدوار والصلاحيات' },
  { id: 10, key: 'settings.view', name: 'عرض الإعدادات', description: 'عرض إعدادات النظام' },
  { id: 11, key: 'settings.edit', name: 'تعديل الإعدادات', description: 'تعديل إعدادات النظام' },
  { id: 12, key: 'modules.manage', name: 'إدارة الموديلات', description: 'تفعيل/تعطيل موديلات المدرسة' },
];

export const demoRolePermissions: { role_id: number; permission_ids: number[] }[] = [
  { role_id: 1, permission_ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { role_id: 2, permission_ids: [5, 6, 7, 10, 11, 12] },
  { role_id: 3, permission_ids: [5, 6, 7, 10, 11] },
  { role_id: 4, permission_ids: [5, 6, 10] },
  { role_id: 5, permission_ids: [5, 10] },
  { role_id: 6, permission_ids: [5, 10] },
  { role_id: 7, permission_ids: [5, 6, 10] },
  { role_id: 8, permission_ids: [10] },
];

export const getRolesWithPermissions = (): RoleWithPermissions[] => {
  return demoRoles.map(role => {
    const rp = demoRolePermissions.find(rp => rp.role_id === role.id);
    const perms = rp ? demoPermissions.filter(p => rp.permission_ids.includes(p.id)) : [];
    return { ...role, permissions: perms };
  });
};

export const demoUsers: UserWithSchoolAndRole[] = [
  { id: 1, school_id: null, full_name: 'أحمد عبدالله', email: 'admin@smart-school.iq', role_id: 1, status: 'active', created_at: '2024-09-01', role_name: 'مدير النظام', school_name: 'كل المدارس' },
  { id: 2, school_id: 1, full_name: 'سارة محمود', email: 'principal@nukhba.iq', role_id: 3, status: 'active', created_at: '2024-09-05', role_name: 'المدير', school_name: 'مدرسة النخبة الأهلية' },
  { id: 3, school_id: 1, full_name: 'خالد العامري', email: 'teacher@nukhba.iq', role_id: 5, status: 'active', created_at: '2024-09-10', role_name: 'المدرس', school_name: 'مدرسة النخبة الأهلية' },
  { id: 4, school_id: 2, full_name: 'فاطمة الزهراء', email: 'owner@rafidain.iq', role_id: 2, status: 'active', created_at: '2024-08-20', role_name: 'صاحب المدرسة', school_name: 'مدرسة الرافدين الدولية' },
  { id: 5, school_id: 2, full_name: 'محمد حسين', email: 'accountant@rafidain.iq', role_id: 6, status: 'active', created_at: '2024-09-01', role_name: 'المحاسب', school_name: 'مدرسة الرافدين الدولية' },
  { id: 6, school_id: 3, full_name: 'نور الدين', email: 'registrar@eman.iq', role_id: 7, status: 'inactive', created_at: '2024-08-01', role_name: 'التسجيل', school_name: 'مدرسة الإيمان المختلطة' },
];

export const demoModules: Module[] = [
  { id: 1, key: 'dashboard', name: 'لوحة التحكم', description: 'الصفحة الرئيسية والإحصائيات', status: 'active' },
  { id: 2, key: 'schools', name: 'المدارس', description: 'إدارة المدارس', status: 'active' },
  { id: 3, key: 'users', name: 'المستخدمون', description: 'إدارة المستخدمين', status: 'active' },
  { id: 4, key: 'roles', name: 'الأدوار والصلاحيات', description: 'إدارة الأدوار', status: 'active' },
  { id: 5, key: 'settings', name: 'إعدادات النظام', description: 'إعدادات النظام العامة', status: 'active' },
  { id: 6, key: 'students', name: 'الطلاب', description: 'إدارة بيانات الطلاب', status: 'active' },
  { id: 7, key: 'classes', name: 'الصفوف والشعب', description: 'إدارة الصفوف والشعب', status: 'active' },
  { id: 8, key: 'subjects', name: 'المواد', description: 'إدارة المواد الدراسية', status: 'active' },
  { id: 9, key: 'grades', name: 'الدرجات', description: 'إدخال وإدارة الدرجات', status: 'active' },
  { id: 10, key: 'result_cards', name: 'كارتات النتائج', description: 'طباعة كارتات النتائج', status: 'active' },
  { id: 11, key: 'fees', name: 'الأقساط', description: 'إدارة الأقساط والدفع', status: 'active' },
  { id: 12, key: 'treasury', name: 'الخزنة', description: 'إدارة الخزينة والماليات', status: 'active' },
  { id: 13, key: 'official_books', name: 'الكتب الرسمية', description: 'إصدار الكتب الرسمية', status: 'active' },
  { id: 14, key: 'print_records', name: 'السجلات المطبوعة', description: 'طباعة السجلات والكشوفات', status: 'active' },
  { id: 15, key: 'employees', name: 'الموظفون', description: 'إدارة الموظفين', status: 'active' },
  { id: 16, key: 'transport', name: 'النقل المدرسي', description: 'إدارة النقل المدرسي', status: 'active' },
  { id: 17, key: 'teacher_portal', name: 'بوابة المدرس', description: 'بوابة المدرس الإلكترونية', status: 'active' },
  { id: 18, key: 'parent_portal', name: 'بوابة ولي الأمر', description: 'بوابة ولي الأمر الإلكترونية', status: 'active' },
  { id: 19, key: 'ai_assistant', name: 'المساعد الذكي', description: 'مساعد الذكاء الاصطناعي', status: 'active' },
];

export const demoSchoolModules: SchoolModule[] = [
  // School 1 - all active modules
  ...demoModules.map(m => ({ id: m.id, school_id: 1, module_id: m.id, is_enabled: true })),
  // School 2 - missing some advanced modules
  ...demoModules.map(m => ({
    id: m.id + 100,
    school_id: 2,
    module_id: m.id,
    is_enabled: m.id <= 12 // Only basic modules enabled
  })),
];

export const demoAcademicYears: AcademicYear[] = [
  { id: 1, school_id: 1, name: '٢٠٢٤-٢٠٢٥', starts_at: '2024-09-01', ends_at: '2025-06-30', is_active: true },
  { id: 2, school_id: 2, name: '٢٠٢٤-٢٠٢٥', starts_at: '2024-09-01', ends_at: '2025-06-30', is_active: true },
  { id: 3, school_id: 3, name: '٢٠٢٤-٢٠٢٥', starts_at: '2024-09-01', ends_at: '2025-06-30', is_active: true },
];
