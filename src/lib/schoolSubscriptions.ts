// School subscriptions: which modules a plan includes, how validity dates map to
// an access state, and which API requests that state or module set allows.
// Pure logic shared by the Worker, the navigation and the tests.

export const SCHOOL_MODULE_KEYS = [
  'grades', 'official_documents', 'timetable', 'attendance', 'homework', 'communication',
  'admissions', 'finance', 'staff_payroll', 'transport', 'school_registers',
] as const;
export type SchoolModuleKey = typeof SCHOOL_MODULE_KEYS[number];

export const SUBSCRIPTION_PLAN_KEYS = ['basic', 'standard', 'full'] as const;
export type SubscriptionPlanKey = typeof SUBSCRIPTION_PLAN_KEYS[number];

type ModuleDefinition = { label: string; apiPrefixes: readonly string[]; navPaths: readonly string[] };

// Students, classes, subjects, users, settings, employees and import/export are
// core: every plan needs them and other modules depend on them.
export const SCHOOL_MODULES: Record<SchoolModuleKey, ModuleDefinition> = {
  grades: { label: 'الدرجات والنتائج', apiPrefixes: ['grades', 'grade-settings', 'grade-policies', 'academic-outcomes', 'analytics', 'grade-progress', 'result-cards'], navPaths: ['/grades', '/grade-progress', '/result-cards', '/analytics'] },
  official_documents: { label: 'الكتب الرسمية والطباعة', apiPrefixes: ['official-books', 'official-book-templates', 'official-book-staff', 'print-records', 'section-advisors'], navPaths: ['/official-books', '/print-records', '/section-advisors'] },
  timetable: { label: 'الجدول الدراسي', apiPrefixes: ['timetable', 'teacher-workload-extras'], navPaths: ['/timetable'] },
  attendance: { label: 'حضور الطلاب والبوابة', apiPrefixes: ['attendance', 'gate-attendance'], navPaths: ['/attendance', '/gate-attendance'] },
  homework: { label: 'الواجبات المنزلية', apiPrefixes: ['homework'], navPaths: ['/homework'] },
  communication: { label: 'تواصل ولي الأمر', apiPrefixes: ['communication'], navPaths: ['/communication'] },
  admissions: { label: 'القبول والنقل', apiPrefixes: ['admissions', 'regulations'], navPaths: ['/admissions', '/regulations'] },
  finance: { label: 'الأقساط والخزنة', apiPrefixes: ['student-fees', 'fee-payments', 'fee-receipts', 'student-finance', 'treasury'], navPaths: ['/fees', '/treasury'] },
  staff_payroll: { label: 'الرواتب وحضور الموظفين', apiPrefixes: ['salaries', 'salary-receipts', 'staff-register', 'staff-attendance'], navPaths: ['/staff-register', '/salary-receipts', '/staff-attendance'] },
  transport: { label: 'النقل', apiPrefixes: ['transport'], navPaths: ['/transport'] },
  school_registers: { label: 'السجلات المدرسية', apiPrefixes: ['school-registers'], navPaths: ['/school-registers'] },
};

const BASIC: readonly SchoolModuleKey[] = ['grades', 'official_documents'];
const STANDARD: readonly SchoolModuleKey[] = [...BASIC, 'timetable', 'attendance', 'homework', 'communication', 'admissions'];

export const SUBSCRIPTION_PLANS: Record<SubscriptionPlanKey, { label: string; modules: readonly SchoolModuleKey[] }> = {
  basic: { label: 'الأساسية', modules: BASIC },
  standard: { label: 'المتقدمة', modules: STANDARD },
  full: { label: 'الكاملة', modules: SCHOOL_MODULE_KEYS },
};

export type SchoolSubscriptionRow = {
  school_id: number;
  plan_key: SubscriptionPlanKey;
  status: 'active' | 'suspended';
  starts_on: string | null;
  ends_on: string | null;
  grace_days: number;
  max_students: number | null;
  notes: string | null;
  revision: number;
};

export type ModuleOverrides = Partial<Record<SchoolModuleKey, boolean>>;

export function effectiveModules(plan: SubscriptionPlanKey, overrides: ModuleOverrides = {}): SchoolModuleKey[] {
  const included = new Set<SchoolModuleKey>(SUBSCRIPTION_PLANS[plan]?.modules ?? SCHOOL_MODULE_KEYS);
  for (const key of SCHOOL_MODULE_KEYS) {
    if (overrides[key] === true) included.add(key);
    if (overrides[key] === false) included.delete(key);
  }
  return SCHOOL_MODULE_KEYS.filter(key => included.has(key));
}

export type SubscriptionAccessState = 'active' | 'grace' | 'read_only';

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// `today` is the Baghdad business date (YYYY-MM-DD). The last valid day is
// ends_on itself; grace runs for grace_days after it, then the school is read-only.
export function subscriptionAccessState(sub: Pick<SchoolSubscriptionRow, 'status' | 'ends_on' | 'grace_days'>, today: string): {
  state: SubscriptionAccessState;
  days_left: number | null;
  read_only_from: string | null;
} {
  if (sub.status === 'suspended') return { state: 'read_only', days_left: null, read_only_from: null };
  if (!sub.ends_on) return { state: 'active', days_left: null, read_only_from: null };
  const readOnlyFrom = addDays(sub.ends_on, sub.grace_days + 1);
  if (today <= sub.ends_on) return { state: 'active', days_left: daysBetween(today, sub.ends_on), read_only_from: readOnlyFrom };
  if (today < readOnlyFrom) return { state: 'grace', days_left: daysBetween(today, readOnlyFrom), read_only_from: readOnlyFrom };
  return { state: 'read_only', days_left: 0, read_only_from: readOnlyFrom };
}

export function moduleForApiPath(path: string): SchoolModuleKey | null {
  const prefix = /^\/api\/([a-z0-9-]+)/.exec(path)?.[1];
  if (!prefix) return null;
  for (const key of SCHOOL_MODULE_KEYS) if (SCHOOL_MODULES[key].apiPrefixes.includes(prefix)) return key;
  return null;
}

export function moduleForNavPath(path: string): SchoolModuleKey | null {
  for (const key of SCHOOL_MODULE_KEYS) if (SCHOOL_MODULES[key].navPaths.includes(path)) return key;
  return null;
}

// Requests a read-only school may still send: reading, previews, printing,
// marking notifications read and managing its own session.
export function isReadOnlySafeRequest(method: string, path: string): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return true;
  if (['/api/auth/logout', '/api/auth/change-password'].includes(path)) return true;
  if (/\/preview(?:-[a-z-]+)?(?:\/\d+)?$|\/[a-z-]*-preview$/.test(path)) return true;
  if (/^\/api\/official-books\/\d+\/print$/.test(path)) return true;
  if (/^\/api\/notifications\/[^/]+\/read$/.test(path)) return true;
  return false;
}

export type SchoolAccess = {
  school_id: number;
  plan_key: SubscriptionPlanKey;
  status: 'active' | 'suspended';
  ends_on: string | null;
  state: SubscriptionAccessState;
  days_left: number | null;
  read_only_from: string | null;
  modules: SchoolModuleKey[];
};

export const SUBSCRIPTION_READ_ONLY_ERROR = 'اشتراك المدرسة منتهٍ أو موقوف؛ يمكن الاطلاع والطباعة فقط. تواصل مع إدارة النظام للتجديد.';
export const MODULE_DISABLED_ERROR = 'هذه الوحدة غير مفعّلة في اشتراك المدرسة.';
export const STUDENT_LIMIT_ERROR = 'وصلت المدرسة إلى الحد الأقصى للطلاب النشطين في اشتراكها.';

export function schoolAccessDenial(access: SchoolAccess, method: string, path: string): { status: 403; body: { error: string; code: string } } | null {
  const module = moduleForApiPath(path);
  if (module && !access.modules.includes(module)) {
    return { status: 403, body: { error: MODULE_DISABLED_ERROR, code: 'module_disabled' } };
  }
  if (access.state === 'read_only' && !isReadOnlySafeRequest(method, path)) {
    return { status: 403, body: { error: SUBSCRIPTION_READ_ONLY_ERROR, code: 'subscription_read_only' } };
  }
  return null;
}

export type SubscriptionUpdate = {
  plan_key: SubscriptionPlanKey;
  status: 'active' | 'suspended';
  starts_on: string | null;
  ends_on: string | null;
  grace_days: number;
  max_students: number | null;
  notes: string | null;
  overrides: ModuleOverrides;
  expected_revision: number;
};

export class SubscriptionValidationError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function optionalDate(value: unknown, label: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new SubscriptionValidationError(`${label} غير صالح`);
  }
  return value;
}

export function parseSubscriptionUpdate(body: unknown): SubscriptionUpdate {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SubscriptionValidationError('بيانات الاشتراك غير صالحة');
  const raw = body as Record<string, unknown>;
  if (!SUBSCRIPTION_PLAN_KEYS.includes(raw.plan_key as SubscriptionPlanKey)) throw new SubscriptionValidationError('الباقة غير صالحة');
  if (raw.status !== 'active' && raw.status !== 'suspended') throw new SubscriptionValidationError('حالة الاشتراك غير صالحة');
  const startsOn = optionalDate(raw.starts_on, 'تاريخ البداية');
  const endsOn = optionalDate(raw.ends_on, 'تاريخ الانتهاء');
  if (startsOn && endsOn && endsOn < startsOn) throw new SubscriptionValidationError('تاريخ الانتهاء قبل تاريخ البداية');
  const graceDays = raw.grace_days == null || raw.grace_days === '' ? 14 : Number(raw.grace_days);
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 90) throw new SubscriptionValidationError('أيام المهلة يجب أن تكون بين 0 و90');
  const maxStudents = raw.max_students == null || raw.max_students === '' ? null : Number(raw.max_students);
  if (maxStudents !== null && (!Number.isInteger(maxStudents) || maxStudents < 1 || maxStudents > 100_000)) {
    throw new SubscriptionValidationError('الحد الأقصى للطلاب غير صالح');
  }
  const notes = raw.notes == null || raw.notes === '' ? null : String(raw.notes).trim();
  if (notes && notes.length > 1000) throw new SubscriptionValidationError('الملاحظات طويلة جدًا');
  const overrides: ModuleOverrides = {};
  if (raw.overrides != null) {
    if (typeof raw.overrides !== 'object' || Array.isArray(raw.overrides)) throw new SubscriptionValidationError('استثناءات الوحدات غير صالحة');
    for (const [key, value] of Object.entries(raw.overrides as Record<string, unknown>)) {
      if (!SCHOOL_MODULE_KEYS.includes(key as SchoolModuleKey) || typeof value !== 'boolean') {
        throw new SubscriptionValidationError('استثناءات الوحدات غير صالحة');
      }
      overrides[key as SchoolModuleKey] = value;
    }
  }
  const expectedRevision = Number(raw.expected_revision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new SubscriptionValidationError('رقم المراجعة مطلوب');
  return {
    plan_key: raw.plan_key as SubscriptionPlanKey,
    status: raw.status,
    starts_on: startsOn,
    ends_on: endsOn,
    grace_days: graceDays,
    max_students: maxStudents,
    notes: notes || null,
    overrides,
    expected_revision: expectedRevision,
  };
}

// Only store exceptions that differ from the plan, so a later plan change
// does not carry stale "enabled" rows for modules the new plan already has.
export function normalizeOverrides(plan: SubscriptionPlanKey, overrides: ModuleOverrides): ModuleOverrides {
  const planModules = new Set(SUBSCRIPTION_PLANS[plan].modules);
  const result: ModuleOverrides = {};
  for (const key of SCHOOL_MODULE_KEYS) {
    if (overrides[key] === undefined) continue;
    if (overrides[key] !== planModules.has(key)) result[key] = overrides[key];
  }
  return result;
}
