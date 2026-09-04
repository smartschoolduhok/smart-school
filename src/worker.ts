// ===========================================
// Hono Backend - Phase 2.6 (Auth Hardening)
// Cloudflare Pages Worker with D1 Database
// JWT Bearer Token Authentication via Web Crypto
// ===========================================

import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import type { RoleKey } from './types'
import {
  ACADEMIC_ACCESS_ROLES,
  ACADEMIC_MANAGEMENT_ROLES,
  EMPLOYEE_ACCESS_ROLES,
  EMPLOYEE_MANAGEMENT_ROLES,
  EMPLOYEE_SALARY_ROLES,
  FEE_MANAGEMENT_ROLES,
  FINANCE_ACCESS_ROLES,
  GRADE_MANAGEMENT_ROLES,
  OFFICIAL_BOOK_ACCESS_ROLES,
  OFFICIAL_BOOK_VIEW_ROLES,
  RESULT_CARD_MANAGEMENT_ROLES,
  RESULT_CARD_PRINT_ROLES,
  RESULT_CARD_VIEW_ROLES,
  SCHOOL_MANAGEMENT_ROLES,
  SETTINGS_MANAGEMENT_ROLES,
  SETTINGS_VIEW_ROLES,
  USER_DIRECTORY_ROLES,
  hasRole,
} from './lib/rbac'
import {
  calculateResultCardColumnAverages,
  evaluateResultCard,
  type ResultCardAcademicYear,
  type ResultCardEvaluation,
  type ResultCardGrade,
  type ResultCardSettings,
  type ResultCardSubject,
} from './lib/resultCards'
import { hashPassword, verifyPassword } from './lib/authSecurity'
import {
  JWT_SESSION_TTL_SECONDS,
  getValidatedJwtSecret,
  signJWT,
  verifyJWT,
  type JwtPayload,
} from './lib/jwtSecurity'
import {
  LOGIN_THROTTLE_POLICIES,
  createLoginThrottleKey,
  getAllowedCorsOrigins,
  getClientIp,
  inspectLoginThrottle,
  isCorsOriginAllowed,
  isPublicApiRequest,
  normalizeLoginEmail,
  type LoginThrottleBucketType,
  type LoginThrottlePolicy,
  type LoginThrottleRecord,
} from './lib/apiSecurity'
import { normalizeSectionName, RAW_GRADE_FIELDS, type RawGradeField } from './lib/excelImport'
import { calculateGrades, type RawGradeValues } from './lib/gradeCalculations'
import { RECALCULATE_SCHOOL_GRADES_SQL } from './lib/gradeRecalculationSql'
import {
  DEFAULT_GRADE_SCHEME_SETTINGS,
  disabledRawGradeFields,
  normalizeGradeSchemeSettings,
  RAW_GRADE_FIELD_LABELS,
  validateGradeSchemeSettings,
} from './lib/gradeScheme'
import {
  buildResultCardColumns,
  normalizeResultCardDecisionNote,
  normalizeResultCardDisplaySettings,
  parseResultCardDisplaySettings,
  validateResultCardDecisionNote,
  validateResultCardDisplaySettings,
  type ResultCardDisplaySettings,
} from './lib/resultCardPresentation'
import {
  RAW_GRADE_MAX_CONFLICT_SQL,
  shouldCheckRawGradeMaxConflict,
  type RawGradeMaxConflict,
} from './lib/gradeSettingsIntegrity'
import {
  activateAcademicYearAtomically,
  createInactiveAcademicYear,
  isDuplicateAcademicYearError,
  updateAcademicYearDetails,
  validateAcademicYearInput,
  type AcademicYearRecord,
} from './lib/academicYears'
import {
  buildGradeImportPlan,
  type GradeImportContext,
  type GradeImportPayload,
  type GradeImportSourcePayload,
  type PlannedGradeImportRecord,
} from './lib/gradeImport'
import { resolveRequiredWriteSchoolId } from './lib/tenantSchool'
import {
  buildAtomicSubjectOrderUpdateSql,
  validateSubjectOrder,
  type SubjectOrderRecord,
} from './lib/subjectOrdering'
import {
  buildBulkSubjectPlan,
  canonicalizeSubjectDisplayName,
  SUBJECT_NAME_SQL_NORMALIZATION_SEED,
  validateBulkSubjectPayload,
  type BulkSubjectClassRecord,
  type BulkSubjectExistingRecord,
  type BulkSubjectPlan,
  type BulkSubjectValidationCode,
  type BulkSubjectValues,
} from './lib/subjectBulk'
import {
  buildGeneratedStudentNumber,
  findStudentDuplicate,
  normalizeStudentIdentity,
  syncStudentImportState,
  studentDuplicateAction,
  studentIdentityKey,
  validateStudentImportPlacement,
} from './lib/studentImport'
import {
  archiveStudentWithoutEnrollmentMutation,
  buildStudentPlacementUpdatePlan,
  createStudentWithEnrollmentBridge,
  FINALIZED_ENROLLMENT_PLACEMENT_ERROR,
  FinalizedEnrollmentPlacementError,
  getStudentWithEffectivePlacement,
  listStudentEnrollmentHistory,
  listStudentsWithEffectivePlacement,
  loadCurrentStudentEnrollmentContext,
  persistStudentImportWithEnrollmentBridge,
  resolveActiveAcademicYear,
  updateStudentIdentityOnly,
  updateStudentPlacementAtomically,
  type StudentWriteValues,
} from './lib/studentEnrollments'
import { executeStudentPromotion, previewStudentPromotion } from './lib/studentPromotion'
import { executeBulkStudentPromotion, previewBulkStudentPromotion } from './lib/studentBulkPromotion'
import { ANALYTICS_APPLICABLE_GRADE_JOINS } from './lib/subjectApplicability'
import {
  STUDENT_RELIGION_HEADER_ALIASES,
  normalizeExcelStudentReligion,
  validateStudentReligion,
} from './lib/studentReligion'
import {
  RELIGIOUS_SUBJECT_BULK_ERROR,
  RELIGIOUS_SUBJECT_CONFLICT_ERROR,
  RELIGIOUS_SUBJECT_HAS_GRADES_CODE,
  RELIGIOUS_TRACK_HEADER_ALIASES,
  countSubjectReligiousConversionConflicts,
  deactivateStudentSubjectAssignments,
  findActiveReligiousAssignment,
  hasRecordedReligiousSubjectGrades,
  normalizeExcelReligiousTrack,
  preflightImportedReligiousAssignments,
  validateReligiousTrack,
  type ReligiousTrack,
} from './lib/religiousSubjects'
import {
  buildTeacherAvailabilityMatrix,
  buildTimetableReadiness,
  evaluateTimetableEntryPlacement,
  isTimetableConstraintError,
  loadHasInvalidAcademicReference,
  loadHasInvalidTeacherReference,
  validateTeacherAvailabilityDayInput,
  validateTeacherAvailabilityOverrideInput,
  validateTeacherAvailabilityScopeInput,
  validateTeacherConstraintsInput,
  validateTimetableDayInput,
  validateTimetableEntryInput,
  validateTimetableGridScopeInput,
  validateTimetableLoadInput,
  validateTimetableSlotInput,
  type TimetableDay,
  type TimetableEntry,
  type TimetableEntryHardConflictCode,
  type TimetableGridData,
  type TimetableGridEntry,
  type TimetableMasterClass,
  type TimetableMasterGridData,
  type TimetableMasterSection,
  type TimetableMasterSubject,
  type TimetableMasterTeacher,
  type TimetableEntryNotice,
  type TimetablePlacement,
  type TimetableSlot,
  type TimetableSubjectOption,
  type TimetableTeacherAvailabilityMatrix,
  type TimetableTeacherAvailabilityOverride,
  type TimetableTeacherConstraints,
  type TimetableTeachingLoad,
} from './lib/timetable'
import { solveTimetable } from './lib/timetableSolver'
import {
  STALE_TIMETABLE_PROPOSAL_CODE,
  STALE_TIMETABLE_PROPOSAL_MESSAGE,
  canonicalTimetableProposalEntries,
  compareTimetableSchedules,
  computeTimetableProposalDigest,
  validateCompleteTimetableSchedule,
  validateRestorableTimetableSchedule,
  type TimetableAdoptionPreview,
  type TimetableProposalPlacement,
  type TimetableRestorePreview,
  type TimetableScheduleVersion,
  type TimetableScheduleVersionDetails,
  type TimetableScheduleVersionEntry,
  type TimetableSolverProposalWithIntegrity,
} from './lib/timetableAdoption'

// ===========================================
// Types & Extended Bindings
// ===========================================

declare global {
  interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch<T = any>(statements: D1PreparedStatement[]): Promise<Array<{ results?: T[]; success: boolean; meta?: any }>>;
  }
  interface D1PreparedStatement {
    bind(...values: any[]): D1PreparedStatement;
    first<T = any>(): Promise<T | null>;
    all<T = any>(): Promise<{ results?: T[]; success: boolean; meta?: any }>;
    run(): Promise<{ success: boolean; meta?: any; results?: any }>;
  }
}

type Bindings = {
  DB: D1Database;
  JWT_SECRET?: string;
  ALLOWED_ORIGINS?: string;
  APP_ENV?: string;
  ASSETS?: { fetch(url: URL): Promise<{ status: number; body: ReadableStream | null }> };
}

interface UserContext {
  id: number;
  email: string;
  full_name: string;
  role_id: number;
  role_key: RoleKey;
  role_name: string;
  school_id: number | null;
  school_name: string | null;
  status: string;
}

interface AuthenticatedUserContext {
  user: UserContext;
  authVersion: number;
}

type Variables = {
  user: UserContext;
  session: JwtPayload;
  resolvedSchoolId: number | null;
  scope: 'all' | 'single';
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ===========================================
// Helper Functions
// ===========================================

async function getCurrentUserContext(db: D1Database, email: string): Promise<AuthenticatedUserContext | null> {
  const row = await db.prepare(`
    SELECT u.id, u.email, u.full_name, u.role_id, u.school_id, u.status, u.auth_version,
           r.key AS role_key, r.name AS role_name,
           s.name AS school_name
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    LEFT JOIN schools s ON u.school_id = s.id
    WHERE u.email = ? AND u.status = 'active'
  `).bind(email).first<{
    id: number;
    email: string;
    full_name: string;
    role_id: number;
    school_id: number | null;
    status: string;
    auth_version: number;
    role_key: string;
    role_name: string;
    school_name: string | null;
  }>();

  if (!row) return null;

  const validRoles: RoleKey[] = ['system_admin', 'school_owner', 'principal', 'vice_principal', 'teacher', 'accountant', 'registrar', 'parent'];
  const role_key = validRoles.includes(row.role_key as RoleKey) ? (row.role_key as RoleKey) : 'teacher';

  return {
    authVersion: row.auth_version,
    user: {
      id: row.id,
      email: row.email,
      full_name: row.full_name,
      role_id: row.role_id,
      role_key,
      role_name: row.role_name || role_key,
      school_id: row.school_id,
      school_name: row.school_name || null,
      status: row.status,
    },
  };
}

function extractBearerToken(c: any): string | null {
  const auth = c.req.header('Authorization');
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function cleanupExpiredAuthState(db: D1Database, nowSeconds: number): Promise<void> {
  await db.prepare('DELETE FROM revoked_sessions WHERE expires_at <= ?').bind(nowSeconds).run();
  await db.prepare('DELETE FROM login_throttles WHERE updated_at <= ?')
    .bind(nowSeconds - Math.max(
      LOGIN_THROTTLE_POLICIES.account.retentionSeconds,
      LOGIN_THROTTLE_POLICIES.ip.retentionSeconds,
    ))
    .run();
}

async function getLoginThrottleRecord(
  db: D1Database,
  subjectHash: string,
): Promise<LoginThrottleRecord | null> {
  return db.prepare(
    'SELECT failed_attempts, window_started_at, locked_until FROM login_throttles WHERE subject_hash = ?',
  ).bind(subjectHash).first<LoginThrottleRecord>();
}

async function saveLoginFailure(
  db: D1Database,
  subjectHash: string,
  bucketType: LoginThrottleBucketType,
  policy: LoginThrottlePolicy,
  nowSeconds: number,
) {
  // The UPSERT reads and increments the current SQLite row in one statement. Concurrent
  // Workers cannot overwrite each other with a count computed from a stale SELECT.
  const record = await db.prepare(`
    INSERT INTO login_throttles (
      subject_hash, bucket_type, failed_attempts, window_started_at, locked_until, updated_at
    ) VALUES (?1, ?2, 1, ?3, NULL, ?3)
    ON CONFLICT(subject_hash) DO UPDATE SET
      bucket_type = excluded.bucket_type,
      failed_attempts = CASE
        WHEN (login_throttles.locked_until IS NOT NULL AND login_throttles.locked_until <= ?3)
          OR (login_throttles.locked_until IS NULL AND login_throttles.window_started_at <= ?3 - ?4)
          THEN 1
        ELSE login_throttles.failed_attempts + 1
      END,
      window_started_at = CASE
        WHEN (login_throttles.locked_until IS NOT NULL AND login_throttles.locked_until <= ?3)
          OR (login_throttles.locked_until IS NULL AND login_throttles.window_started_at <= ?3 - ?4)
          THEN ?3
        ELSE login_throttles.window_started_at
      END,
      locked_until = CASE
        WHEN (login_throttles.locked_until IS NOT NULL AND login_throttles.locked_until <= ?3)
          OR (login_throttles.locked_until IS NULL AND login_throttles.window_started_at <= ?3 - ?4)
          THEN NULL
        WHEN login_throttles.failed_attempts + 1 >= ?5
          THEN MAX(COALESCE(login_throttles.locked_until, 0), ?3 + ?6)
        ELSE login_throttles.locked_until
      END,
      updated_at = ?3
    RETURNING failed_attempts, window_started_at, locked_until
  `).bind(
    subjectHash,
    bucketType,
    nowSeconds,
    policy.windowSeconds,
    policy.maxAttempts,
    policy.lockSeconds,
  ).first<LoginThrottleRecord>();
  if (!record) throw new Error('Login throttle update failed');
  return inspectLoginThrottle(record, nowSeconds, policy);
}

async function clearLoginThrottle(db: D1Database, subjectHash: string): Promise<void> {
  await db.prepare('DELETE FROM login_throttles WHERE subject_hash = ?').bind(subjectHash).run();
}

function rateLimitedResponse(c: any, retryAfter: number) {
  c.header('Retry-After', String(Math.max(1, retryAfter)));
  return c.json({ error: 'محاولات تسجيل دخول كثيرة، حاول مرة أخرى لاحقاً' }, 429);
}

function resolveSchoolScope(user: UserContext | null, querySchoolId: string | null): { schoolId: number | null; scope: 'all' | 'single'; forbidden: boolean } {
  if (!user) {
    if (querySchoolId) {
      const id = parseInt(querySchoolId, 10);
      if (!isNaN(id)) return { schoolId: id, scope: 'single', forbidden: false };
    }
    return { schoolId: null, scope: 'all', forbidden: false };
  }

  if (user.role_key === 'system_admin') {
    if (querySchoolId) {
      const id = parseInt(querySchoolId, 10);
      if (!isNaN(id)) return { schoolId: id, scope: 'single', forbidden: false };
    }
    return { schoolId: null, scope: 'all', forbidden: false };
  }

  if (user.school_id == null) {
    return { schoolId: null, scope: 'all', forbidden: true };
  }

  if (querySchoolId) {
    const requested = parseInt(querySchoolId, 10);
    if (!isNaN(requested) && requested !== user.school_id) {
      return { schoolId: null, scope: 'all', forbidden: true };
    }
  }

  return { schoolId: user.school_id, scope: 'single', forbidden: false };
}

type WriteSchoolResolution =
  | { ok: true; schoolId: number }
  | { ok: false; status: 400 | 403; error: string };

async function resolveActiveWriteSchool(
  db: D1Database,
  user: UserContext | null,
  requestedSchoolId: unknown,
): Promise<WriteSchoolResolution> {
  if (!user) {
    return { ok: false, status: 403, error: 'غير مسموح: المستخدم غير مرتبط بسياق صالح' };
  }

  const numericSchoolId = Number(requestedSchoolId);
  const requested = Number.isInteger(numericSchoolId) && numericSchoolId > 0 ? numericSchoolId : null;
  const resolved = resolveRequiredWriteSchoolId(user.role_key, user.school_id, requested);
  if (!resolved.ok) {
    return {
      ok: false,
      status: resolved.status,
      error: resolved.status === 400
        ? 'يجب تحديد مدرسة مستهدفة صالحة'
        : 'غير مسموح: المدرسة المستهدفة لا تطابق مدرسة المستخدم',
    };
  }

  const school = await db.prepare('SELECT id, status FROM schools WHERE id = ?')
    .bind(resolved.schoolId)
    .first<{ id: number; status: string }>();
  if (!school || school.status !== 'active') {
    return { ok: false, status: 400, error: 'المدرسة المستهدفة غير موجودة أو غير نشطة' };
  }

  return { ok: true, schoolId: resolved.schoolId };
}

function requireAuthEnforced() {
  return async (c: any, next: () => Promise<void>) => {
    const user: UserContext | null = c.get('user') || null;
    if (!user) {
      return c.json({ error: 'غير مسموح: يجب تسجيل الدخول أولاً' }, 401);
    }
    await next();
  };
}

function requireSameSchoolOrAdmin() {
  return async (c: any, next: () => Promise<void>) => {
    const user: UserContext | null = c.get('user') || null;
    if (!user) {
      return c.json({ error: 'غير مسموح: يجب تسجيل الدخول أولاً' }, 401);
    }

    const querySchoolId = c.req.query('school_id');
    const resolved = resolveSchoolScope(user, querySchoolId);

    if (resolved.forbidden) {
      return c.json({ error: 'غير مسموح: لا يمكنك الوصول إلى بيانات هذه المدرسة' }, 403);
    }

    c.set('resolvedSchoolId', resolved.schoolId);
    c.set('scope', resolved.scope);
    await next();
  };
}

function requireAdmin() {
  return async (c: any, next: () => Promise<void>) => {
    const user: UserContext | null = c.get('user') || null;
    if (!user) {
      return c.json({ error: 'غير مسموح: يجب تسجيل الدخول أولاً' }, 401);
    }
    if (user.role_key !== 'system_admin') {
      return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة المدارس' }, 403);
    }
    await next();
  };
}

function requireRoles(allowedRoles: readonly RoleKey[], message = 'غير مسموح: لا تملك الصلاحية المطلوبة') {
  return async (c: any, next: () => Promise<void>) => {
    const user: UserContext | null = c.get('user') || null;
    if (!user) {
      return c.json({ error: 'غير مسموح: يجب تسجيل الدخول أولاً' }, 401);
    }
    if (!hasRole(user.role_key, allowedRoles)) {
      return c.json({ error: message }, 403);
    }
    await next();
  };
}

async function readJsonObject(c: any): Promise<Record<string, any> | null> {
  try {
    const value = await c.req.json()
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

type TimetableReferenceValidation =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404; error: string; code?: TimetableEntryHardConflictCode };

async function validateTimetableAcademicYear(
  db: D1Database,
  schoolId: number,
  academicYearId: number,
): Promise<TimetableReferenceValidation> {
  const year = await db.prepare('SELECT id, school_id FROM academic_years WHERE id = ?')
    .bind(academicYearId).first<{ id: number; school_id: number }>();
  if (!year) return { ok: false, status: 404, error: 'السنة الدراسية غير موجودة', code: 'invalid_academic_year' };
  if (Number(year.school_id) !== schoolId) {
    return { ok: false, status: 403, error: 'غير مسموح: السنة الدراسية لا تنتمي إلى المدرسة المستهدفة', code: 'invalid_tenant_scope' };
  }
  return { ok: true };
}

async function validateTimetableLoadReferences(
  db: D1Database,
  schoolId: number,
  input: {
    academicYearId: number;
    classId: number;
    sectionId: number | null;
    subjectId: number;
    employeeId: number | null;
  },
): Promise<TimetableReferenceValidation> {
  const yearValidation = await validateTimetableAcademicYear(db, schoolId, input.academicYearId);
  if (!yearValidation.ok) return yearValidation;

  const [classRow, sectionRow, subjectRow, employeeRow, sectionCount] = await Promise.all([
    db.prepare('SELECT id, school_id, status FROM classes WHERE id = ?').bind(input.classId)
      .first<{ id: number; school_id: number; status: string }>(),
    input.sectionId == null ? Promise.resolve(null) : db.prepare(
      'SELECT id, school_id, class_id, status FROM sections WHERE id = ?',
    ).bind(input.sectionId).first<{ id: number; school_id: number; class_id: number; status: string }>(),
    db.prepare('SELECT id, school_id, class_id, section_id, status FROM subjects WHERE id = ?')
      .bind(input.subjectId).first<{ id: number; school_id: number; class_id: number; section_id: number | null; status: string }>(),
    input.employeeId == null ? Promise.resolve(null) : db.prepare(
      'SELECT id, school_id, status, role FROM employees WHERE id = ?',
    ).bind(input.employeeId).first<{ id: number; school_id: number; status: string; role: string }>(),
    db.prepare(`
      SELECT COUNT(*) AS count FROM sections
      WHERE school_id = ? AND class_id = ? AND status = 'active'
    `).bind(schoolId, input.classId).first<{ count: number }>(),
  ]);

  if (!classRow) return { ok: false, status: 404, error: 'الصف غير موجود' };
  if (Number(classRow.school_id) !== schoolId) return { ok: false, status: 403, error: 'غير مسموح: الصف من مدرسة أخرى' };
  if (classRow.status !== 'active') return { ok: false, status: 400, error: 'الصف غير نشط' };

  if (input.sectionId != null) {
    if (!sectionRow) return { ok: false, status: 404, error: 'الشعبة غير موجودة' };
    if (Number(sectionRow.school_id) !== schoolId) return { ok: false, status: 403, error: 'غير مسموح: الشعبة من مدرسة أخرى' };
    if (Number(sectionRow.class_id) !== input.classId) return { ok: false, status: 400, error: 'الشعبة لا تتبع الصف المحدد' };
    if (sectionRow.status !== 'active') return { ok: false, status: 400, error: 'الشعبة غير نشطة' };
  } else if (Number(sectionCount?.count || 0) > 0) {
    return { ok: false, status: 400, error: 'يجب تحديد شعبة لأن الصف يحتوي على شعب نشطة' };
  }

  if (!subjectRow) return { ok: false, status: 404, error: 'المادة غير موجودة' };
  if (Number(subjectRow.school_id) !== schoolId) return { ok: false, status: 403, error: 'غير مسموح: المادة من مدرسة أخرى' };
  if (subjectRow.status !== 'active') return { ok: false, status: 400, error: 'المادة غير نشطة' };
  if (Number(subjectRow.class_id) !== input.classId) return { ok: false, status: 400, error: 'المادة لا تتبع الصف المحدد' };
  if (subjectRow.section_id != null && Number(subjectRow.section_id) !== input.sectionId) {
    return { ok: false, status: 400, error: 'المادة مخصصة لشعبة أخرى' };
  }

  if (input.employeeId != null) {
    if (!employeeRow) return { ok: false, status: 404, error: 'الموظف غير موجود' };
    if (Number(employeeRow.school_id) !== schoolId) return { ok: false, status: 403, error: 'غير مسموح: الموظف من مدرسة أخرى' };
    if (employeeRow.status !== 'active') return { ok: false, status: 400, error: 'الموظف غير نشط' };
    if (employeeRow.role !== 'teacher') return { ok: false, status: 400, error: 'الموظف المحدد ليس مدرسًا' };
  }
  return { ok: true };
}

type TimetableTeacherReference = {
  id: number;
  school_id: number;
  full_name: string;
  role: string;
  status: string;
};

function emptyTimetableTeacherConstraints(
  schoolId: number,
  academicYearId: number,
  employeeId: number,
): TimetableTeacherConstraints {
  return {
    id: null,
    school_id: schoolId,
    academic_year_id: academicYearId,
    employee_id: employeeId,
    max_periods_per_day: null,
    max_consecutive_periods: null,
    max_working_days: null,
    prefer_compact_schedule: 0,
    avoid_first_period: 0,
    avoid_last_period: 0,
  }
}

async function validateTimetableTeacherReference(
  db: D1Database,
  schoolId: number,
  employeeId: number,
  requireActive: boolean,
): Promise<TimetableReferenceValidation & { teacher?: TimetableTeacherReference }> {
  const teacher = await db.prepare(`
    SELECT id, school_id, full_name, role, status
    FROM employees WHERE id = ?
  `).bind(employeeId).first<TimetableTeacherReference>()
  if (!teacher) return { ok: false, status: 404, error: 'المدرس غير موجود' }
  if (Number(teacher.school_id) !== schoolId) {
    return { ok: false, status: 403, error: 'غير مسموح: المدرس من مدرسة أخرى' }
  }
  if (teacher.role !== 'teacher') return { ok: false, status: 400, error: 'الموظف المحدد ليس مدرسًا' }
  if (requireActive && teacher.status !== 'active') return { ok: false, status: 400, error: 'المدرس غير نشط' }
  return { ok: true, teacher }
}

async function validateTimetableAvailabilitySlot(
  db: D1Database,
  schoolId: number,
  academicYearId: number,
  slotId: number,
): Promise<TimetableReferenceValidation & { slot?: TimetableSlot }> {
  const slot = await db.prepare('SELECT * FROM timetable_slots WHERE id = ?')
    .bind(slotId).first<TimetableSlot>()
  if (!slot) return { ok: false, status: 404, error: 'فترة الجدول غير موجودة' }
  if (Number(slot.school_id) !== schoolId) {
    return { ok: false, status: 403, error: 'غير مسموح: الفترة من مدرسة أخرى' }
  }
  if (Number(slot.academic_year_id) !== academicYearId) {
    return { ok: false, status: 400, error: 'الفترة لا تنتمي إلى السنة الدراسية المحددة' }
  }
  if (slot.slot_type !== 'lesson') return { ok: false, status: 400, error: 'لا يمكن ضبط توفر المدرس لفترة استراحة' }
  return { ok: true, slot }
}

async function loadTeacherAvailabilityMatrix(
  db: D1Database,
  schoolId: number,
  academicYearId: number,
  teacher: TimetableTeacherReference,
): Promise<TimetableTeacherAvailabilityMatrix> {
  const [daysResult, slotsResult, overridesResult, constraints, assignedLoad] = await Promise.all([
    db.prepare(`
      SELECT * FROM timetable_days
      WHERE school_id = ? AND academic_year_id = ?
      ORDER BY order_index, day_of_week
    `).bind(schoolId, academicYearId).all<TimetableDay>(),
    db.prepare(`
      SELECT * FROM timetable_slots
      WHERE school_id = ? AND academic_year_id = ?
      ORDER BY day_of_week, slot_index
    `).bind(schoolId, academicYearId).all<TimetableSlot>(),
    db.prepare(`
      SELECT * FROM timetable_teacher_availability
      WHERE school_id = ? AND academic_year_id = ? AND employee_id = ?
      ORDER BY slot_id
    `).bind(schoolId, academicYearId, teacher.id).all<TimetableTeacherAvailabilityOverride>(),
    db.prepare(`
      SELECT * FROM timetable_teacher_constraints
      WHERE school_id = ? AND academic_year_id = ? AND employee_id = ?
    `).bind(schoolId, academicYearId, teacher.id).first<TimetableTeacherConstraints>(),
    db.prepare(`
      SELECT COALESCE(SUM(weekly_periods), 0) AS assigned_weekly_periods
      FROM timetable_teaching_loads
      WHERE school_id = ? AND academic_year_id = ? AND employee_id = ? AND status = 'active'
    `).bind(schoolId, academicYearId, teacher.id).first<{ assigned_weekly_periods: number }>(),
  ])
  return buildTeacherAvailabilityMatrix({
    schoolId,
    academicYearId,
    teacher,
    days: daysResult.results || [],
    slots: slotsResult.results || [],
    overrides: overridesResult.results || [],
    constraints,
    assignedWeeklyPeriods: Number(assignedLoad?.assigned_weekly_periods || 0),
  })
}

type TimetableSchedulingContext = {
  days: TimetableDay[];
  slots: TimetableSlot[];
  loads: TimetableTeachingLoad[];
  entries: TimetableEntry[];
  availability: TimetableTeacherAvailabilityOverride[];
  constraints: TimetableTeacherConstraints[];
};

async function loadTimetableSchedulingContext(
  db: D1Database,
  schoolId: number,
  academicYearId: number,
): Promise<TimetableSchedulingContext> {
  const [daysResult, slotsResult, loadsResult, entriesResult, availabilityResult, constraintsResult] = await Promise.all([
    db.prepare(`
      SELECT * FROM timetable_days
      WHERE school_id = ? AND academic_year_id = ?
      ORDER BY order_index, day_of_week
    `).bind(schoolId, academicYearId).all<TimetableDay>(),
    db.prepare(`
      SELECT * FROM timetable_slots
      WHERE school_id = ? AND academic_year_id = ?
      ORDER BY day_of_week, start_time, slot_index, id
    `).bind(schoolId, academicYearId).all<TimetableSlot>(),
    db.prepare(`
      SELECT load.*,
             class.name AS class_name, class.status AS class_status, class.school_id AS class_school_id,
             COALESCE(class_sections.active_section_count, 0) AS active_section_count,
             section.name AS section_name, section.status AS section_status,
             section.school_id AS section_school_id, section.class_id AS section_class_id,
             subject.name AS subject_name, subject.status AS subject_status, subject.school_id AS subject_school_id,
             subject.class_id AS subject_class_id, subject.section_id AS subject_section_id,
             employee.full_name AS employee_name, employee.status AS employee_status,
             employee.school_id AS employee_school_id, employee.role AS employee_role
      FROM timetable_teaching_loads load
      LEFT JOIN classes class ON class.id = load.class_id AND class.school_id = load.school_id
      LEFT JOIN (
        SELECT school_id, class_id, COUNT(*) AS active_section_count
        FROM sections WHERE status = 'active'
        GROUP BY school_id, class_id
      ) class_sections ON class_sections.school_id = load.school_id AND class_sections.class_id = load.class_id
      LEFT JOIN sections section ON section.id = load.section_id AND section.school_id = load.school_id
      LEFT JOIN subjects subject ON subject.id = load.subject_id AND subject.school_id = load.school_id
      LEFT JOIN employees employee ON employee.id = load.employee_id AND employee.school_id = load.school_id
      WHERE load.school_id = ? AND load.academic_year_id = ?
      ORDER BY load.class_id, load.section_id, load.subject_id, load.id
    `).bind(schoolId, academicYearId).all<TimetableTeachingLoad>(),
    db.prepare(`
      SELECT * FROM timetable_entries
      WHERE school_id = ? AND academic_year_id = ?
      ORDER BY slot_id, id
    `).bind(schoolId, academicYearId).all<TimetableEntry>(),
    db.prepare(`
      SELECT * FROM timetable_teacher_availability
      WHERE school_id = ? AND academic_year_id = ?
      ORDER BY employee_id, slot_id
    `).bind(schoolId, academicYearId).all<TimetableTeacherAvailabilityOverride>(),
    db.prepare(`
      SELECT * FROM timetable_teacher_constraints
      WHERE school_id = ? AND academic_year_id = ?
      ORDER BY employee_id
    `).bind(schoolId, academicYearId).all<TimetableTeacherConstraints>(),
  ]);
  return {
    days: daysResult.results || [],
    slots: slotsResult.results || [],
    loads: loadsResult.results || [],
    entries: entriesResult.results || [],
    availability: availabilityResult.results || [],
    constraints: constraintsResult.results || [],
  };
}

type TimetableProposalPayloadValidation =
  | { ok: true; revision: number; digest: string; entries: TimetableProposalPlacement[] }
  | { ok: false; error: string };

function hasOnlyObjectKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function parseTimetableProposalEntries(value: unknown):
  | { ok: true; entries: TimetableProposalPlacement[] }
  | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length > 2_000) {
    return { ok: false, error: 'قائمة حصص المقترح غير صالحة' };
  }
  const entries: TimetableProposalPlacement[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: 'إحدى حصص المقترح غير صالحة' };
    }
    const record = raw as Record<string, unknown>;
    if (!hasOnlyObjectKeys(record, ['slot_id', 'teaching_load_id', 'is_locked'])) {
      return { ok: false, error: 'يحتوي المقترح على حقول غير معروفة' };
    }
    const slotId = Number(record.slot_id);
    const teachingLoadId = Number(record.teaching_load_id);
    const isLocked = Number(record.is_locked);
    if (!Number.isInteger(slotId) || slotId <= 0
      || !Number.isInteger(teachingLoadId) || teachingLoadId <= 0
      || ![0, 1].includes(isLocked)) {
      return { ok: false, error: 'إحدى حصص المقترح تحتوي على قيم غير صالحة' };
    }
    entries.push({ slot_id: slotId, teaching_load_id: teachingLoadId, is_locked: isLocked as 0 | 1 });
  }
  return { ok: true, entries: canonicalTimetableProposalEntries(entries) };
}

function parseTimetableFixedEntries(value: unknown):
  | { ok: true; entries: Array<{ slot_id: number; teaching_load_id: number }> }
  | { ok: false; error: string } {
  if (value == null) return { ok: true, entries: [] };
  if (!Array.isArray(value) || value.length > 2_000) return { ok: false, error: 'قائمة الحصص المثبتة غير صالحة' };
  const entries: Array<{ slot_id: number; teaching_load_id: number }> = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'إحدى الحصص المثبتة غير صالحة' };
    const record = raw as Record<string, unknown>;
    if (!hasOnlyObjectKeys(record, ['slot_id', 'teaching_load_id'])) {
      return { ok: false, error: 'تحتوي الحصص المثبتة على حقول غير معروفة' };
    }
    const slotId = Number(record.slot_id);
    const teachingLoadId = Number(record.teaching_load_id);
    if (!Number.isInteger(slotId) || slotId <= 0 || !Number.isInteger(teachingLoadId) || teachingLoadId <= 0) {
      return { ok: false, error: 'إحدى الحصص المثبتة تحتوي على قيم غير صالحة' };
    }
    entries.push({ slot_id: slotId, teaching_load_id: teachingLoadId });
  }
  return { ok: true, entries };
}

function parseTimetableProposalPayload(
  body: Record<string, unknown>,
  revisionField: 'proposal_revision' | 'expected_revision',
): TimetableProposalPayloadValidation {
  const revision = Number(body[revisionField]);
  const digest = typeof body.proposal_digest === 'string' ? body.proposal_digest.trim().toLowerCase() : '';
  if (!Number.isInteger(revision) || revision < 0) return { ok: false, error: 'نسخة بيانات الجدول غير صالحة' };
  if (!/^[a-f0-9]{64}$/.test(digest)) return { ok: false, error: 'بصمة المقترح غير صالحة' };
  const parsedEntries = parseTimetableProposalEntries(body.entries);
  if (!parsedEntries.ok) return parsedEntries;
  return { ok: true, revision, digest, entries: parsedEntries.entries };
}

async function loadCurrentTimetableRevision(db: D1Database, schoolId: number, academicYearId: number): Promise<number> {
  const row = await db.prepare(`
    SELECT revision FROM timetable_revisions
    WHERE school_id = ? AND academic_year_id = ?
  `).bind(schoolId, academicYearId).first<{ revision: number }>();
  return Number(row?.revision || 0);
}

function countInvalidCurrentTimetableEntries(context: TimetableSchedulingContext): number {
  return context.entries.filter((entry) => {
    const evaluation = evaluateTimetableEntryPlacement({
      candidate: entry,
      days: context.days,
      slots: context.slots,
      loads: context.loads,
      entries: context.entries,
      teacherAvailability: context.availability,
      teacherConstraints: context.constraints,
    });
    return evaluation.hard_conflicts.length > 0;
  }).length;
}

function currentLockedEntriesArePreserved(
  currentEntries: TimetableEntry[],
  proposedEntries: TimetableProposalPlacement[],
) {
  const proposed = new Set(proposedEntries
    .filter((entry) => entry.is_locked === 1)
    .map((entry) => `${entry.slot_id}:${entry.teaching_load_id}`));
  return currentEntries
    .filter((entry) => Number(entry.is_locked) === 1)
    .filter((entry) => !proposed.has(`${Number(entry.slot_id)}:${Number(entry.teaching_load_id)}`))
    .map((entry) => ({
      code: 'locked_entry_not_preserved',
      message: 'يجب أن تبقى الحصة الرسمية المثبتة في موضعها عند إعادة التوليد.',
      slot_id: Number(entry.slot_id),
      teaching_load_id: Number(entry.teaching_load_id),
    }));
}

async function buildTimetableAdoptionPreview(input: {
  schoolId: number;
  academicYearId: number;
  revision: number;
  digest: string;
  entries: TimetableProposalPlacement[];
  context: TimetableSchedulingContext;
  options:
    | { validationMode: 'complete'; preserveCurrentLocks: true }
    | { validationMode: 'restore'; preserveCurrentLocks: false };
}): Promise<TimetableAdoptionPreview> {
  const recomputedDigest = await computeTimetableProposalDigest({
    schoolId: input.schoolId,
    academicYearId: input.academicYearId,
    revision: input.revision,
    entries: input.entries,
  });
  const validationContext = {
    schoolId: input.schoolId,
    academicYearId: input.academicYearId,
    days: input.context.days,
    slots: input.context.slots,
    loads: input.context.loads,
    availability: input.context.availability,
    constraints: input.context.constraints,
  };
  const validation = input.options.validationMode === 'complete'
    ? (() => {
      const result = validateCompleteTimetableSchedule(validationContext, input.entries);
      return { allowsApply: result.complete, blockers: result.blockers, weeklyDemand: result.weekly_demand };
    })()
    : (() => {
      const result = validateRestorableTimetableSchedule(validationContext, input.entries);
      return { allowsApply: result.structurally_valid, blockers: result.blockers, weeklyDemand: result.weekly_demand };
    })();
  const currentInvalidEntryCount = countInvalidCurrentTimetableEntries(input.context);
  const warnings = [
    ...(currentInvalidEntryCount > 0
      ? ['سيتم حفظ السجلات الحالية غير الصالحة أو التاريخية كاملة في إصدار سابق قبل الاستبدال.']
      : []),
    ...(input.options.validationMode === 'restore' && !validation.weeklyDemand.current_demand_complete
      ? ['هذا الإصدار لا يغطي جميع الأنصبة الأسبوعية الحالية.']
      : []),
  ];
  const blockers = [
    ...(recomputedDigest === input.digest ? [] : [{ code: 'proposal_digest_mismatch', message: 'بصمة المقترح لا تطابق محتواه الحالي.' }]),
    ...validation.blockers,
    ...(input.options.preserveCurrentLocks
      ? currentLockedEntriesArePreserved(input.context.entries, input.entries)
      : []),
  ];
  return {
    can_apply: blockers.length === 0 && validation.allowsApply,
    comparison: compareTimetableSchedules(input.context.entries, input.entries),
    current_entry_count: input.context.entries.length,
    proposed_entry_count: input.entries.length,
    locked_count: input.entries.filter((entry) => entry.is_locked === 1).length,
    current_invalid_entry_count: currentInvalidEntryCount,
    revision: input.revision,
    proposal_digest: recomputedDigest,
    weekly_demand: validation.weeklyDemand,
    warnings,
    blockers,
  };
}

async function loadTimetableScheduleVersion(
  db: D1Database,
  versionId: number,
): Promise<TimetableScheduleVersionDetails | null> {
  const version = await db.prepare(`
    SELECT version.*, user.full_name AS created_by_name
    FROM timetable_schedule_versions version
    LEFT JOIN users user ON user.id = version.created_by_user_id
    WHERE version.id = ?
  `).bind(versionId).first<TimetableScheduleVersion>();
  if (!version) return null;
  const { results } = await db.prepare(`
    SELECT * FROM timetable_schedule_version_entries
    WHERE version_id = ?
    ORDER BY teaching_load_id, slot_id, id
  `).bind(versionId).all<TimetableScheduleVersionEntry>();
  return { ...version, entries: results || [] };
}

async function replaceOfficialTimetableAtomically(input: {
  db: D1Database;
  schoolId: number;
  academicYearId: number;
  expectedRevision: number;
  digest: string;
  entries: TimetableProposalPlacement[];
  userId: number;
  source: 'automatic_adoption' | 'manual_restore';
  restoredFromVersionId?: number | null;
}) {
  const assertionToken = crypto.randomUUID();
  const versionKey = crypto.randomUUID();
  const unlockTokenPrefix = crypto.randomUUID();
  const canonicalEntries = canonicalTimetableProposalEntries(input.entries);
  const entriesJson = JSON.stringify(canonicalEntries);
  const statements = [
    input.db.prepare(`
      INSERT INTO timetable_revision_assertions (token, school_id, academic_year_id, expected_revision)
      VALUES (?, ?, ?, ?)
    `).bind(assertionToken, input.schoolId, input.academicYearId, input.expectedRevision),
    input.db.prepare(`
      INSERT INTO timetable_schedule_versions (
        version_key, school_id, academic_year_id, source, previous_revision,
        created_by_user_id, restored_from_version_id, old_entry_count,
        new_entry_count, locked_entry_count, proposal_digest
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, COUNT(*), ?, ?, ?
      FROM timetable_entries
      WHERE school_id = ? AND academic_year_id = ?
    `).bind(
      versionKey,
      input.schoolId,
      input.academicYearId,
      input.source,
      input.expectedRevision,
      input.userId,
      input.restoredFromVersionId ?? null,
      canonicalEntries.length,
      canonicalEntries.filter((entry) => entry.is_locked === 1).length,
      input.digest,
      input.schoolId,
      input.academicYearId,
    ),
    input.db.prepare(`
      INSERT INTO timetable_schedule_version_entries (
        version_id, original_entry_id, school_id, academic_year_id,
        slot_id, teaching_load_id, is_locked
      )
      SELECT version.id, entry.id, entry.school_id, entry.academic_year_id,
             entry.slot_id, entry.teaching_load_id, entry.is_locked
      FROM timetable_entries entry
      JOIN timetable_schedule_versions version ON version.version_key = ?
      WHERE entry.school_id = ? AND entry.academic_year_id = ?
      ORDER BY entry.teaching_load_id, entry.slot_id, entry.id
    `).bind(versionKey, input.schoolId, input.academicYearId),
    input.db.prepare(`
      INSERT INTO timetable_locked_entry_overrides (
        token, entry_id, school_id, academic_year_id, action
      )
      SELECT ? || ':' || CAST(entry.id AS TEXT), entry.id,
             entry.school_id, entry.academic_year_id, 'delete'
      FROM timetable_entries entry
      WHERE entry.school_id = ? AND entry.academic_year_id = ? AND entry.is_locked = 1
    `).bind(unlockTokenPrefix, input.schoolId, input.academicYearId),
    input.db.prepare(`
      DELETE FROM timetable_entries
      WHERE school_id = ? AND academic_year_id = ?
    `).bind(input.schoolId, input.academicYearId),
    input.db.prepare(`
      INSERT INTO timetable_entries (
        school_id, academic_year_id, slot_id, teaching_load_id, is_locked,
        created_by_user_id, updated_by_user_id
      )
      SELECT ?, ?,
             CAST(json_extract(value, '$.slot_id') AS INTEGER),
             CAST(json_extract(value, '$.teaching_load_id') AS INTEGER),
             CAST(json_extract(value, '$.is_locked') AS INTEGER),
             ?, ?
      FROM json_each(?)
      ORDER BY CAST(json_extract(value, '$.teaching_load_id') AS INTEGER),
               CAST(json_extract(value, '$.slot_id') AS INTEGER)
    `).bind(input.schoolId, input.academicYearId, input.userId, input.userId, entriesJson),
    input.db.prepare(`
      INSERT INTO timetable_revisions (school_id, academic_year_id, revision, updated_at)
      VALUES (?, ?, 1, unixepoch())
      ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
        revision = revision + 1, updated_at = unixepoch()
    `).bind(input.schoolId, input.academicYearId),
    input.db.prepare('DELETE FROM timetable_revision_assertions WHERE token = ?').bind(assertionToken),
  ];
  await input.db.batch(statements);
  const [version, revision] = await Promise.all([
    input.db.prepare(`
      SELECT version.*, user.full_name AS created_by_name
      FROM timetable_schedule_versions version
      LEFT JOIN users user ON user.id = version.created_by_user_id
      WHERE version.version_key = ?
    `).bind(versionKey).first<TimetableScheduleVersion>(),
    loadCurrentTimetableRevision(input.db, input.schoolId, input.academicYearId),
  ]);
  return { version, revision };
}

async function validateTimetableGridReferences(
  db: D1Database,
  schoolId: number,
  classId: number,
  sectionId: number | null,
): Promise<TimetableReferenceValidation> {
  const [classRow, sectionRow, activeSectionCount] = await Promise.all([
    db.prepare('SELECT id, school_id, status FROM classes WHERE id = ?').bind(classId)
      .first<{ id: number; school_id: number; status: string }>(),
    sectionId == null ? Promise.resolve(null) : db.prepare(
      'SELECT id, school_id, class_id, status FROM sections WHERE id = ?',
    ).bind(sectionId).first<{ id: number; school_id: number; class_id: number; status: string }>(),
    db.prepare(`
      SELECT COUNT(*) AS count FROM sections
      WHERE school_id = ? AND class_id = ? AND status = 'active'
    `).bind(schoolId, classId).first<{ count: number }>(),
  ]);
  if (!classRow) return { ok: false, status: 404, error: 'الصف غير موجود' };
  if (Number(classRow.school_id) !== schoolId) return { ok: false, status: 403, error: 'غير مسموح: الصف من مدرسة أخرى', code: 'invalid_tenant_scope' };
  if (classRow.status !== 'active') return { ok: false, status: 400, error: 'الصف غير نشط' };
  if (sectionId != null) {
    if (!sectionRow) return { ok: false, status: 404, error: 'الشعبة غير موجودة' };
    if (Number(sectionRow.school_id) !== schoolId) return { ok: false, status: 403, error: 'غير مسموح: الشعبة من مدرسة أخرى', code: 'invalid_tenant_scope' };
    if (Number(sectionRow.class_id) !== classId) return { ok: false, status: 400, error: 'الشعبة لا تتبع الصف المحدد' };
    if (sectionRow.status !== 'active') return { ok: false, status: 400, error: 'الشعبة غير نشطة' };
  } else if (Number(activeSectionCount?.count || 0) > 0) {
    return { ok: false, status: 400, error: 'يجب تحديد شعبة لعرض جدول هذا الصف' };
  }
  return { ok: true };
}

async function validateTimetableEntryReferences(
  db: D1Database,
  context: TimetableSchedulingContext,
  schoolId: number,
  academicYearId: number,
  slotId: number,
  teachingLoadId: number,
): Promise<TimetableReferenceValidation> {
  let slot = context.slots.find((item) => Number(item.id) === slotId);
  if (!slot) {
    slot = await db.prepare('SELECT * FROM timetable_slots WHERE id = ?').bind(slotId).first<TimetableSlot>() || undefined;
    if (!slot) return { ok: false, status: 404, error: 'فترة الجدول غير موجودة', code: 'slot_not_schedulable' };
  }
  if (Number(slot.school_id) !== schoolId) return { ok: false, status: 403, error: 'غير مسموح: الفترة من مدرسة أخرى', code: 'invalid_tenant_scope' };
  if (Number(slot.academic_year_id) !== academicYearId) return { ok: false, status: 400, error: 'الفترة لا تنتمي إلى السنة الدراسية المحددة', code: 'invalid_academic_year' };

  let load = context.loads.find((item) => Number(item.id) === teachingLoadId);
  if (!load) {
    load = await db.prepare('SELECT * FROM timetable_teaching_loads WHERE id = ?')
      .bind(teachingLoadId).first<TimetableTeachingLoad>() || undefined;
    if (!load) return { ok: false, status: 404, error: 'نصاب المادة غير موجود', code: 'invalid_teaching_load' };
  }
  if (Number(load.school_id) !== schoolId) return { ok: false, status: 403, error: 'غير مسموح: النصاب من مدرسة أخرى', code: 'invalid_tenant_scope' };
  if (Number(load.academic_year_id) !== academicYearId) return { ok: false, status: 400, error: 'النصاب لا ينتمي إلى السنة الدراسية المحددة', code: 'invalid_academic_year' };
  return { ok: true };
}

function timetableGridEntry(
  entry: TimetableEntry,
  load: TimetableTeachingLoad,
  warnings: TimetableEntryNotice[] = [],
  hardConflicts: TimetableEntryNotice[] = [],
): TimetableGridEntry {
  return {
    ...entry,
    subject_id: Number(load.subject_id),
    subject_name: load.subject_name || 'مادة غير معروفة',
    class_id: Number(load.class_id),
    class_name: load.class_name || 'صف غير معروف',
    section_id: load.section_id == null ? null : Number(load.section_id),
    section_name: load.section_name || null,
    employee_id: load.employee_id == null ? null : Number(load.employee_id),
    employee_name: load.employee_name || null,
    weekly_periods: Number(load.weekly_periods),
    load_status: load.status,
    hard_conflicts: hardConflicts,
    warnings,
  };
}

const TIMETABLE_ENTRY_CONSTRAINT_ERRORS: Array<{
  pattern: RegExp;
  status: 400 | 403 | 409;
  code: TimetableEntryHardConflictCode;
  error: string;
}> = [
  { pattern: /academic year school mismatch|academic year mismatch/, status: 400, code: 'invalid_academic_year', error: 'السنة الدراسية لا تطابق نطاق الحصة' },
  { pattern: /tenant scope mismatch/, status: 403, code: 'invalid_tenant_scope', error: 'غير مسموح: مراجع الحصة من مدرسة أخرى' },
  { pattern: /day inactive/, status: 400, code: 'inactive_day', error: 'اليوم المحدد غير فعال ولا يقبل حصصًا جديدة' },
  { pattern: /slot inactive/, status: 400, code: 'inactive_slot', error: 'الفترة المحددة غير فعالة ولا تقبل حصصًا جديدة' },
  { pattern: /slot not schedulable/, status: 400, code: 'slot_not_schedulable', error: 'الفترة المحددة ليست حصة فعالة قابلة للجدولة' },
  { pattern: /teaching load not schedulable/, status: 400, code: 'invalid_teaching_load', error: 'نصاب المادة غير فعال أو يحتوي على مرجع غير صالح' },
  { pattern: /weekly periods exceeded/, status: 409, code: 'weekly_periods_exceeded', error: 'اكتمل عدد الحصص الأسبوعية المطلوبة لهذا النصاب' },
  { pattern: /group collision/, status: 409, code: 'class_section_collision', error: 'توجد حصة أخرى للصف أو الشعبة في هذه الفترة' },
  { pattern: /teacher collision/, status: 409, code: 'teacher_collision', error: 'المدرس مرتبط بحصة أخرى في الفترة نفسها' },
  { pattern: /teacher unavailable/, status: 409, code: 'teacher_unavailable', error: 'المدرس غير متاح في هذه الفترة' },
  { pattern: /max periods per day/, status: 409, code: 'teacher_max_periods_per_day', error: 'تجاوز المدرس الحد الأقصى للحصص اليومية' },
  { pattern: /max working days/, status: 409, code: 'teacher_max_working_days', error: 'تجاوز المدرس الحد الأقصى لأيام العمل الأسبوعية' },
  { pattern: /max consecutive periods/, status: 409, code: 'teacher_max_consecutive_periods', error: 'تجاوز المدرس الحد الأقصى للحصص المتتالية' },
];

function timetableEntryConstraintError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return TIMETABLE_ENTRY_CONSTRAINT_ERRORS.find((item) => item.pattern.test(message)) || null;
}

function timetableEntryNoticeStatus(notice: TimetableEntryNotice): 400 | 403 | 409 {
  if (notice.code === 'invalid_tenant_scope') return 403;
  return [
    'slot_not_schedulable',
    'inactive_day',
    'inactive_slot',
    'invalid_teaching_load',
    'invalid_academic_year',
  ].includes(notice.code) ? 400 : 409;
}

async function loadTimetableReadinessSummary(db: D1Database, schoolId: number, academicYearId: number) {
  const [context, placementsResult, subjectsResult] = await Promise.all([
    loadTimetableSchedulingContext(db, schoolId, academicYearId),
    db.prepare(`
      SELECT c.id AS class_id, c.name AS class_name,
             s.id AS section_id, s.name AS section_name
      FROM classes c
      LEFT JOIN sections s
        ON s.school_id = c.school_id AND s.class_id = c.id AND s.status = 'active'
      WHERE c.school_id = ? AND c.status = 'active'
      ORDER BY c.order_index, c.id, s.id
    `).bind(schoolId).all<TimetablePlacement>(),
    db.prepare(`
      SELECT id, class_id, section_id, name, status
      FROM subjects
      WHERE school_id = ? AND status = 'active'
      ORDER BY class_id, order_index, id
    `).bind(schoolId).all<TimetableSubjectOption>(),
  ]);

  return buildTimetableReadiness({
    days: context.days,
    slots: context.slots,
    placements: placementsResult.results || [],
    subjects: subjectsResult.results || [],
    loads: context.loads,
    entries: context.entries,
    teacherAvailability: context.availability,
    teacherConstraints: context.constraints,
  });
}

// ===========================================
// Middleware: explicit CORS + authenticated-by-default API
// ===========================================

function applyCorsResponseHeaders(c: any, origin: string): void {
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Vary', 'Origin');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  c.header('Access-Control-Max-Age', '86400');
}

app.use('/api/*', async (c, next) => {
  const requestOrigin = c.req.header('Origin');
  const allowedOrigins = getAllowedCorsOrigins(c.env.ALLOWED_ORIGINS, c.env.APP_ENV);
  const originAllowed = isCorsOriginAllowed(requestOrigin, c.req.url, allowedOrigins);

  if (requestOrigin && !originAllowed) {
    return c.json({ error: 'مصدر الطلب غير مسموح' }, 403);
  }
  if (requestOrigin) applyCorsResponseHeaders(c, requestOrigin);
  if (c.req.method === 'OPTIONS') return c.body(null, 204);

  await next();
});

app.use('/api/*', async (c, next) => {
  if (isPublicApiRequest(c.req.method, c.req.path)) {
    await next();
    return;
  }

  const token = extractBearerToken(c);
  if (!token) {
    return c.json({ error: 'غير مسموح: يجب تسجيل الدخول أولاً' }, 401);
  }

  try {
    const secret = getValidatedJwtSecret(c.env.JWT_SECRET);
    const payload = await verifyJWT(token, secret);
    if (!payload) {
      return c.json({ error: 'غير مصرح: رمز غير صالح أو منتهي الصلاحية' }, 401);
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const revoked = await c.env.DB.prepare(
      'SELECT jti FROM revoked_sessions WHERE jti = ? AND expires_at > ?',
    ).bind(payload.jti, nowSeconds).first<{ jti: string }>();
    if (revoked) {
      return c.json({ error: 'غير مصرح: انتهت الجلسة' }, 401);
    }

    const authenticated = await getCurrentUserContext(c.env.DB, payload.email);
    if (!authenticated) {
      return c.json({ error: 'غير مصرح: المستخدم غير موجود أو غير نشط' }, 401);
    }
    if (payload.auth_version !== authenticated.authVersion) {
      return c.json({ error: 'غير مصرح: انتهت الجلسة' }, 401);
    }

    c.set('user', authenticated.user);
    c.set('session', payload);
    await next();
  } catch {
    return c.json({ error: 'خدمة المصادقة غير متاحة' }, 503);
  }
});

// ===========================================
// API ROUTES: Authentication
// ===========================================

app.post('/api/auth/login', async (c) => {
  const db = c.env.DB;
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'طلب تسجيل الدخول غير صالح' }, 400);
  }

  const email = typeof body?.email === 'string' ? normalizeLoginEmail(body.email) : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || !password || email.length > 320 || password.length > 1024) {
    return c.json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبة' }, 400);
  }

  let secret: string;
  try {
    secret = getValidatedJwtSecret(c.env.JWT_SECRET);
  } catch {
    return c.json({ error: 'خدمة المصادقة غير متاحة' }, 503);
  }

  try {
    const nowSeconds = Math.floor(Date.now() / 1000);
    await cleanupExpiredAuthState(db, nowSeconds);
    const clientIp = getClientIp(c.req.raw.headers);
    const throttleBuckets = await Promise.all(([
      { bucketType: 'account', subject: email, policy: LOGIN_THROTTLE_POLICIES.account },
      { bucketType: 'ip', subject: clientIp, policy: LOGIN_THROTTLE_POLICIES.ip },
    ] as const).map(async bucket => ({
      ...bucket,
      subjectHash: await createLoginThrottleKey(bucket.bucketType, bucket.subject),
    })));
    let limitedRetryAfter = 0;
    for (const bucket of throttleBuckets) {
      const record = await getLoginThrottleRecord(db, bucket.subjectHash);
      const state = inspectLoginThrottle(record, nowSeconds, bucket.policy);
      if (state.limited) limitedRetryAfter = Math.max(limitedRetryAfter, state.retryAfter);
    }
    if (limitedRetryAfter > 0) {
      return rateLimitedResponse(c, limitedRetryAfter);
    }

    const row = await db.prepare(
      'SELECT u.id, u.email, u.full_name, u.role_id, u.school_id, u.password_hash, u.status, u.auth_version, '
      + 'r.key AS role_key, r.name AS role_name '
      + 'FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE LOWER(u.email) = ?',
    ).bind(email).first<{
      id: number;
      email: string;
      full_name: string;
      role_id: number;
      school_id: number | null;
      password_hash: string | null;
      status: string;
      auth_version: number;
      role_key: string;
      role_name: string;
    }>();

    let passwordValid = false;
    let passwordNeedsUpgrade = false;
    let passwordScheme: 'pbkdf2_sha256' | 'legacy_sha256' | 'unknown' = 'unknown';
    if (row) {
      const verification = await verifyPassword(password, row.password_hash, row.email);
      passwordValid = verification.valid;
      passwordNeedsUpgrade = verification.needsUpgrade;
      passwordScheme = verification.scheme;
      if ((!verification.valid || row.status !== 'active') && verification.scheme !== 'pbkdf2_sha256') {
        await hashPassword(password);
      }
    } else {
      await hashPassword(password);
    }

    if (!row || row.status !== 'active' || !passwordValid) {
      let failureRetryAfter = 0;
      for (const bucket of throttleBuckets) {
        const failure = await saveLoginFailure(
          db,
          bucket.subjectHash,
          bucket.bucketType,
          bucket.policy,
          nowSeconds,
        );
        if (failure.limited) failureRetryAfter = Math.max(failureRetryAfter, failure.retryAfter);
      }
      if (failureRetryAfter > 0) return rateLimitedResponse(c, failureRetryAfter);
      return c.json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' }, 401);
    }

    // A successful login clears only this account's bucket. The IP bucket remains so
    // one valid login cannot erase abuse history for a shared or attacking address.
    await clearLoginThrottle(db, throttleBuckets[0].subjectHash);
    if (passwordNeedsUpgrade || passwordScheme === 'legacy_sha256') {
      const upgradedHash = await hashPassword(password);
      await db.prepare(
        'UPDATE users SET password_hash = ?, updated_at = unixepoch() WHERE id = ? AND password_hash = ?',
      ).bind(upgradedHash, row.id, row.password_hash).run();
    }

    const token = await signJWT(
      {
        id: row.id,
        email: row.email,
        role_key: row.role_key,
        school_id: row.school_id,
        auth_version: row.auth_version,
      },
      secret,
      { expiresInSeconds: JWT_SESSION_TTL_SECONDS },
    );

    return c.json({
      data: {
        token,
        user: {
          id: row.id,
          full_name: row.full_name,
          email: row.email,
          role_id: row.role_id,
          role_key: row.role_key,
          role_name: row.role_name,
          school_id: row.school_id,
        },
      },
    });
  } catch (error) {
    console.error('[auth/login] unexpected failure', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    });
    return c.json({ error: 'فشل في تسجيل الدخول' }, 500);
  }
});

app.get('/api/auth/me', async (c) => {
  const user: UserContext | null = c.get('user') || null
  if (!user) {
    return c.json({ error: 'غير مصرح' }, 401)
  }
  return c.json({ data: user })
})

app.post('/api/auth/logout', async (c) => {
  const user: UserContext | null = c.get('user') || null;
  const session: JwtPayload | null = c.get('session') || null;
  if (!user || !session) {
    return c.json({ error: 'غير مسموح: يجب تسجيل الدخول أولاً' }, 401);
  }

  try {
    const nowSeconds = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare('DELETE FROM revoked_sessions WHERE expires_at <= ?').bind(nowSeconds).run();
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO revoked_sessions (jti, user_id, expires_at, revoked_at) VALUES (?, ?, ?, ?)',
    ).bind(session.jti, user.id, session.exp, nowSeconds).run();
    return c.json({ data: { success: true } });
  } catch {
    return c.json({ error: 'فشل في تسجيل الخروج' }, 500);
  }
});

// ===========================================
// Generic scoped-list helper
// ===========================================
function applySchoolFilter(query: string, resolvedSchoolId: number | null, scope: 'all' | 'single', tableAlias: string = 't'): { sql: string; hasWhere: boolean } {
  if (scope === 'single' && resolvedSchoolId != null) {
    const hasWhere = /\bWHERE\b/i.test(query);
    const condition = `${tableAlias}.school_id = ?`;
    if (hasWhere) {
      return { sql: `${query} AND ${condition}`, hasWhere: true };
    } else {
      const orderMatch = query.match(/\s+ORDER\s+BY\s+/i);
      const groupMatch = query.match(/\s+GROUP\s+BY\s+/i);
      const insertPos = orderMatch?.index ?? groupMatch?.index ?? query.length;
      const before = query.slice(0, insertPos);
      const after = query.slice(insertPos);
      return { sql: `${before} WHERE ${condition}${after ? ' ' + after.trim() : ''}`, hasWhere: true };
    }
  }
  return { sql: query, hasWhere: /\bWHERE\b/i.test(query) };
}

// ===========================================
// API ROUTES: Schools
// ===========================================
app.get('/api/schools', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')

  try {
    let query = `
      SELECT id, name, logo_url, school_type, city, status,
             created_at, updated_at
      FROM schools
    `
    let params: any[] = []

    if (scope === 'single' && resolvedSchoolId) {
      query += ' WHERE id = ?'
      params = [resolvedSchoolId]
    }

    query += ' ORDER BY id'

    const { results } = await db.prepare(query).bind(...params).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب المدارس', detail: err.message }, 500)
  }
})

app.get('/api/schools/:id', async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  try {
    const school = await db.prepare(`
      SELECT * FROM schools WHERE id = ?
    `).bind(id).first()
    if (!school) return c.json({ error: 'المدرسة غير موجودة' }, 404)
    return c.json({ data: school })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب المدرسة', detail: err.message }, 500)
  }
})

app.post('/api/schools', requireAdmin(), async (c) => {
  const db = c.env.DB
  try {
    const body = await c.req.json()
    const {
      name, name_en, school_type, city, province, address,
      phone, email, website, principal_name, logo_url, official_stamp_url
    } = body

    if (!name) {
      return c.json({ error: 'اسم المدرسة مطلوب' }, 400)
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return c.json({ error: 'البريد الإلكتروني غير صحيح' }, 400)
    }

    const result = await db.prepare(`
      INSERT INTO schools (
        name, name_en, school_type, city, province, address,
        phone, email, website, principal_name, logo_url, official_stamp_url,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', unixepoch(), unixepoch())
    `).bind(
      name, name_en || null, school_type || null, city || null, province || null, address || null,
      phone || null, email || null, website || null, principal_name || null, logo_url || null, official_stamp_url || null
    ).run()

    return c.json({ data: { id: result.meta.last_row_id, name, status: 'active' } }, 201)
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء المدرسة', detail: err.message }, 500)
  }
})

app.put('/api/schools/:id', requireAdmin(), async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  try {
    const body = await c.req.json()
    const {
      name, name_en, school_type, city, province, address,
      phone, email, website, principal_name, logo_url, official_stamp_url, status
    } = body

    const existing = await db.prepare(`SELECT id FROM schools WHERE id = ?`).bind(id).first<{ id: number }>()
    if (!existing) return c.json({ error: 'المدرسة غير موجودة' }, 404)

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return c.json({ error: 'البريد الإلكتروني غير صحيح' }, 400)
    }
    if (!name) {
      return c.json({ error: 'اسم المدرسة مطلوب' }, 400)
    }

    await db.prepare(`
      UPDATE schools SET
        name = ?, name_en = ?, school_type = ?, city = ?, province = ?, address = ?,
        phone = ?, email = ?, website = ?, principal_name = ?, logo_url = ?, official_stamp_url = ?,
        status = ?, updated_at = unixepoch()
      WHERE id = ?
    `).bind(
      name, name_en || null, school_type || null, city || null, province || null, address || null,
      phone || null, email || null, website || null, principal_name || null, logo_url || null, official_stamp_url || null,
      status || 'active', id
    ).run()

    return c.json({ data: { id, name, status: status || 'active' } })
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث المدرسة', detail: err.message }, 500)
  }
})

app.put('/api/schools/:id/archive', requireAdmin(), async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  try {
    const existing = await db.prepare(`SELECT id FROM schools WHERE id = ?`).bind(id).first<{ id: number }>()
    if (!existing) return c.json({ error: 'المدرسة غير موجودة' }, 404)

    await db.prepare(`UPDATE schools SET status = 'archived', updated_at = unixepoch() WHERE id = ?`).bind(id).run()
    return c.json({ data: { id, status: 'archived' } })
  } catch (err: any) {
    return c.json({ error: 'فشل في أرشفة المدرسة', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Users (with RBAC + school_id filtering)
// ===========================================
app.get('/api/users', requireSameSchoolOrAdmin(), requireRoles(USER_DIRECTORY_ROLES), async (c) => {
  const db = c.env.DB
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  const querySchoolId = c.req.query('school_id')

  try {
    let query = `
      SELECT u.id, u.school_id, u.full_name, u.email, u.role_id, u.status,
             u.created_at, u.updated_at,
             r.name as role_name, r.key as role_key,
             s.name as school_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN schools s ON u.school_id = s.id
    `
    const binds: (string | number)[] = []
    const conditions: string[] = []

    if (scope === 'single' && resolvedSchoolId != null) {
      conditions.push('u.school_id = ?')
      binds.push(resolvedSchoolId)
    } else if (querySchoolId) {
      conditions.push('(u.school_id = ? OR u.school_id IS NULL)')
      binds.push(querySchoolId)
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`
    }

    const { results } = await db.prepare(query).bind(...binds).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب المستخدمين', detail: err.message }, 500)
  }
})

app.get('/api/users/:id', requireRoles(USER_DIRECTORY_ROLES), async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  const user: UserContext | null = c.get('user') || null
  try {
    const row = await db.prepare(`
      SELECT u.id, u.school_id, u.full_name, u.email, u.role_id, u.phone,
             u.status, u.created_at, u.updated_at,
             r.name as role_name, r.key as role_key, s.name as school_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN schools s ON u.school_id = s.id
      WHERE u.id = ?
    `).bind(id).first()
    if (!row) return c.json({ error: 'المستخدم غير موجود' }, 404)

    if (user && user.role_key !== 'system_admin') {
      if (row.school_id !== user.school_id) {
        return c.json({ error: 'غير مسموح: لا يمكنك الوصول إلى بيانات هذا المستخدم' }, 403)
      }
    }

    return c.json({ data: row })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب المستخدم', detail: err.message }, 500)
  }
})

app.post('/api/users', requireAdmin(), async (c) => {
  const db = c.env.DB
  try {
    const body = await c.req.json()
    const { full_name, email, password, role_id, role_key, school_id, phone } = body
    const normalizedEmail = typeof email === 'string' ? normalizeLoginEmail(email) : ''

    if (!full_name || !normalizedEmail || !password) {
      return c.json({ error: 'الاسم والبريد الإلكتروني وكلمة المرور مطلوبة' }, 400)
    }
    if (!role_id && !role_key) {
      return c.json({ error: 'الدور مطلوب' }, 400)
    }

    // Determine role_id from role_key if needed
    let finalRoleId = role_id
    if (!finalRoleId && role_key) {
      const roleRow = await db.prepare(`SELECT id FROM roles WHERE key = ?`).bind(role_key).first<{ id: number }>()
      if (!roleRow) return c.json({ error: 'الدور غير موجود' }, 400)
      finalRoleId = roleRow.id
    }

    // Get role key for validation
    const roleRow = await db.prepare(`SELECT key FROM roles WHERE id = ?`).bind(finalRoleId).first<{ key: string }>()
    if (!roleRow) return c.json({ error: 'الدور غير موجود' }, 400)
    const finalRoleKey = roleRow.key

    // School roles require school_id
    const schoolRoles = ['school_owner', 'principal', 'vice_principal', 'teacher', 'accountant', 'registrar', 'parent']
    if (schoolRoles.includes(finalRoleKey) && !school_id) {
      return c.json({ error: 'معرف المدرسة مطلوب لهذا الدور' }, 400)
    }
    // system_admin can have null school_id
    if (finalRoleKey === 'system_admin' && school_id) {
      // allowed but optional
    }

    // Check duplicate email
    const existing = await db.prepare(`SELECT id FROM users WHERE LOWER(email) = ?`).bind(normalizedEmail).first<{ id: number }>()
    if (existing) {
      return c.json({ error: 'البريد الإلكتروني مستخدم مسبقاً' }, 409)
    }

    const passwordHash = await hashPassword(password)

    const result = await db.prepare(`
      INSERT INTO users (school_id, full_name, email, password_hash, role_id, phone, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', unixepoch(), unixepoch())
    `).bind(
      school_id || null, full_name, normalizedEmail, passwordHash, finalRoleId, phone || null
    ).run()

    return c.json({ data: { id: result.meta.last_row_id, full_name, email: normalizedEmail, role_id: finalRoleId, school_id: school_id || null, status: 'active' } }, 201)
  } catch {
    return c.json({ error: 'فشل في إنشاء المستخدم' }, 500)
  }
})

app.put('/api/users/:id', requireAdmin(), async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  try {
    const body = await c.req.json()
    const { full_name, email, role_id, role_key, school_id, phone } = body

    const existing = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<{
      id: number; school_id: number | null; full_name: string; email: string; role_id: number; phone: string | null; status: string
    }>()
    if (!existing) return c.json({ error: 'المستخدم غير موجود' }, 404)

    // Determine role_id
    let finalRoleId = role_id || existing.role_id
    if (role_key && !role_id) {
      const roleRow = await db.prepare(`SELECT id FROM roles WHERE key = ?`).bind(role_key).first<{ id: number }>()
      if (!roleRow) return c.json({ error: 'الدور غير موجود' }, 400)
      finalRoleId = roleRow.id
    }

    const roleRow = await db.prepare(`SELECT key FROM roles WHERE id = ?`).bind(finalRoleId).first<{ key: string }>()
    if (!roleRow) return c.json({ error: 'الدور غير موجود' }, 400)
    const finalRoleKey = roleRow.key

    const schoolRoles = ['school_owner', 'principal', 'vice_principal', 'teacher', 'accountant', 'registrar', 'parent']
    if (schoolRoles.includes(finalRoleKey) && !school_id) {
      return c.json({ error: 'معرف المدرسة مطلوب لهذا الدور' }, 400)
    }

    // Check duplicate email if changed
    if (email && email !== existing.email) {
      const dup = await db.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first<{ id: number }>()
      if (dup) {
        return c.json({ error: 'البريد الإلكتروني مستخدم مسبقاً' }, 409)
      }
    }

    await db.prepare(`
      UPDATE users SET
        school_id = ?, full_name = ?, email = ?, role_id = ?, phone = ?, updated_at = unixepoch()
      WHERE id = ?
    `).bind(
      school_id !== undefined ? (school_id || null) : existing.school_id,
      full_name || existing.full_name,
      email || existing.email,
      finalRoleId,
      phone !== undefined ? (phone || null) : existing.phone,
      id
    ).run()

    return c.json({ data: { id, full_name: full_name || existing.full_name, email: email || existing.email, role_id: finalRoleId, school_id: school_id !== undefined ? (school_id || null) : existing.school_id } })
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث المستخدم', detail: err.message }, 500)
  }
})

app.put('/api/users/:id/status', requireAdmin(), async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  try {
    const body = await c.req.json()
    const { status } = body

    if (!status || !['active', 'inactive'].includes(status)) {
      return c.json({ error: 'الحالة يجب أن تكون active أو inactive' }, 400)
    }

    const existing = await db.prepare(`SELECT id FROM users WHERE id = ?`).bind(id).first<{ id: number }>()
    if (!existing) return c.json({ error: 'المستخدم غير موجود' }, 404)

    await db.prepare(`UPDATE users SET status = ?, updated_at = unixepoch() WHERE id = ?`).bind(status, id).run()
    return c.json({ data: { id, status } })
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث حالة المستخدم', detail: err.message }, 500)
  }
})

app.put('/api/users/:id/reset-password', requireAdmin(), async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  try {
    const body = await c.req.json()
    const { password } = body

    if (!password) {
      return c.json({ error: 'كلمة المرور مطلوبة' }, 400)
    }

    const existing = await db.prepare(`SELECT email FROM users WHERE id = ?`).bind(id).first<{ email: string }>()
    if (!existing) return c.json({ error: 'المستخدم غير موجود' }, 404)

    const passwordHash = await hashPassword(password)
    await db.prepare(`
      UPDATE users
      SET password_hash = ?, auth_version = auth_version + 1, updated_at = unixepoch()
      WHERE id = ?
    `).bind(passwordHash, id).run()

    return c.json({ data: { id, success: true } })
  } catch {
    return c.json({ error: 'فشل في إعادة تعيين كلمة المرور' }, 500)
  }
})

// ===========================================
// API ROUTES: Roles
// ===========================================
app.get('/api/roles', async (c) => {
  const db = c.env.DB
  try {
    const { results } = await db.prepare(`
      SELECT id, key, name, description, is_system, created_at
      FROM roles
      ORDER BY id
    `).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الأدوار', detail: err.message }, 500)
  }
})

app.get('/api/roles/:id', async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  try {
    const role = await db.prepare(`
      SELECT * FROM roles WHERE id = ?
    `).bind(id).first()
    if (!role) return c.json({ error: 'الدور غير موجود' }, 404)
    return c.json({ data: role })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الدور', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Role Permissions
// ===========================================
app.get('/api/role-permissions', async (c) => {
  const db = c.env.DB
  try {
    const { results } = await db.prepare(`
      SELECT rp.role_id, rp.permission_id,
             r.key as role_key, r.name as role_name,
             p.key as permission_key, p.name as permission_name, p.resource, p.action
      FROM role_permissions rp
      JOIN roles r ON rp.role_id = r.id
      JOIN permissions p ON rp.permission_id = p.id
    `).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الصلاحيات', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Permissions
// ===========================================
app.get('/api/permissions', async (c) => {
  const db = c.env.DB
  try {
    const { results } = await db.prepare(`
      SELECT id, key, name, description, resource, action, created_at
      FROM permissions
      ORDER BY id
    `).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الصلاحيات', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Modules
// ===========================================
app.get('/api/modules', async (c) => {
  const db = c.env.DB
  try {
    const { results } = await db.prepare(`
      SELECT id, key, name, description, status, is_core, created_at
      FROM modules
      ORDER BY id
    `).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الموديلات', detail: err.message }, 500)
  }
})

app.get('/api/modules/:id', async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  try {
    const mod = await db.prepare(`
      SELECT * FROM modules WHERE id = ?
    `).bind(id).first()
    if (!mod) return c.json({ error: 'الموديل غير موجود' }, 404)
    return c.json({ data: mod })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الموديل', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: School Modules (with RBAC + school_id filtering)
// ===========================================
app.get('/api/school-modules', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  const querySchoolId = c.req.query('school_id')
  try {
    let query = `
      SELECT sm.id, sm.school_id, sm.module_id, sm.is_enabled,
             sm.enabled_at, sm.disabled_at, sm.notes,
             m.key as module_key, m.name as module_name, m.is_core
      FROM school_modules sm
      JOIN modules m ON sm.module_id = m.id
    `
    const binds: (string | number)[] = []
    const conditions: string[] = []

    if (scope === 'single' && resolvedSchoolId != null) {
      conditions.push('sm.school_id = ?')
      binds.push(resolvedSchoolId)
    } else if (querySchoolId) {
      conditions.push('sm.school_id = ?')
      binds.push(querySchoolId)
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`
    }

    const { results } = await db.prepare(query).bind(...binds).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب موديلات المدرسة', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Academic Years (with RBAC + school_id filtering)
// ===========================================
app.get('/api/academic-years', requireSameSchoolOrAdmin(), requireRoles(SETTINGS_VIEW_ROLES), async (c) => {
  const db = c.env.DB
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  if (resolvedSchoolId == null) {
    return c.json({ error: 'يجب تحديد مدرسة لعرض السنوات الدراسية' }, 400)
  }
  try {
    const { results } = await db.prepare(`
      SELECT id, school_id, name, starts_at, ends_at, is_active, created_at
      FROM academic_years
      WHERE school_id = ?
      ORDER BY is_active DESC, starts_at DESC, id DESC
    `).bind(resolvedSchoolId).all<AcademicYearRecord>()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب السنوات الدراسية', detail: err.message }, 500)
  }
})

app.post('/api/academic-years', requireSameSchoolOrAdmin(), requireRoles(SETTINGS_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user = c.get('user') as UserContext
  try {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: 'بيانات السنة الدراسية غير صالحة' }, 400)
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    if (body.activate !== undefined && typeof body.activate !== 'boolean') {
      return c.json({ error: 'خيار تفعيل السنة الدراسية غير صالح' }, 400)
    }
    const validation = validateAcademicYearInput(body)
    if (!validation.ok) return c.json({ error: validation.error }, 400)
    const inserted = await createInactiveAcademicYear(db, targetSchool.schoolId, validation.value)

    if (body.activate === true) {
      const activation = await activateAcademicYearAtomically(db, inserted.id, targetSchool.schoolId)
      if (!activation.ok) throw new Error('Created academic year could not be activated')
      return c.json({ data: activation.year }, 201)
    }
    return c.json({ data: inserted }, 201)
  } catch (error) {
    if (isDuplicateAcademicYearError(error)) {
      return c.json({ error: 'يوجد عام دراسي بالاسم نفسه لهذه المدرسة' }, 409)
    }
    return c.json({ error: 'فشل في إنشاء السنة الدراسية' }, 500)
  }
})

app.put('/api/academic-years/:id', requireSameSchoolOrAdmin(), requireRoles(SETTINGS_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user = c.get('user') as UserContext
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'معرف السنة الدراسية غير صالح' }, 400)
  try {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: 'بيانات السنة الدراسية غير صالحة' }, 400)
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    if (Object.prototype.hasOwnProperty.call(body, 'is_active')) {
      return c.json({ error: 'يجب استخدام إجراء التفعيل المخصص لتغيير حالة السنة الدراسية' }, 400)
    }
    const existing = await db.prepare('SELECT id, school_id FROM academic_years WHERE id = ?')
      .bind(id).first<{ id: number; school_id: number }>()
    if (!existing) return c.json({ error: 'السنة الدراسية غير موجودة' }, 404)
    if (existing.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: السنة الدراسية لا تنتمي إلى المدرسة المستهدفة' }, 403)
    }

    const validation = validateAcademicYearInput(body)
    if (!validation.ok) return c.json({ error: validation.error }, 400)
    const updated = await updateAcademicYearDetails(db, id, targetSchool.schoolId, validation.value)
    if (!updated) return c.json({ error: 'السنة الدراسية غير موجودة' }, 404)
    return c.json({ data: updated })
  } catch (error) {
    if (isDuplicateAcademicYearError(error)) {
      return c.json({ error: 'يوجد عام دراسي بالاسم نفسه لهذه المدرسة' }, 409)
    }
    return c.json({ error: 'فشل في تعديل السنة الدراسية' }, 500)
  }
})

app.put('/api/academic-years/:id/activate', requireSameSchoolOrAdmin(), requireRoles(SETTINGS_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user = c.get('user') as UserContext
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'معرف السنة الدراسية غير صالح' }, 400)
  try {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: 'بيانات السنة الدراسية غير صالحة' }, 400)
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    const activation = await activateAcademicYearAtomically(db, id, targetSchool.schoolId)
    if (!activation.ok) {
      if (activation.code === 'not_found') return c.json({ error: 'السنة الدراسية غير موجودة' }, 404)
      return c.json({ error: 'غير مسموح: السنة الدراسية لا تنتمي إلى المدرسة المستهدفة' }, 403)
    }
    return c.json({ data: activation.year })
  } catch {
    return c.json({ error: 'فشل في تفعيل السنة الدراسية' }, 500)
  }
})

// ===========================================
// API ROUTES: Timetable foundation (Phase 18A.1)
// ===========================================
app.get('/api/timetable/days', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const schoolId: number | null = c.get('resolvedSchoolId')
  const academicYearId = Number(c.req.query('academic_year_id'))
  if (schoolId == null) return c.json({ error: 'يجب تحديد مدرسة لعرض إعدادات الجدول' }, 400)
  if (!Number.isInteger(academicYearId) || academicYearId <= 0) return c.json({ error: 'السنة الدراسية مطلوبة' }, 400)
  const year = await validateTimetableAcademicYear(c.env.DB, schoolId, academicYearId)
  if (!year.ok) return c.json({ error: year.error }, year.status)
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM timetable_days
      WHERE school_id = ? AND academic_year_id = ?
      ORDER BY order_index, day_of_week
    `).bind(schoolId, academicYearId).all<TimetableDay>()
    return c.json({ data: results || [] })
  } catch {
    return c.json({ error: 'فشل في جلب أيام الجدول الدراسي' }, 500)
  }
})

app.put('/api/timetable/days/:day', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  const routeDay = Number(c.req.param('day'))
  try {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: 'بيانات يوم الدوام غير صالحة' }, 400)
    const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    const validation = validateTimetableDayInput({ ...body, day_of_week: routeDay })
    if (!validation.ok) return c.json({ error: validation.error }, 400)
    const year = await validateTimetableAcademicYear(c.env.DB, targetSchool.schoolId, validation.value.academicYearId)
    if (!year.ok) return c.json({ error: year.error }, year.status)
    await c.env.DB.prepare(`
      INSERT INTO timetable_days (
        school_id, academic_year_id, day_of_week, is_active, order_index
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(school_id, academic_year_id, day_of_week) DO UPDATE SET
        is_active = excluded.is_active,
        order_index = excluded.order_index,
        updated_at = unixepoch()
    `).bind(
      targetSchool.schoolId,
      validation.value.academicYearId,
      validation.value.dayOfWeek,
      validation.value.isActive,
      validation.value.orderIndex,
    ).run()
    const day = await c.env.DB.prepare(`
      SELECT * FROM timetable_days
      WHERE school_id = ? AND academic_year_id = ? AND day_of_week = ?
    `).bind(targetSchool.schoolId, validation.value.academicYearId, validation.value.dayOfWeek).first<TimetableDay>()
    return c.json({ data: day })
  } catch (error) {
    if (isTimetableConstraintError(error)) return c.json({ error: 'تعذر حفظ يوم الدوام بسبب تعارض في البيانات' }, 400)
    return c.json({ error: 'فشل في حفظ يوم الدوام' }, 500)
  }
})

app.get('/api/timetable/slots', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const schoolId: number | null = c.get('resolvedSchoolId')
  const academicYearId = Number(c.req.query('academic_year_id'))
  if (schoolId == null) return c.json({ error: 'يجب تحديد مدرسة لعرض فترات الجدول' }, 400)
  if (!Number.isInteger(academicYearId) || academicYearId <= 0) return c.json({ error: 'السنة الدراسية مطلوبة' }, 400)
  const year = await validateTimetableAcademicYear(c.env.DB, schoolId, academicYearId)
  if (!year.ok) return c.json({ error: year.error }, year.status)
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM timetable_slots
      WHERE school_id = ? AND academic_year_id = ?
      ORDER BY day_of_week, slot_index
    `).bind(schoolId, academicYearId).all<TimetableSlot>()
    return c.json({ data: results || [] })
  } catch {
    return c.json({ error: 'فشل في جلب فترات الجدول' }, 500)
  }
})

app.post('/api/timetable/slots', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  try {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: 'بيانات الفترة غير صالحة' }, 400)
    const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    const validation = validateTimetableSlotInput(body)
    if (!validation.ok) return c.json({ error: validation.error }, 400)
    const year = await validateTimetableAcademicYear(c.env.DB, targetSchool.schoolId, validation.value.academicYearId)
    if (!year.ok) return c.json({ error: year.error }, year.status)
    const result = await c.env.DB.prepare(`
      INSERT INTO timetable_slots (
        school_id, academic_year_id, day_of_week, slot_index, slot_type,
        lesson_number, label, start_time, end_time, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      targetSchool.schoolId,
      validation.value.academicYearId,
      validation.value.dayOfWeek,
      validation.value.slotIndex,
      validation.value.slotType,
      validation.value.lessonNumber,
      validation.value.label,
      validation.value.startTime,
      validation.value.endTime,
      validation.value.isActive,
    ).run()
    const slot = await c.env.DB.prepare('SELECT * FROM timetable_slots WHERE id = ? AND school_id = ?')
      .bind(result.meta.last_row_id, targetSchool.schoolId).first<TimetableSlot>()
    return c.json({ data: slot }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/overlap/i.test(message)) return c.json({ error: 'تتداخل الفترة مع فترة أخرى في اليوم نفسه' }, 409)
    if (isTimetableConstraintError(error)) return c.json({ error: 'ترتيب الفترة أو رقم الحصة مستخدم في هذا اليوم' }, 409)
    return c.json({ error: 'فشل في إنشاء فترة الجدول' }, 500)
  }
})

app.put('/api/timetable/slots/:id', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'معرف الفترة غير صالح' }, 400)
  try {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: 'بيانات الفترة غير صالحة' }, 400)
    const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    const existing = await c.env.DB.prepare(`
      SELECT slot.school_id, slot.academic_year_id,
             EXISTS (
               SELECT 1 FROM timetable_teacher_availability availability
               WHERE availability.slot_id = slot.id
             ) AS has_teacher_availability
      FROM timetable_slots slot
      WHERE slot.id = ?
    `).bind(id).first<{
      school_id: number;
      academic_year_id: number;
      has_teacher_availability: number;
    }>()
    if (!existing) return c.json({ error: 'الفترة غير موجودة' }, 404)
    if (Number(existing.school_id) !== targetSchool.schoolId) return c.json({ error: 'غير مسموح: الفترة من مدرسة أخرى' }, 403)
    const validation = validateTimetableSlotInput(body)
    if (!validation.ok) return c.json({ error: validation.error }, 400)
    const changesAvailabilityScope = Number(existing.academic_year_id) !== validation.value.academicYearId
      || validation.value.slotType !== 'lesson'
    if (Number(existing.has_teacher_availability) === 1 && changesAvailabilityScope) {
      return c.json({
        error: 'توجد إعدادات توفر مدرسين مرتبطة بهذه الفترة. امسح إعدادات التوفر أولًا قبل تغيير نوعها أو سنتها الدراسية.',
      }, 400)
    }
    if (Number(existing.academic_year_id) !== validation.value.academicYearId) {
      return c.json({ error: 'لا يمكن نقل الفترة إلى سنة دراسية أخرى' }, 400)
    }
    await c.env.DB.prepare(`
      UPDATE timetable_slots SET
        day_of_week = ?, slot_index = ?, slot_type = ?, lesson_number = ?,
        label = ?, start_time = ?, end_time = ?, is_active = ?, updated_at = unixepoch()
      WHERE id = ? AND school_id = ? AND academic_year_id = ?
    `).bind(
      validation.value.dayOfWeek,
      validation.value.slotIndex,
      validation.value.slotType,
      validation.value.lessonNumber,
      validation.value.label,
      validation.value.startTime,
      validation.value.endTime,
      validation.value.isActive,
      id,
      targetSchool.schoolId,
      validation.value.academicYearId,
    ).run()
    const slot = await c.env.DB.prepare('SELECT * FROM timetable_slots WHERE id = ? AND school_id = ?')
      .bind(id, targetSchool.schoolId).first<TimetableSlot>()
    return c.json({ data: slot })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/timetable slot has scheduled entries/i.test(message)) {
      return c.json({ error: 'توجد حصص مجدولة مرتبطة بهذه الفترة. احذف الحصص المجدولة أولًا قبل تغيير بنية الفترة.' }, 400)
    }
    if (/timetable slot has teacher availability settings/i.test(message)) {
      return c.json({
        error: 'توجد إعدادات توفر مدرسين مرتبطة بهذه الفترة. امسح إعدادات التوفر أولًا قبل تعديل نوعها أو نطاقها.',
      }, 400)
    }
    if (/overlap/i.test(message)) return c.json({ error: 'تتداخل الفترة مع فترة أخرى في اليوم نفسه' }, 409)
    if (isTimetableConstraintError(error)) return c.json({ error: 'ترتيب الفترة أو رقم الحصة مستخدم في هذا اليوم' }, 409)
    return c.json({ error: 'فشل في تعديل فترة الجدول' }, 500)
  }
})

app.delete('/api/timetable/slots/:id', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'معرف الفترة غير صالح' }, 400)
  const body = await readJsonObject(c)
  if (!body) return c.json({ error: 'سياق حذف الفترة غير صالح' }, 400)
  const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
  if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
  const existing = await c.env.DB.prepare('SELECT school_id, academic_year_id FROM timetable_slots WHERE id = ?')
    .bind(id).first<{ school_id: number; academic_year_id: number }>()
  if (!existing) return c.json({ error: 'الفترة غير موجودة' }, 404)
  if (Number(existing.school_id) !== targetSchool.schoolId) return c.json({ error: 'غير مسموح: الفترة من مدرسة أخرى' }, 403)
  if (Number(body.academic_year_id) !== Number(existing.academic_year_id)) return c.json({ error: 'السنة الدراسية لا تطابق الفترة' }, 400)
  try {
    await c.env.DB.prepare('DELETE FROM timetable_slots WHERE id = ? AND school_id = ? AND academic_year_id = ?')
      .bind(id, targetSchool.schoolId, existing.academic_year_id).run()
    return c.json({ data: { id } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/FOREIGN KEY constraint failed/i.test(message)) {
      return c.json({ error: 'لا يمكن حذف الفترة لأنها تحتوي على حصص مجدولة. احذف الحصص المجدولة أولًا.' }, 409)
    }
    return c.json({ error: 'فشل في حذف فترة الجدول' }, 500)
  }
})

app.get('/api/timetable/teaching-loads', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const schoolId: number | null = c.get('resolvedSchoolId')
  const academicYearId = Number(c.req.query('academic_year_id'))
  if (schoolId == null) return c.json({ error: 'يجب تحديد مدرسة لعرض أنصبة المواد' }, 400)
  if (!Number.isInteger(academicYearId) || academicYearId <= 0) return c.json({ error: 'السنة الدراسية مطلوبة' }, 400)
  const year = await validateTimetableAcademicYear(c.env.DB, schoolId, academicYearId)
  if (!year.ok) return c.json({ error: year.error }, year.status)
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT load.*,
             class.name AS class_name, class.status AS class_status, class.school_id AS class_school_id,
             COALESCE(class_sections.active_section_count, 0) AS active_section_count,
             section.name AS section_name, section.status AS section_status,
             section.school_id AS section_school_id, section.class_id AS section_class_id,
             subject.name AS subject_name, subject.status AS subject_status, subject.school_id AS subject_school_id,
             subject.class_id AS subject_class_id, subject.section_id AS subject_section_id,
             employee.full_name AS employee_name, employee.status AS employee_status, employee.school_id AS employee_school_id,
             employee.role AS employee_role
      FROM timetable_teaching_loads load
      LEFT JOIN classes class ON class.id = load.class_id
      LEFT JOIN (
        SELECT school_id, class_id, COUNT(*) AS active_section_count
        FROM sections WHERE status = 'active'
        GROUP BY school_id, class_id
      ) class_sections ON class_sections.school_id = load.school_id AND class_sections.class_id = load.class_id
      LEFT JOIN sections section ON section.id = load.section_id
      LEFT JOIN subjects subject ON subject.id = load.subject_id
      LEFT JOIN employees employee ON employee.id = load.employee_id
      WHERE load.school_id = ? AND load.academic_year_id = ?
      ORDER BY class.order_index, load.section_id, subject.order_index, load.id
    `).bind(schoolId, academicYearId).all<TimetableTeachingLoad>()
    return c.json({ data: results || [] })
  } catch {
    return c.json({ error: 'فشل في جلب أنصبة المواد' }, 500)
  }
})

app.post('/api/timetable/teaching-loads', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  try {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: 'بيانات النصاب غير صالحة' }, 400)
    const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    const validation = validateTimetableLoadInput(body)
    if (!validation.ok) return c.json({ error: validation.error }, 400)
    const references = await validateTimetableLoadReferences(c.env.DB, targetSchool.schoolId, validation.value)
    if (!references.ok) return c.json({ error: references.error }, references.status)
    const result = await c.env.DB.prepare(`
      INSERT INTO timetable_teaching_loads (
        school_id, academic_year_id, class_id, section_id, subject_id,
        employee_id, weekly_periods, status, created_by_user_id, updated_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).bind(
      targetSchool.schoolId,
      validation.value.academicYearId,
      validation.value.classId,
      validation.value.sectionId,
      validation.value.subjectId,
      validation.value.employeeId,
      validation.value.weeklyPeriods,
      user.id,
      user.id,
    ).run()
    const load = await c.env.DB.prepare('SELECT * FROM timetable_teaching_loads WHERE id = ? AND school_id = ?')
      .bind(result.meta.last_row_id, targetSchool.schoolId).first<TimetableTeachingLoad>()
    return c.json({ data: load }, 201)
  } catch (error) {
    if (isTimetableConstraintError(error)) return c.json({ error: 'يوجد نصاب فعال لهذه المادة في الصف والشعبة المحددين' }, 409)
    return c.json({ error: 'فشل في إنشاء نصاب المادة' }, 500)
  }
})

app.put('/api/timetable/teaching-loads/:id', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'معرف النصاب غير صالح' }, 400)
  try {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: 'بيانات النصاب غير صالحة' }, 400)
    const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    const existing = await c.env.DB.prepare('SELECT school_id, academic_year_id FROM timetable_teaching_loads WHERE id = ?')
      .bind(id).first<{ school_id: number; academic_year_id: number }>()
    if (!existing) return c.json({ error: 'النصاب غير موجود' }, 404)
    if (Number(existing.school_id) !== targetSchool.schoolId) return c.json({ error: 'غير مسموح: النصاب من مدرسة أخرى' }, 403)
    const validation = validateTimetableLoadInput(body)
    if (!validation.ok) return c.json({ error: validation.error }, 400)
    if (Number(existing.academic_year_id) !== validation.value.academicYearId) return c.json({ error: 'لا يمكن نقل النصاب إلى سنة دراسية أخرى' }, 400)
    const references = await validateTimetableLoadReferences(c.env.DB, targetSchool.schoolId, validation.value)
    if (!references.ok) return c.json({ error: references.error }, references.status)
    await c.env.DB.prepare(`
      UPDATE timetable_teaching_loads SET
        class_id = ?, section_id = ?, subject_id = ?, employee_id = ?,
        weekly_periods = ?, status = 'active', updated_by_user_id = ?, updated_at = unixepoch()
      WHERE id = ? AND school_id = ? AND academic_year_id = ?
    `).bind(
      validation.value.classId,
      validation.value.sectionId,
      validation.value.subjectId,
      validation.value.employeeId,
      validation.value.weeklyPeriods,
      user.id,
      id,
      targetSchool.schoolId,
      validation.value.academicYearId,
    ).run()
    const load = await c.env.DB.prepare('SELECT * FROM timetable_teaching_loads WHERE id = ? AND school_id = ?')
      .bind(id, targetSchool.schoolId).first<TimetableTeachingLoad>()
    return c.json({ data: load })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/timetable load has scheduled entries/i.test(message)) {
      return c.json({ error: 'توجد حصص مجدولة مرتبطة بهذا النصاب. احذف الحصص المجدولة أولًا قبل تغيير صفه أو مادته أو مدرسه.' }, 400)
    }
    if (/weekly periods below scheduled entries/i.test(message)) {
      return c.json({ error: 'لا يمكن تقليل عدد الحصص الأسبوعية عن عدد الحصص المجدولة حاليًا.' }, 400)
    }
    if (isTimetableConstraintError(error)) return c.json({ error: 'يوجد نصاب فعال لهذه المادة في الصف والشعبة المحددين' }, 409)
    return c.json({ error: 'فشل في تعديل نصاب المادة' }, 500)
  }
})

app.delete('/api/timetable/teaching-loads/:id', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'معرف النصاب غير صالح' }, 400)
  const body = await readJsonObject(c)
  if (!body) return c.json({ error: 'سياق تعطيل النصاب غير صالح' }, 400)
  const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
  if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
  const existing = await c.env.DB.prepare('SELECT school_id, academic_year_id FROM timetable_teaching_loads WHERE id = ?')
    .bind(id).first<{ school_id: number; academic_year_id: number }>()
  if (!existing) return c.json({ error: 'النصاب غير موجود' }, 404)
  if (Number(existing.school_id) !== targetSchool.schoolId) return c.json({ error: 'غير مسموح: النصاب من مدرسة أخرى' }, 403)
  if (Number(body.academic_year_id) !== Number(existing.academic_year_id)) return c.json({ error: 'السنة الدراسية لا تطابق النصاب' }, 400)
  await c.env.DB.prepare(`
    UPDATE timetable_teaching_loads
    SET status = 'inactive', updated_by_user_id = ?, updated_at = unixepoch()
    WHERE id = ? AND school_id = ? AND academic_year_id = ?
  `).bind(user.id, id, targetSchool.schoolId, existing.academic_year_id).run()
  return c.json({ data: { id, status: 'inactive' } })
})

app.get('/api/timetable/teacher-availability', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const schoolId: number | null = c.get('resolvedSchoolId')
  if (schoolId == null) return c.json({ error: 'يجب تحديد مدرسة لعرض توفر المدرس' }, 400)
  const validation = validateTeacherAvailabilityScopeInput({
    academic_year_id: c.req.query('academic_year_id'),
    employee_id: c.req.query('employee_id'),
  })
  if (!validation.ok) return c.json({ error: validation.error }, 400)
  const year = await validateTimetableAcademicYear(c.env.DB, schoolId, validation.value.academicYearId)
  if (!year.ok) return c.json({ error: year.error }, year.status)
  const teacher = await validateTimetableTeacherReference(c.env.DB, schoolId, validation.value.employeeId, false)
  if (!teacher.ok) return c.json({ error: teacher.error }, teacher.status)
  try {
    return c.json({
      data: await loadTeacherAvailabilityMatrix(
        c.env.DB,
        schoolId,
        validation.value.academicYearId,
        teacher.teacher!,
      ),
    })
  } catch {
    return c.json({ error: 'فشل في جلب توفر المدرس وقيوده' }, 500)
  }
})

app.put('/api/timetable/teacher-availability/:slotId', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  const slotId = Number(c.req.param('slotId'))
  try {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: 'بيانات توفر المدرس غير صالحة' }, 400)
    const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    const validation = validateTeacherAvailabilityOverrideInput({ ...body, slot_id: slotId })
    if (!validation.ok) return c.json({ error: validation.error }, 400)
    const year = await validateTimetableAcademicYear(c.env.DB, targetSchool.schoolId, validation.value.academicYearId)
    if (!year.ok) return c.json({ error: year.error }, year.status)
    const teacher = await validateTimetableTeacherReference(
      c.env.DB,
      targetSchool.schoolId,
      validation.value.employeeId,
      true,
    )
    if (!teacher.ok) return c.json({ error: teacher.error }, teacher.status)
    const slot = await validateTimetableAvailabilitySlot(
      c.env.DB,
      targetSchool.schoolId,
      validation.value.academicYearId,
      validation.value.slotId,
    )
    if (!slot.ok) return c.json({ error: slot.error }, slot.status)
    await c.env.DB.prepare(`
      INSERT INTO timetable_teacher_availability (
        school_id, academic_year_id, employee_id, slot_id, status,
        created_by_user_id, updated_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(school_id, academic_year_id, employee_id, slot_id) DO UPDATE SET
        status = excluded.status,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = unixepoch()
    `).bind(
      targetSchool.schoolId,
      validation.value.academicYearId,
      validation.value.employeeId,
      validation.value.slotId,
      validation.value.status,
      user.id,
      user.id,
    ).run()
    const override = await c.env.DB.prepare(`
      SELECT * FROM timetable_teacher_availability
      WHERE school_id = ? AND academic_year_id = ? AND employee_id = ? AND slot_id = ?
    `).bind(
      targetSchool.schoolId,
      validation.value.academicYearId,
      validation.value.employeeId,
      validation.value.slotId,
    ).first<TimetableTeacherAvailabilityOverride>()
    return c.json({ data: override })
  } catch (error) {
    if (isTimetableConstraintError(error)) return c.json({ error: 'تعذر حفظ توفر المدرس بسبب مرجع غير صالح' }, 400)
    return c.json({ error: 'فشل في حفظ توفر المدرس' }, 500)
  }
})

app.delete('/api/timetable/teacher-availability/:slotId', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  const slotId = Number(c.req.param('slotId'))
  const body = await readJsonObject(c)
  if (!body) return c.json({ error: 'سياق إعادة توفر الفترة غير صالح' }, 400)
  const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
  if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
  const validation = validateTeacherAvailabilityScopeInput(body)
  if (!validation.ok || !Number.isInteger(slotId) || slotId <= 0) {
    return c.json({ error: validation.ok ? 'فترة الدرس غير صالحة' : validation.error }, 400)
  }
  const year = await validateTimetableAcademicYear(c.env.DB, targetSchool.schoolId, validation.value.academicYearId)
  if (!year.ok) return c.json({ error: year.error }, year.status)
  const teacher = await validateTimetableTeacherReference(c.env.DB, targetSchool.schoolId, validation.value.employeeId, false)
  if (!teacher.ok) return c.json({ error: teacher.error }, teacher.status)
  const slot = await validateTimetableAvailabilitySlot(
    c.env.DB,
    targetSchool.schoolId,
    validation.value.academicYearId,
    slotId,
  )
  if (!slot.ok) return c.json({ error: slot.error }, slot.status)
  await c.env.DB.prepare(`
    DELETE FROM timetable_teacher_availability
    WHERE school_id = ? AND academic_year_id = ? AND employee_id = ? AND slot_id = ?
  `).bind(targetSchool.schoolId, validation.value.academicYearId, validation.value.employeeId, slotId).run()
  return c.json({ data: { slot_id: slotId, status: 'available' } })
})

app.put('/api/timetable/teacher-availability/day/:day', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  try {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: 'بيانات توفر اليوم غير صالحة' }, 400)
    const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    const validation = validateTeacherAvailabilityDayInput({ ...body, day_of_week: c.req.param('day') })
    if (!validation.ok) return c.json({ error: validation.error }, 400)
    const year = await validateTimetableAcademicYear(c.env.DB, targetSchool.schoolId, validation.value.academicYearId)
    if (!year.ok) return c.json({ error: year.error }, year.status)
    const teacher = await validateTimetableTeacherReference(
      c.env.DB,
      targetSchool.schoolId,
      validation.value.employeeId,
      true,
    )
    if (!teacher.ok) return c.json({ error: teacher.error }, teacher.status)
    const day = await c.env.DB.prepare(`
      SELECT id FROM timetable_days
      WHERE school_id = ? AND academic_year_id = ? AND day_of_week = ?
    `).bind(
      targetSchool.schoolId,
      validation.value.academicYearId,
      validation.value.dayOfWeek,
    ).first<{ id: number }>()
    if (!day) return c.json({ error: 'يوم الجدول غير موجود' }, 404)
    if (validation.value.status == null) {
      await c.env.DB.prepare(`
        DELETE FROM timetable_teacher_availability
        WHERE school_id = ? AND academic_year_id = ? AND employee_id = ?
          AND slot_id IN (
            SELECT id FROM timetable_slots
            WHERE school_id = ? AND academic_year_id = ? AND day_of_week = ? AND slot_type = 'lesson'
          )
      `).bind(
        targetSchool.schoolId,
        validation.value.academicYearId,
        validation.value.employeeId,
        targetSchool.schoolId,
        validation.value.academicYearId,
        validation.value.dayOfWeek,
      ).run()
    } else {
      await c.env.DB.prepare(`
        INSERT INTO timetable_teacher_availability (
          school_id, academic_year_id, employee_id, slot_id, status,
          created_by_user_id, updated_by_user_id
        )
        SELECT ?, ?, ?, slot.id, ?, ?, ?
        FROM timetable_slots slot
        WHERE slot.school_id = ? AND slot.academic_year_id = ?
          AND slot.day_of_week = ? AND slot.slot_type = 'lesson'
        ON CONFLICT(school_id, academic_year_id, employee_id, slot_id) DO UPDATE SET
          status = excluded.status,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at = unixepoch()
      `).bind(
        targetSchool.schoolId,
        validation.value.academicYearId,
        validation.value.employeeId,
        validation.value.status,
        user.id,
        user.id,
        targetSchool.schoolId,
        validation.value.academicYearId,
        validation.value.dayOfWeek,
      ).run()
    }
    return c.json({ data: await loadTeacherAvailabilityMatrix(
      c.env.DB,
      targetSchool.schoolId,
      validation.value.academicYearId,
      teacher.teacher!,
    ) })
  } catch (error) {
    if (isTimetableConstraintError(error)) return c.json({ error: 'تعذر حفظ توفر اليوم بسبب مرجع غير صالح' }, 400)
    return c.json({ error: 'فشل في حفظ توفر اليوم' }, 500)
  }
})

app.delete('/api/timetable/teacher-availability', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  const body = await readJsonObject(c)
  if (!body) return c.json({ error: 'سياق إعادة ضبط توفر المدرس غير صالح' }, 400)
  const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
  if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
  const validation = validateTeacherAvailabilityScopeInput(body)
  if (!validation.ok) return c.json({ error: validation.error }, 400)
  const year = await validateTimetableAcademicYear(c.env.DB, targetSchool.schoolId, validation.value.academicYearId)
  if (!year.ok) return c.json({ error: year.error }, year.status)
  const teacher = await validateTimetableTeacherReference(c.env.DB, targetSchool.schoolId, validation.value.employeeId, false)
  if (!teacher.ok) return c.json({ error: teacher.error }, teacher.status)
  await c.env.DB.prepare(`
    DELETE FROM timetable_teacher_availability
    WHERE school_id = ? AND academic_year_id = ? AND employee_id = ?
  `).bind(targetSchool.schoolId, validation.value.academicYearId, validation.value.employeeId).run()
  return c.json({ data: { employee_id: validation.value.employeeId, reset: true } })
})

app.get('/api/timetable/teacher-constraints', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const schoolId: number | null = c.get('resolvedSchoolId')
  if (schoolId == null) return c.json({ error: 'يجب تحديد مدرسة لعرض قيود المدرس' }, 400)
  const validation = validateTeacherAvailabilityScopeInput({
    academic_year_id: c.req.query('academic_year_id'),
    employee_id: c.req.query('employee_id'),
  })
  if (!validation.ok) return c.json({ error: validation.error }, 400)
  const year = await validateTimetableAcademicYear(c.env.DB, schoolId, validation.value.academicYearId)
  if (!year.ok) return c.json({ error: year.error }, year.status)
  const teacher = await validateTimetableTeacherReference(c.env.DB, schoolId, validation.value.employeeId, false)
  if (!teacher.ok) return c.json({ error: teacher.error }, teacher.status)
  const constraints = await c.env.DB.prepare(`
    SELECT * FROM timetable_teacher_constraints
    WHERE school_id = ? AND academic_year_id = ? AND employee_id = ?
  `).bind(schoolId, validation.value.academicYearId, validation.value.employeeId).first<TimetableTeacherConstraints>()
  return c.json({ data: constraints || emptyTimetableTeacherConstraints(
    schoolId,
    validation.value.academicYearId,
    validation.value.employeeId,
  ) })
})

app.put('/api/timetable/teacher-constraints', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  try {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: 'بيانات قيود المدرس غير صالحة' }, 400)
    const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    const validation = validateTeacherConstraintsInput(body)
    if (!validation.ok) return c.json({ error: validation.error }, 400)
    const year = await validateTimetableAcademicYear(c.env.DB, targetSchool.schoolId, validation.value.academicYearId)
    if (!year.ok) return c.json({ error: year.error }, year.status)
    const teacher = await validateTimetableTeacherReference(
      c.env.DB,
      targetSchool.schoolId,
      validation.value.employeeId,
      true,
    )
    if (!teacher.ok) return c.json({ error: teacher.error }, teacher.status)
    await c.env.DB.prepare(`
      INSERT INTO timetable_teacher_constraints (
        school_id, academic_year_id, employee_id,
        max_periods_per_day, max_consecutive_periods, max_working_days,
        prefer_compact_schedule, avoid_first_period, avoid_last_period,
        created_by_user_id, updated_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(school_id, academic_year_id, employee_id) DO UPDATE SET
        max_periods_per_day = excluded.max_periods_per_day,
        max_consecutive_periods = excluded.max_consecutive_periods,
        max_working_days = excluded.max_working_days,
        prefer_compact_schedule = excluded.prefer_compact_schedule,
        avoid_first_period = excluded.avoid_first_period,
        avoid_last_period = excluded.avoid_last_period,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = unixepoch()
    `).bind(
      targetSchool.schoolId,
      validation.value.academicYearId,
      validation.value.employeeId,
      validation.value.maxPeriodsPerDay,
      validation.value.maxConsecutivePeriods,
      validation.value.maxWorkingDays,
      validation.value.preferCompactSchedule,
      validation.value.avoidFirstPeriod,
      validation.value.avoidLastPeriod,
      user.id,
      user.id,
    ).run()
    const constraints = await c.env.DB.prepare(`
      SELECT * FROM timetable_teacher_constraints
      WHERE school_id = ? AND academic_year_id = ? AND employee_id = ?
    `).bind(
      targetSchool.schoolId,
      validation.value.academicYearId,
      validation.value.employeeId,
    ).first<TimetableTeacherConstraints>()
    return c.json({ data: constraints })
  } catch (error) {
    if (isTimetableConstraintError(error)) return c.json({ error: 'تعذر حفظ قيود المدرس بسبب قيمة أو مرجع غير صالح' }, 400)
    return c.json({ error: 'فشل في حفظ قيود المدرس' }, 500)
  }
})

app.get('/api/timetable/teacher-availability-summary', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const schoolId: number | null = c.get('resolvedSchoolId')
  if (schoolId == null) return c.json({ error: 'يجب تحديد مدرسة لعرض ملخص توفر المدرس' }, 400)
  const validation = validateTeacherAvailabilityScopeInput({
    academic_year_id: c.req.query('academic_year_id'),
    employee_id: c.req.query('employee_id'),
  })
  if (!validation.ok) return c.json({ error: validation.error }, 400)
  const year = await validateTimetableAcademicYear(c.env.DB, schoolId, validation.value.academicYearId)
  if (!year.ok) return c.json({ error: year.error }, year.status)
  const teacher = await validateTimetableTeacherReference(c.env.DB, schoolId, validation.value.employeeId, false)
  if (!teacher.ok) return c.json({ error: teacher.error }, teacher.status)
  try {
    const matrix = await loadTeacherAvailabilityMatrix(
      c.env.DB,
      schoolId,
      validation.value.academicYearId,
      teacher.teacher!,
    )
    return c.json({ data: matrix.summary })
  } catch {
    return c.json({ error: 'فشل في حساب ملخص توفر المدرس' }, 500)
  }
})

app.get('/api/timetable/readiness', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const schoolId: number | null = c.get('resolvedSchoolId')
  const academicYearId = Number(c.req.query('academic_year_id'))
  if (schoolId == null) return c.json({ error: 'يجب تحديد مدرسة للتحقق من الجاهزية' }, 400)
  if (!Number.isInteger(academicYearId) || academicYearId <= 0) return c.json({ error: 'السنة الدراسية مطلوبة' }, 400)
  const year = await validateTimetableAcademicYear(c.env.DB, schoolId, academicYearId)
  if (!year.ok) return c.json({ error: year.error }, year.status)
  try {
    return c.json({ data: await loadTimetableReadinessSummary(c.env.DB, schoolId, academicYearId) })
  } catch {
    return c.json({ error: 'فشل في حساب جاهزية الجدول الدراسي' }, 500)
  }
})

app.get('/api/timetable/teacher-workloads', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const schoolId: number | null = c.get('resolvedSchoolId')
  const academicYearId = Number(c.req.query('academic_year_id'))
  if (schoolId == null) return c.json({ error: 'يجب تحديد مدرسة لعرض أنصبة المدرسين' }, 400)
  if (!Number.isInteger(academicYearId) || academicYearId <= 0) return c.json({ error: 'السنة الدراسية مطلوبة' }, 400)
  const year = await validateTimetableAcademicYear(c.env.DB, schoolId, academicYearId)
  if (!year.ok) return c.json({ error: year.error }, year.status)
  try {
    const summary = await loadTimetableReadinessSummary(c.env.DB, schoolId, academicYearId)
    return c.json({ data: summary.teacher_workloads })
  } catch {
    return c.json({ error: 'فشل في حساب إجمالي أنصبة المدرسين' }, 500)
  }
})

app.post('/api/timetable/solver/preview', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const body = await readJsonObject(c)
  if (!body) return c.json({ error: 'بيانات طلب التوليد غير صالحة' }, 400)
  if (!hasOnlyObjectKeys(body, ['school_id', 'academic_year_id', 'fixed_entries', 'use_current_locked_entries'])) {
    return c.json({ error: 'يحتوي طلب التوليد على حقول غير معروفة' }, 400)
  }
  const user: UserContext | null = c.get('user') || null
  const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
  if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
  const academicYearId = Number(body.academic_year_id)
  if (!Number.isInteger(academicYearId) || academicYearId <= 0) {
    return c.json({ error: 'السنة الدراسية مطلوبة' }, 400)
  }
  const year = await validateTimetableAcademicYear(c.env.DB, targetSchool.schoolId, academicYearId)
  if (!year.ok) return c.json({ error: year.error, code: year.code }, year.status)
  if (body.use_current_locked_entries != null && typeof body.use_current_locked_entries !== 'boolean') {
    return c.json({ error: 'وضع إعادة تحسين الجدول الحالي غير صالح' }, 400)
  }
  const fixedValidation = parseTimetableFixedEntries(body.fixed_entries)
  if (!fixedValidation.ok) return c.json({ error: fixedValidation.error }, 400)

  try {
    const [context, placementsResult, timetableRevision] = await Promise.all([
      loadTimetableSchedulingContext(c.env.DB, targetSchool.schoolId, academicYearId),
      c.env.DB.prepare(`
        SELECT class.id AS class_id, class.name AS class_name,
               section.id AS section_id, section.name AS section_name
        FROM classes class
        LEFT JOIN sections section
          ON section.school_id = class.school_id
         AND section.class_id = class.id
         AND section.status = 'active'
        WHERE class.school_id = ? AND class.status = 'active'
        ORDER BY class.order_index, class.id, section.id
      `).bind(targetSchool.schoolId).all<TimetablePlacement>(),
      loadCurrentTimetableRevision(c.env.DB, targetSchool.schoolId, academicYearId),
    ])
    const fixedEntries = body.use_current_locked_entries === true
      ? context.entries.filter((entry) => Number(entry.is_locked) === 1).map((entry) => ({
        slot_id: Number(entry.slot_id),
        teaching_load_id: Number(entry.teaching_load_id),
      }))
      : fixedValidation.entries
    const solverData = solveTimetable({
      schoolId: targetSchool.schoolId,
      academicYearId,
      days: context.days,
      slots: context.slots,
      placements: placementsResult.results || [],
      loads: context.loads,
      currentEntries: context.entries,
      teacherAvailability: context.availability,
      teacherConstraints: context.constraints,
      fixedEntries,
    })
    const proposalEntries = solverData.entries.map((entry) => ({
      slot_id: entry.slot_id,
      teaching_load_id: entry.teaching_load_id,
      is_locked: entry.is_locked,
    }))
    const data: TimetableSolverProposalWithIntegrity = {
      ...solverData,
      timetable_revision: timetableRevision,
      proposal_digest: await computeTimetableProposalDigest({
        schoolId: targetSchool.schoolId,
        academicYearId,
        revision: timetableRevision,
        entries: proposalEntries,
      }),
    }
    return c.json({ data })
  } catch (error) {
    console.error('[timetable/solver/preview] failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    })
    return c.json({ error: 'فشل في إنشاء اقتراح جدول صالح' }, 500)
  }
})

app.post('/api/timetable/solver/adoption-preview', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  const body = await readJsonObject(c)
  if (!body || !hasOnlyObjectKeys(body, [
    'school_id', 'academic_year_id', 'proposal_revision', 'proposal_digest', 'entries',
  ])) return c.json({ error: 'بيانات معاينة الاعتماد غير صالحة أو تحتوي على حقول غير معروفة' }, 400)
  const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
  if (!targetSchool.ok) return c.json({ error: targetSchool.error, code: 'invalid_tenant_scope' }, targetSchool.status)
  const academicYearId = Number(body.academic_year_id)
  if (!Number.isInteger(academicYearId) || academicYearId <= 0) return c.json({ error: 'السنة الدراسية مطلوبة' }, 400)
  const parsed = parseTimetableProposalPayload(body, 'proposal_revision')
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)
  const year = await validateTimetableAcademicYear(c.env.DB, targetSchool.schoolId, academicYearId)
  if (!year.ok) return c.json({ error: year.error, code: year.code }, year.status)
  try {
    const [revision, context] = await Promise.all([
      loadCurrentTimetableRevision(c.env.DB, targetSchool.schoolId, academicYearId),
      loadTimetableSchedulingContext(c.env.DB, targetSchool.schoolId, academicYearId),
    ])
    if (revision !== parsed.revision) {
      return c.json({ error: STALE_TIMETABLE_PROPOSAL_MESSAGE, code: STALE_TIMETABLE_PROPOSAL_CODE }, 409)
    }
    const data = await buildTimetableAdoptionPreview({
      schoolId: targetSchool.schoolId,
      academicYearId,
      revision,
      digest: parsed.digest,
      entries: parsed.entries,
      context,
      options: { validationMode: 'complete', preserveCurrentLocks: true },
    })
    return c.json({ data })
  } catch {
    return c.json({ error: 'فشل في معاينة اعتماد الجدول' }, 500)
  }
})

app.post('/api/timetable/solver/apply', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  const body = await readJsonObject(c)
  if (!body || !hasOnlyObjectKeys(body, [
    'school_id', 'academic_year_id', 'expected_revision', 'proposal_digest', 'entries', 'confirm_apply',
  ])) return c.json({ error: 'بيانات اعتماد الجدول غير صالحة أو تحتوي على حقول غير معروفة' }, 400)
  if (body.confirm_apply !== true) return c.json({ error: 'يلزم تأكيد اعتماد الجدول الرسمي' }, 400)
  const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
  if (!targetSchool.ok) return c.json({ error: targetSchool.error, code: 'invalid_tenant_scope' }, targetSchool.status)
  const academicYearId = Number(body.academic_year_id)
  if (!Number.isInteger(academicYearId) || academicYearId <= 0) return c.json({ error: 'السنة الدراسية مطلوبة' }, 400)
  const parsed = parseTimetableProposalPayload(body, 'expected_revision')
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)
  const year = await validateTimetableAcademicYear(c.env.DB, targetSchool.schoolId, academicYearId)
  if (!year.ok) return c.json({ error: year.error, code: year.code }, year.status)
  try {
    const [revision, context] = await Promise.all([
      loadCurrentTimetableRevision(c.env.DB, targetSchool.schoolId, academicYearId),
      loadTimetableSchedulingContext(c.env.DB, targetSchool.schoolId, academicYearId),
    ])
    if (revision !== parsed.revision) {
      return c.json({ error: STALE_TIMETABLE_PROPOSAL_MESSAGE, code: STALE_TIMETABLE_PROPOSAL_CODE }, 409)
    }
    const preview = await buildTimetableAdoptionPreview({
      schoolId: targetSchool.schoolId,
      academicYearId,
      revision,
      digest: parsed.digest,
      entries: parsed.entries,
      context,
      options: { validationMode: 'complete', preserveCurrentLocks: true },
    })
    if (!preview.can_apply) {
      const status = preview.blockers.some((blocker) => blocker.code === 'proposal_digest_mismatch') ? 409 : 400
      return c.json({ error: 'لا يمكن اعتماد مقترح غير مكتمل أو غير صالح', code: 'invalid_timetable_proposal', data: preview }, status)
    }
    const applied = await replaceOfficialTimetableAtomically({
      db: c.env.DB,
      schoolId: targetSchool.schoolId,
      academicYearId,
      expectedRevision: revision,
      digest: parsed.digest,
      entries: parsed.entries,
      userId: user.id,
      source: 'automatic_adoption',
    })
    return c.json({
      data: {
        applied: true,
        message: 'تم اعتماد الجدول بنجاح',
        revision: applied.revision,
        previous_version: applied.version,
        entry_count: parsed.entries.length,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/stale_timetable_proposal/i.test(message)) {
      return c.json({ error: STALE_TIMETABLE_PROPOSAL_MESSAGE, code: STALE_TIMETABLE_PROPOSAL_CODE }, 409)
    }
    const conflict = timetableEntryConstraintError(error)
    if (conflict) return c.json({ error: conflict.error, code: conflict.code }, conflict.status)
    return c.json({ error: 'فشل في اعتماد الجدول ولم يتم تغيير الجدول الحالي' }, 500)
  }
})

app.get('/api/timetable/versions', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const schoolId: number | null = c.get('resolvedSchoolId')
  const academicYearId = Number(c.req.query('academic_year_id'))
  if (schoolId == null) return c.json({ error: 'يجب تحديد مدرسة لعرض إصدارات الجدول' }, 400)
  if (!Number.isInteger(academicYearId) || academicYearId <= 0) return c.json({ error: 'السنة الدراسية مطلوبة' }, 400)
  const year = await validateTimetableAcademicYear(c.env.DB, schoolId, academicYearId)
  if (!year.ok) return c.json({ error: year.error, code: year.code }, year.status)
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT version.*, user.full_name AS created_by_name
      FROM timetable_schedule_versions version
      LEFT JOIN users user ON user.id = version.created_by_user_id
      WHERE version.school_id = ? AND version.academic_year_id = ?
      ORDER BY version.created_at DESC, version.id DESC
      LIMIT 100
    `).bind(schoolId, academicYearId).all<TimetableScheduleVersion>()
    return c.json({ data: results || [] })
  } catch {
    return c.json({ error: 'فشل في جلب إصدارات الجدول' }, 500)
  }
})

app.get('/api/timetable/versions/:id', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const schoolId: number | null = c.get('resolvedSchoolId')
  const academicYearId = Number(c.req.query('academic_year_id'))
  const versionId = Number(c.req.param('id'))
  if (schoolId == null) return c.json({ error: 'يجب تحديد مدرسة لعرض إصدار الجدول' }, 400)
  if (!Number.isInteger(academicYearId) || academicYearId <= 0 || !Number.isInteger(versionId) || versionId <= 0) {
    return c.json({ error: 'معرف الإصدار أو السنة الدراسية غير صالح' }, 400)
  }
  try {
    const version = await loadTimetableScheduleVersion(c.env.DB, versionId)
    if (!version) return c.json({ error: 'إصدار الجدول غير موجود' }, 404)
    if (Number(version.school_id) !== schoolId) return c.json({ error: 'غير مسموح: الإصدار من مدرسة أخرى' }, 403)
    if (Number(version.academic_year_id) !== academicYearId) return c.json({ error: 'الإصدار من سنة دراسية أخرى' }, 400)
    return c.json({ data: version })
  } catch {
    return c.json({ error: 'فشل في عرض إصدار الجدول' }, 500)
  }
})

app.post('/api/timetable/versions/:id/restore-preview', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  const versionId = Number(c.req.param('id'))
  const body = await readJsonObject(c)
  if (!body || !hasOnlyObjectKeys(body, ['school_id', 'academic_year_id'])
    || !Number.isInteger(versionId) || versionId <= 0) {
    return c.json({ error: 'بيانات معاينة الاستعادة غير صالحة' }, 400)
  }
  const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
  if (!targetSchool.ok) return c.json({ error: targetSchool.error, code: 'invalid_tenant_scope' }, targetSchool.status)
  const academicYearId = Number(body.academic_year_id)
  if (!Number.isInteger(academicYearId) || academicYearId <= 0) return c.json({ error: 'السنة الدراسية مطلوبة' }, 400)
  try {
    const version = await loadTimetableScheduleVersion(c.env.DB, versionId)
    if (!version) return c.json({ error: 'إصدار الجدول غير موجود' }, 404)
    if (Number(version.school_id) !== targetSchool.schoolId) return c.json({ error: 'غير مسموح: الإصدار من مدرسة أخرى' }, 403)
    if (Number(version.academic_year_id) !== academicYearId) return c.json({ error: 'الإصدار من سنة دراسية أخرى' }, 400)
    const [revision, context] = await Promise.all([
      loadCurrentTimetableRevision(c.env.DB, targetSchool.schoolId, academicYearId),
      loadTimetableSchedulingContext(c.env.DB, targetSchool.schoolId, academicYearId),
    ])
    const entries = canonicalTimetableProposalEntries(version.entries)
    const digest = await computeTimetableProposalDigest({
      schoolId: targetSchool.schoolId,
      academicYearId,
      revision,
      entries,
    })
    const preview = await buildTimetableAdoptionPreview({
      schoolId: targetSchool.schoolId,
      academicYearId,
      revision,
      digest,
      entries,
      context,
      options: { validationMode: 'restore', preserveCurrentLocks: false },
    })
    const invalidHistoricalEntryKeys = new Set(preview.blockers
      .filter((blocker) => blocker.slot_id != null && blocker.teaching_load_id != null)
      .map((blocker) => `${blocker.slot_id}:${blocker.teaching_load_id}`))
    const data: TimetableRestorePreview = {
      ...preview,
      version,
      restorable_entry_count: Math.max(0, entries.length - invalidHistoricalEntryKeys.size),
      invalid_historical_entry_count: invalidHistoricalEntryKeys.size,
    }
    return c.json({ data })
  } catch {
    return c.json({ error: 'فشل في معاينة استعادة إصدار الجدول' }, 500)
  }
})

app.post('/api/timetable/versions/:id/restore', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  const versionId = Number(c.req.param('id'))
  const body = await readJsonObject(c)
  if (!body || !hasOnlyObjectKeys(body, [
    'school_id', 'academic_year_id', 'expected_revision', 'proposal_digest', 'confirm_restore',
  ]) || !Number.isInteger(versionId) || versionId <= 0) {
    return c.json({ error: 'بيانات استعادة الإصدار غير صالحة أو تحتوي على حقول غير معروفة' }, 400)
  }
  if (body.confirm_restore !== true) return c.json({ error: 'يلزم تأكيد استعادة إصدار الجدول' }, 400)
  const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
  if (!targetSchool.ok) return c.json({ error: targetSchool.error, code: 'invalid_tenant_scope' }, targetSchool.status)
  const academicYearId = Number(body.academic_year_id)
  const expectedRevision = Number(body.expected_revision)
  const digest = typeof body.proposal_digest === 'string' ? body.proposal_digest.trim().toLowerCase() : ''
  if (!Number.isInteger(academicYearId) || academicYearId <= 0
    || !Number.isInteger(expectedRevision) || expectedRevision < 0
    || !/^[a-f0-9]{64}$/.test(digest)) return c.json({ error: 'سياق الاستعادة غير صالح' }, 400)
  try {
    const version = await loadTimetableScheduleVersion(c.env.DB, versionId)
    if (!version) return c.json({ error: 'إصدار الجدول غير موجود' }, 404)
    if (Number(version.school_id) !== targetSchool.schoolId) return c.json({ error: 'غير مسموح: الإصدار من مدرسة أخرى' }, 403)
    if (Number(version.academic_year_id) !== academicYearId) return c.json({ error: 'الإصدار من سنة دراسية أخرى' }, 400)
    const [revision, context] = await Promise.all([
      loadCurrentTimetableRevision(c.env.DB, targetSchool.schoolId, academicYearId),
      loadTimetableSchedulingContext(c.env.DB, targetSchool.schoolId, academicYearId),
    ])
    if (revision !== expectedRevision) {
      return c.json({ error: STALE_TIMETABLE_PROPOSAL_MESSAGE, code: STALE_TIMETABLE_PROPOSAL_CODE }, 409)
    }
    const entries = canonicalTimetableProposalEntries(version.entries)
    const preview = await buildTimetableAdoptionPreview({
      schoolId: targetSchool.schoolId,
      academicYearId,
      revision,
      digest,
      entries,
      context,
      options: { validationMode: 'restore', preserveCurrentLocks: false },
    })
    if (!preview.can_apply) {
      return c.json({ error: 'لم يعد هذا الإصدار صالحًا للاستعادة الكاملة', code: 'invalid_timetable_restore', data: preview }, 400)
    }
    const restored = await replaceOfficialTimetableAtomically({
      db: c.env.DB,
      schoolId: targetSchool.schoolId,
      academicYearId,
      expectedRevision,
      digest,
      entries,
      userId: user.id,
      source: 'manual_restore',
      restoredFromVersionId: versionId,
    })
    return c.json({ data: { restored: true, revision: restored.revision, previous_version: restored.version } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/stale_timetable_proposal/i.test(message)) {
      return c.json({ error: STALE_TIMETABLE_PROPOSAL_MESSAGE, code: STALE_TIMETABLE_PROPOSAL_CODE }, 409)
    }
    return c.json({ error: 'فشل في استعادة الإصدار ولم يتم تغيير الجدول الحالي' }, 500)
  }
})

app.get('/api/timetable/master-grid', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const schoolId: number | null = c.get('resolvedSchoolId')
  const academicYearId = Number(c.req.query('academic_year_id'))
  if (schoolId == null) {
    return c.json({ error: 'يجب تحديد مدرسة لعرض الجدول الكامل', code: 'invalid_tenant_scope' }, 400)
  }
  if (!Number.isInteger(academicYearId) || academicYearId <= 0) {
    return c.json({ error: 'السنة الدراسية مطلوبة' }, 400)
  }
  const yearValidation = await validateTimetableAcademicYear(c.env.DB, schoolId, academicYearId)
  if (!yearValidation.ok) {
    return c.json({ error: yearValidation.error, code: yearValidation.code }, yearValidation.status)
  }
  try {
    const [school, academicYear, context, classesResult, sectionsResult, subjectsResult, teachersResult] = await Promise.all([
      c.env.DB.prepare(`
        SELECT id, name, logo_url FROM schools
        WHERE id = ? AND status = 'active'
      `).bind(schoolId).first<{ id: number; name: string; logo_url: string | null }>(),
      c.env.DB.prepare(`
        SELECT id, name FROM academic_years
        WHERE id = ? AND school_id = ?
      `).bind(academicYearId, schoolId).first<{ id: number; name: string }>(),
      loadTimetableSchedulingContext(c.env.DB, schoolId, academicYearId),
      c.env.DB.prepare(`
        SELECT id, school_id, name, stage, order_index, status
        FROM classes
        WHERE school_id = ? AND status = 'active'
        ORDER BY order_index, id
      `).bind(schoolId).all<TimetableMasterClass>(),
      c.env.DB.prepare(`
        SELECT section.id, section.school_id, section.class_id, section.name, section.status
        FROM sections section
        JOIN classes class ON class.id = section.class_id AND class.school_id = section.school_id
        WHERE section.school_id = ? AND section.status = 'active' AND class.status = 'active'
        ORDER BY class.order_index, class.id, section.id
      `).bind(schoolId).all<TimetableMasterSection>(),
      c.env.DB.prepare(`
        SELECT subject.id, subject.school_id, subject.class_id, subject.section_id,
               subject.name, subject.status
        FROM subjects subject
        JOIN classes class
          ON class.id = subject.class_id
         AND class.school_id = subject.school_id
         AND class.status = 'active'
        LEFT JOIN sections section ON section.id = subject.section_id
        WHERE subject.school_id = ?
          AND subject.status = 'active'
          AND (subject.section_id IS NULL OR (
            section.school_id = subject.school_id
            AND section.class_id = subject.class_id
            AND section.status = 'active'
          ))
        ORDER BY subject.class_id, subject.order_index, subject.id
      `).bind(schoolId).all<TimetableMasterSubject>(),
      c.env.DB.prepare(`
        SELECT id, school_id, full_name, role, status
        FROM employees
        WHERE school_id = ? AND status = 'active' AND role = 'teacher'
        ORDER BY full_name, id
      `).bind(schoolId).all<TimetableMasterTeacher>(),
    ])
    if (!school) return c.json({ error: 'المدرسة غير موجودة أو غير نشطة' }, 404)
    if (!academicYear) return c.json({ error: 'السنة الدراسية غير موجودة' }, 404)

    const activeDays = context.days.filter((day) => Number(day.is_active) === 1)
    const activeDayNumbers = new Set(activeDays.map((day) => Number(day.day_of_week)))
    const visibleSlots = context.slots.filter((slot) => (
      Number(slot.is_active) === 1 && activeDayNumbers.has(Number(slot.day_of_week))
    ))
    const activeLessonSlotIds = new Set(visibleSlots
      .filter((slot) => slot.slot_type === 'lesson')
      .map((slot) => Number(slot.id)))

    const evaluatedEntries = context.entries.map((entry) => {
      const load = context.loads.find((item) => Number(item.id) === Number(entry.teaching_load_id))
      if (!load) {
        return {
          entry: null,
          invalid: {
            id: Number(entry.id),
            slot_id: Number(entry.slot_id),
            teaching_load_id: Number(entry.teaching_load_id),
            hard_conflicts: [{ code: 'invalid_teaching_load' as const, message: 'نصاب المادة غير موجود أو خارج نطاق المدرسة' }],
            reason: 'invalid' as const,
          },
        }
      }
      const evaluation = evaluateTimetableEntryPlacement({
        candidate: { id: entry.id, slot_id: entry.slot_id, teaching_load_id: entry.teaching_load_id },
        days: context.days,
        slots: context.slots,
        loads: context.loads,
        entries: context.entries,
        teacherAvailability: context.availability,
        teacherConstraints: context.constraints,
      })
      return {
        entry: timetableGridEntry(entry, load, evaluation.warnings, evaluation.hard_conflicts),
        invalid: null,
      }
    })
    const entries = evaluatedEntries
      .filter((item) => item.entry != null && activeLessonSlotIds.has(Number(item.entry.slot_id)) && item.entry.hard_conflicts.length === 0)
      .map((item) => item.entry!)
    const invalidEntries = evaluatedEntries
      .filter((item) => item.invalid != null || (item.entry != null && (
        !activeLessonSlotIds.has(Number(item.entry.slot_id)) || item.entry.hard_conflicts.length > 0
      )))
      .map((item) => item.invalid || ({
        id: Number(item.entry!.id),
        slot_id: Number(item.entry!.slot_id),
        teaching_load_id: Number(item.entry!.teaching_load_id),
        hard_conflicts: item.entry!.hard_conflicts,
        reason: item.entry!.hard_conflicts.length > 0 ? 'invalid' as const : 'historical' as const,
      }))
    const data: TimetableMasterGridData = {
      school,
      academic_year: academicYear,
      days: activeDays,
      slots: visibleSlots,
      classes: classesResult.results || [],
      sections: sectionsResult.results || [],
      subjects: subjectsResult.results || [],
      teachers: teachersResult.results || [],
      loads: context.loads.filter((load) => (
        load.status === 'active'
        && !loadHasInvalidAcademicReference(load)
        && !loadHasInvalidTeacherReference(load)
      )),
      entries,
      invalid_entries: invalidEntries,
      invalid_entry_count: invalidEntries.length,
    }
    return c.json({ data })
  } catch {
    return c.json({ error: 'فشل في تحميل الجدول الكامل' }, 500)
  }
})

app.get('/api/timetable/grid', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const schoolId: number | null = c.get('resolvedSchoolId')
  if (schoolId == null) return c.json({ error: 'يجب تحديد مدرسة لعرض الجدول الأسبوعي', code: 'invalid_tenant_scope' }, 400)
  const validation = validateTimetableGridScopeInput({
    academic_year_id: c.req.query('academic_year_id'),
    class_id: c.req.query('class_id'),
    section_id: c.req.query('section_id'),
  })
  if (!validation.ok) return c.json({ error: validation.error }, 400)
  const year = await validateTimetableAcademicYear(c.env.DB, schoolId, validation.value.academicYearId)
  if (!year.ok) return c.json({ error: year.error, code: year.code }, year.status)
  const placement = await validateTimetableGridReferences(
    c.env.DB,
    schoolId,
    validation.value.classId,
    validation.value.sectionId,
  )
  if (!placement.ok) return c.json({ error: placement.error, code: placement.code }, placement.status)
  try {
    const context = await loadTimetableSchedulingContext(c.env.DB, schoolId, validation.value.academicYearId)
    const activeDayNumbers = new Set(context.days.filter((day) => Number(day.is_active) === 1).map((day) => Number(day.day_of_week)))
    const visibleSlots = context.slots.filter((slot) => (
      Number(slot.is_active) === 1 && activeDayNumbers.has(Number(slot.day_of_week))
    ))
    const scopedLoads = context.loads.filter((load) => (
      Number(load.class_id) === validation.value.classId
      && (validation.value.sectionId == null
        ? load.section_id == null
        : load.section_id == null || Number(load.section_id) === validation.value.sectionId)
    ))
    const scopedLoadIds = new Set(scopedLoads.map((load) => Number(load.id)))
    const scopedEntries = context.entries.filter((entry) => scopedLoadIds.has(Number(entry.teaching_load_id)))
    const placedLoadIds = new Set(scopedEntries.map((entry) => Number(entry.teaching_load_id)))
    const relevantLoads = scopedLoads.filter((load) => (
      load.status === 'active' || placedLoadIds.has(Number(load.id))
    ))
    const activeLessonSlotIds = new Set(visibleSlots.filter((slot) => slot.slot_type === 'lesson').map((slot) => Number(slot.id)))
    const evaluatedEntries = scopedEntries
      .map((entry) => {
        const load = scopedLoads.find((item) => Number(item.id) === Number(entry.teaching_load_id))!
        const slot = context.slots.find((item) => Number(item.id) === Number(entry.slot_id)) || null
        const day = slot == null ? null : context.days.find((item) => (
          Number(item.school_id) === Number(slot.school_id)
          && Number(item.academic_year_id) === Number(slot.academic_year_id)
          && Number(item.day_of_week) === Number(slot.day_of_week)
        )) || null
        const evaluation = evaluateTimetableEntryPlacement({
          candidate: { id: entry.id, slot_id: entry.slot_id, teaching_load_id: entry.teaching_load_id },
          days: context.days,
          slots: context.slots,
          loads: context.loads,
          entries: context.entries,
          teacherAvailability: context.availability,
          teacherConstraints: context.constraints,
        })
        return {
          entry: timetableGridEntry(entry, load, evaluation.warnings, evaluation.hard_conflicts),
          slot,
          day,
        }
      })
    const gridEntries = evaluatedEntries
      .filter((item) => activeLessonSlotIds.has(Number(item.entry.slot_id)))
      .map((item) => item.entry)
    const historicalEntries = evaluatedEntries
      .filter((item) => !activeLessonSlotIds.has(Number(item.entry.slot_id)))
      .map((item) => ({ ...item.entry, slot: item.slot, day: item.day }))
    const scheduledByLoad = new Map<number, number>()
    const totalByLoad = new Map<number, number>()
    const invalidByLoad = new Map<number, number>()
    for (const item of evaluatedEntries) {
      const loadId = Number(item.entry.teaching_load_id)
      totalByLoad.set(loadId, (totalByLoad.get(loadId) || 0) + 1)
      if (item.entry.hard_conflicts.length > 0) {
        invalidByLoad.set(loadId, (invalidByLoad.get(loadId) || 0) + 1)
        continue
      }
      scheduledByLoad.set(loadId, (scheduledByLoad.get(loadId) || 0) + 1)
    }
    const data: TimetableGridData = {
      school_id: schoolId,
      academic_year_id: validation.value.academicYearId,
      class_id: validation.value.classId,
      section_id: validation.value.sectionId,
      days: context.days.filter((day) => Number(day.is_active) === 1),
      slots: visibleSlots,
      entries: gridEntries,
      historical_entries: historicalEntries,
      loads: relevantLoads.map((load) => {
        const scheduledPeriods = scheduledByLoad.get(Number(load.id)) || 0
        return {
          ...load,
          total_placements: totalByLoad.get(Number(load.id)) || 0,
          scheduled_periods: scheduledPeriods,
          invalid_placements: invalidByLoad.get(Number(load.id)) || 0,
          remaining_periods: Math.max(0, Number(load.weekly_periods) - scheduledPeriods),
        }
      }),
    }
    return c.json({ data })
  } catch {
    return c.json({ error: 'فشل في تحميل الجدول الأسبوعي' }, 500)
  }
})

app.post('/api/timetable/entries', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  try {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: 'بيانات الحصة غير صالحة' }, 400)
    const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error, code: 'invalid_tenant_scope' }, targetSchool.status)
    const validation = validateTimetableEntryInput(body)
    if (!validation.ok || validation.value.teachingLoadId == null) return c.json({ error: validation.error }, 400)
    const year = await validateTimetableAcademicYear(c.env.DB, targetSchool.schoolId, validation.value.academicYearId)
    if (!year.ok) return c.json({ error: year.error, code: year.code }, year.status)
    const context = await loadTimetableSchedulingContext(c.env.DB, targetSchool.schoolId, validation.value.academicYearId)
    const references = await validateTimetableEntryReferences(
      c.env.DB,
      context,
      targetSchool.schoolId,
      validation.value.academicYearId,
      validation.value.slotId,
      validation.value.teachingLoadId,
    )
    if (!references.ok) return c.json({ error: references.error, code: references.code }, references.status)
    const evaluation = evaluateTimetableEntryPlacement({
      candidate: { slot_id: validation.value.slotId, teaching_load_id: validation.value.teachingLoadId },
      days: context.days,
      slots: context.slots,
      loads: context.loads,
      entries: context.entries,
      teacherAvailability: context.availability,
      teacherConstraints: context.constraints,
    })
    const hardConflict = evaluation.hard_conflicts[0]
    if (hardConflict) return c.json(
      { error: hardConflict.message, code: hardConflict.code },
      timetableEntryNoticeStatus(hardConflict),
    )
    const result = await c.env.DB.prepare(`
      INSERT INTO timetable_entries (
        school_id, academic_year_id, slot_id, teaching_load_id,
        created_by_user_id, updated_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      targetSchool.schoolId,
      validation.value.academicYearId,
      validation.value.slotId,
      validation.value.teachingLoadId,
      user.id,
      user.id,
    ).run()
    const entry = await c.env.DB.prepare('SELECT * FROM timetable_entries WHERE id = ? AND school_id = ?')
      .bind(result.meta?.last_row_id, targetSchool.schoolId).first<TimetableEntry>()
    const load = context.loads.find((item) => Number(item.id) === validation.value.teachingLoadId)!
    return c.json({ data: entry ? timetableGridEntry(entry, load, evaluation.warnings) : entry, meta: { warnings: evaluation.warnings } }, 201)
  } catch (error) {
    const conflict = timetableEntryConstraintError(error)
    if (conflict) return c.json({ error: conflict.error, code: conflict.code }, conflict.status)
    return c.json({ error: 'فشل في جدولة الحصة' }, 500)
  }
})

app.put('/api/timetable/entries/:id/lock', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  const id = Number(c.req.param('id'))
  const body = await readJsonObject(c)
  if (!body || !hasOnlyObjectKeys(body, ['school_id', 'academic_year_id', 'is_locked'])
    || !Number.isInteger(id) || id <= 0) return c.json({ error: 'بيانات تثبيت الحصة غير صالحة' }, 400)
  const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
  if (!targetSchool.ok) return c.json({ error: targetSchool.error, code: 'invalid_tenant_scope' }, targetSchool.status)
  const academicYearId = Number(body.academic_year_id)
  const isLocked = Number(body.is_locked)
  if (!Number.isInteger(academicYearId) || academicYearId <= 0 || ![0, 1].includes(isLocked)) {
    return c.json({ error: 'السنة الدراسية أو حالة التثبيت غير صالحة' }, 400)
  }
  try {
    const existing = await c.env.DB.prepare('SELECT * FROM timetable_entries WHERE id = ?')
      .bind(id).first<TimetableEntry>()
    if (!existing) return c.json({ error: 'الحصة المجدولة غير موجودة' }, 404)
    if (Number(existing.school_id) !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: الحصة المجدولة من مدرسة أخرى', code: 'invalid_tenant_scope' }, 403)
    }
    if (Number(existing.academic_year_id) !== academicYearId) {
      return c.json({ error: 'الحصة المجدولة لا تنتمي إلى السنة الدراسية المحددة', code: 'invalid_academic_year' }, 400)
    }
    if (Number(existing.is_locked) !== isLocked) {
      if (Number(existing.is_locked) === 1) {
        const overrideToken = crypto.randomUUID()
        await c.env.DB.batch([
          c.env.DB.prepare(`
            INSERT INTO timetable_locked_entry_overrides
              (token, entry_id, school_id, academic_year_id, action)
            VALUES (?, ?, ?, ?, 'unlock')
          `).bind(overrideToken, id, targetSchool.schoolId, academicYearId),
          c.env.DB.prepare(`
            UPDATE timetable_entries
            SET is_locked = 0, updated_by_user_id = ?, updated_at = unixepoch()
            WHERE id = ? AND school_id = ? AND academic_year_id = ?
          `).bind(user.id, id, targetSchool.schoolId, academicYearId),
          c.env.DB.prepare('DELETE FROM timetable_locked_entry_overrides WHERE token = ?').bind(overrideToken),
        ])
      } else {
        await c.env.DB.prepare(`
          UPDATE timetable_entries
          SET is_locked = 1, updated_by_user_id = ?, updated_at = unixepoch()
          WHERE id = ? AND school_id = ? AND academic_year_id = ?
        `).bind(user.id, id, targetSchool.schoolId, academicYearId).run()
      }
    }
    const [entry, revision] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM timetable_entries WHERE id = ? AND school_id = ?')
        .bind(id, targetSchool.schoolId).first<TimetableEntry>(),
      loadCurrentTimetableRevision(c.env.DB, targetSchool.schoolId, academicYearId),
    ])
    return c.json({ data: { entry, revision } })
  } catch {
    return c.json({ error: 'فشل في تغيير حالة تثبيت الحصة' }, 500)
  }
})

app.put('/api/timetable/entries/:id', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'معرف الحصة غير صالح' }, 400)
  try {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: 'بيانات نقل الحصة غير صالحة' }, 400)
    const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error, code: 'invalid_tenant_scope' }, targetSchool.status)
    const validation = validateTimetableEntryInput(body, false)
    if (!validation.ok) return c.json({ error: validation.error }, 400)
    const existing = await c.env.DB.prepare('SELECT * FROM timetable_entries WHERE id = ?')
      .bind(id).first<TimetableEntry>()
    if (!existing) return c.json({ error: 'الحصة المجدولة غير موجودة' }, 404)
    if (Number(existing.school_id) !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: الحصة المجدولة من مدرسة أخرى', code: 'invalid_tenant_scope' }, 403)
    }
    if (Number(existing.academic_year_id) !== validation.value.academicYearId) {
      return c.json({ error: 'الحصة المجدولة لا تنتمي إلى السنة الدراسية المحددة', code: 'invalid_academic_year' }, 400)
    }
    if (Number(existing.is_locked) === 1 && body.confirm_unlock_locked_entry !== true) {
      return c.json({
        error: 'هذه الحصة مثبتة. يلزم تأكيد إلغاء التثبيت قبل نقلها.',
        code: 'locked_entry_requires_confirmation',
      }, 409)
    }
    if (validation.value.teachingLoadId != null
      && validation.value.teachingLoadId !== Number(existing.teaching_load_id)) {
      return c.json({ error: 'لا يمكن تغيير نصاب الحصة أثناء النقل' }, 400)
    }
    const year = await validateTimetableAcademicYear(c.env.DB, targetSchool.schoolId, validation.value.academicYearId)
    if (!year.ok) return c.json({ error: year.error, code: year.code }, year.status)
    const context = await loadTimetableSchedulingContext(c.env.DB, targetSchool.schoolId, validation.value.academicYearId)
    const references = await validateTimetableEntryReferences(
      c.env.DB,
      context,
      targetSchool.schoolId,
      validation.value.academicYearId,
      validation.value.slotId,
      Number(existing.teaching_load_id),
    )
    if (!references.ok) return c.json({ error: references.error, code: references.code }, references.status)
    const evaluation = evaluateTimetableEntryPlacement({
      candidate: { id, slot_id: validation.value.slotId, teaching_load_id: Number(existing.teaching_load_id) },
      days: context.days,
      slots: context.slots,
      loads: context.loads,
      entries: context.entries,
      teacherAvailability: context.availability,
      teacherConstraints: context.constraints,
    })
    const hardConflict = evaluation.hard_conflicts[0]
    if (hardConflict) return c.json(
      { error: hardConflict.message, code: hardConflict.code },
      timetableEntryNoticeStatus(hardConflict),
    )
    if (Number(existing.is_locked) === 1) {
      const overrideToken = crypto.randomUUID()
      await c.env.DB.batch([
        c.env.DB.prepare(`
          INSERT INTO timetable_locked_entry_overrides
            (token, entry_id, school_id, academic_year_id, action)
          VALUES (?, ?, ?, ?, 'move')
        `).bind(overrideToken, id, targetSchool.schoolId, validation.value.academicYearId),
        c.env.DB.prepare(`
          UPDATE timetable_entries
          SET slot_id = ?, is_locked = 0, updated_by_user_id = ?, updated_at = unixepoch()
          WHERE id = ? AND school_id = ? AND academic_year_id = ?
        `).bind(validation.value.slotId, user.id, id, targetSchool.schoolId, validation.value.academicYearId),
        c.env.DB.prepare('DELETE FROM timetable_locked_entry_overrides WHERE token = ?').bind(overrideToken),
      ])
    } else {
      await c.env.DB.prepare(`
        UPDATE timetable_entries
        SET slot_id = ?, updated_by_user_id = ?, updated_at = unixepoch()
        WHERE id = ? AND school_id = ? AND academic_year_id = ?
      `).bind(
        validation.value.slotId,
        user.id,
        id,
        targetSchool.schoolId,
        validation.value.academicYearId,
      ).run()
    }
    const entry = await c.env.DB.prepare('SELECT * FROM timetable_entries WHERE id = ? AND school_id = ?')
      .bind(id, targetSchool.schoolId).first<TimetableEntry>()
    const load = context.loads.find((item) => Number(item.id) === Number(existing.teaching_load_id))!
    return c.json({ data: entry ? timetableGridEntry(entry, load, evaluation.warnings) : entry, meta: { warnings: evaluation.warnings } })
  } catch (error) {
    const conflict = timetableEntryConstraintError(error)
    if (conflict) return c.json({ error: conflict.error, code: conflict.code }, conflict.status)
    return c.json({ error: 'فشل في نقل الحصة' }, 500)
  }
})

app.delete('/api/timetable/entries/:id', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const user = c.get('user') as UserContext
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'معرف الحصة غير صالح' }, 400)
  const body = await readJsonObject(c)
  if (!body) return c.json({ error: 'بيانات حذف الحصة غير صالحة' }, 400)
  const targetSchool = await resolveActiveWriteSchool(c.env.DB, user, body.school_id)
  if (!targetSchool.ok) return c.json({ error: targetSchool.error, code: 'invalid_tenant_scope' }, targetSchool.status)
  const academicYearId = Number(body.academic_year_id)
  if (!Number.isInteger(academicYearId) || academicYearId <= 0) return c.json({ error: 'السنة الدراسية مطلوبة' }, 400)
  const existing = await c.env.DB.prepare('SELECT * FROM timetable_entries WHERE id = ?')
    .bind(id).first<TimetableEntry>()
  if (!existing) return c.json({ error: 'الحصة المجدولة غير موجودة' }, 404)
  if (Number(existing.school_id) !== targetSchool.schoolId) {
    return c.json({ error: 'غير مسموح: الحصة المجدولة من مدرسة أخرى', code: 'invalid_tenant_scope' }, 403)
  }
  if (Number(existing.academic_year_id) !== academicYearId) {
    return c.json({ error: 'الحصة المجدولة لا تنتمي إلى السنة الدراسية المحددة', code: 'invalid_academic_year' }, 400)
  }
  if (Number(existing.is_locked) === 1 && body.confirm_unlock_locked_entry !== true) {
    return c.json({
      error: 'هذه الحصة مثبتة. يلزم تأكيد إلغاء التثبيت قبل حذفها.',
      code: 'locked_entry_requires_confirmation',
    }, 409)
  }
  try {
    if (Number(existing.is_locked) === 1) {
      const overrideToken = crypto.randomUUID()
      await c.env.DB.batch([
        c.env.DB.prepare(`
          INSERT INTO timetable_locked_entry_overrides
            (token, entry_id, school_id, academic_year_id, action)
          VALUES (?, ?, ?, ?, 'delete')
        `).bind(overrideToken, id, targetSchool.schoolId, academicYearId),
        c.env.DB.prepare(`
          UPDATE timetable_entries
          SET is_locked = 0, updated_by_user_id = ?, updated_at = unixepoch()
          WHERE id = ? AND school_id = ? AND academic_year_id = ?
        `).bind(user.id, id, targetSchool.schoolId, academicYearId),
        c.env.DB.prepare(`
          DELETE FROM timetable_entries
          WHERE id = ? AND school_id = ? AND academic_year_id = ?
        `).bind(id, targetSchool.schoolId, academicYearId),
        c.env.DB.prepare('DELETE FROM timetable_locked_entry_overrides WHERE token = ?').bind(overrideToken),
      ])
    } else {
      await c.env.DB.prepare(`
        DELETE FROM timetable_entries
        WHERE id = ? AND school_id = ? AND academic_year_id = ?
      `).bind(id, targetSchool.schoolId, academicYearId).run()
    }
    return c.json({ data: { id } })
  } catch {
    return c.json({ error: 'فشل في حذف الحصة المجدولة' }, 500)
  }
})

// ===========================================
// API ROUTES: Dashboard Stats (RBAC-aware)
// ===========================================
app.get('/api/dashboard/stats', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  try {
    let schoolFilter = ''
    let schoolBind: number | null = null
    if (scope === 'single' && resolvedSchoolId != null) {
      schoolFilter = 'WHERE school_id = ?'
      schoolBind = resolvedSchoolId
    }

    const activeSchools = await db.prepare(`
      SELECT COUNT(*) as count FROM schools ${schoolFilter ? (schoolFilter.replace('school_id', 'id')) : 'WHERE status = \'active\''}
    `).bind(...(schoolBind ? [schoolBind] : [])).first<{ count: number }>()

    const activeUsers = await db.prepare(`
      SELECT COUNT(*) as count FROM users WHERE status = 'active' ${schoolFilter ? 'AND ' + schoolFilter.replace('WHERE ', '') : ''}
    `).bind(...(schoolBind ? [schoolBind] : [])).first<{ count: number }>()

    const totalUsers = await db.prepare(`
      SELECT COUNT(*) as count FROM users ${schoolFilter || ''}
    `).bind(...(schoolBind ? [schoolBind] : [])).first<{ count: number }>()

    const currentYear = await db.prepare(`
      SELECT name FROM academic_years WHERE is_active = 1 ${schoolFilter ? 'AND ' + schoolFilter.replace('WHERE ', '') : ''} LIMIT 1
    `).bind(...(schoolBind ? [schoolBind] : [])).first<{ name: string }>()

    const totalModules = await db.prepare(`
      SELECT COUNT(*) as count FROM modules WHERE status = 'active'
    `).first<{ count: number }>()

    const coreModules = await db.prepare(`
      SELECT COUNT(*) as count FROM modules WHERE is_core = 1 AND status = 'active'
    `).first<{ count: number }>()

    return c.json({
      data: {
        active_schools: activeSchools?.count || 0,
        active_users: activeUsers?.count || 0,
        total_users: totalUsers?.count || 0,
        current_academic_year: currentYear?.name || '---',
        total_modules: totalModules?.count || 0,
        core_modules: coreModules?.count || 0,
      }
    })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الإحصائيات', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Classes (with RBAC + school_id filtering)
// ===========================================
app.get('/api/classes', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  try {
    let query = `
      SELECT c.*,
        (SELECT COUNT(*) FROM sections WHERE class_id = c.id) as sections_count,
        (SELECT COUNT(*) FROM students WHERE class_id = c.id AND status = 'active') as students_count
      FROM classes c
    `
    const binds: (string | number)[] = []
    if (scope === 'single' && resolvedSchoolId != null) {
      query += ` WHERE c.school_id = ?`
      binds.push(resolvedSchoolId)
    }
    query += ` ORDER BY c.order_index, c.id`
    const { results } = await db.prepare(query).bind(...binds).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الصفوف', detail: err.message }, 500)
  }
})

app.post('/api/classes', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  try {
    const body = await c.req.json()
    const { name, stage, order_index } = body
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    const school_id = targetSchool.schoolId

    if (!name || !stage) {
      return c.json({ error: 'المدرسة والاسم والمرحلة مطلوبة' }, 400)
    }

    const result = await db.prepare(`
      INSERT INTO classes (school_id, name, stage, order_index, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', unixepoch(), unixepoch())
    `).bind(school_id, name, stage, order_index || 0).run()
    return c.json({ data: { id: result.meta.last_row_id, school_id, name, stage, order_index: order_index || 0, status: 'active' } }, 201)
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء الصف', detail: err.message }, 500)
  }
})

app.put('/api/classes/:id', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const id = c.req.param('id')
  try {
    const body = await c.req.json()
    const { name, stage, order_index, status } = body
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)

    const existing = await db.prepare(`SELECT school_id FROM classes WHERE id = ?`).bind(id).first<{ school_id: number }>()
    if (!existing) return c.json({ error: 'الصف غير موجود' }, 404)
    if (existing.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: لا يمكنك تعديل صف في مدرسة أخرى' }, 403)
    }

    await db.prepare(`
      UPDATE classes SET name = ?, stage = ?, order_index = ?, status = ?, updated_at = unixepoch()
      WHERE id = ? AND school_id = ?
    `).bind(name, stage, order_index || 0, status || 'active', id, targetSchool.schoolId).run()
    return c.json({ data: { id, name, stage, order_index, status } })
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث الصف', detail: err.message }, 500)
  }
})

app.put('/api/classes/:id/archive', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const id = c.req.param('id')
  try {
    const body = await c.req.json().catch(() => ({}))
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    const existing = await db.prepare(`SELECT school_id FROM classes WHERE id = ?`).bind(id).first<{ school_id: number }>()
    if (!existing) return c.json({ error: 'الصف غير موجود' }, 404)
    if (existing.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: لا يمكنك أرشفة صف في مدرسة أخرى' }, 403)
    }

    const students = await db.prepare(`SELECT COUNT(*) as count FROM students WHERE school_id = ? AND class_id = ? AND status = 'active'`).bind(existing.school_id, id).first<{ count: number }>()
    if (students && students.count > 0) {
      return c.json({ error: 'لا يمكن أرشفة الصف لأنه يحتوي على طلاب نشطين', detail: `عدد الطلاب: ${students.count}` }, 400)
    }
    await db.prepare(`UPDATE classes SET status = 'archived', updated_at = unixepoch() WHERE id = ? AND school_id = ?`).bind(id, targetSchool.schoolId).run()
    return c.json({ data: { id, status: 'archived' } })
  } catch (err: any) {
    return c.json({ error: 'فشل في أرشفة الصف', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Sections (with RBAC + school_id filtering)
// ===========================================
app.get('/api/sections', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  const classId = c.req.query('class_id')
  try {
    let query = `
      SELECT s.*, c.name as class_name,
        (SELECT COUNT(*) FROM students WHERE school_id = s.school_id AND section_id = s.id AND status = 'active') as students_count
      FROM sections s
      JOIN classes c ON s.class_id = c.id AND c.school_id = s.school_id
    `
    const conditions: string[] = []
    const binds: (string | number)[] = []
    if (scope === 'single' && resolvedSchoolId != null) { conditions.push('s.school_id = ?'); binds.push(resolvedSchoolId) }
    if (classId) { conditions.push('s.class_id = ?'); binds.push(classId) }
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`
    }
    query += ` ORDER BY c.order_index, s.id`
    const { results } = await db.prepare(query).bind(...binds).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الشعب', detail: err.message }, 500)
  }
})

app.post('/api/sections', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  try {
    const body = await c.req.json()
    let { class_id, name, capacity } = body
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    let school_id = targetSchool.schoolId

    if (!class_id || !name) {
      return c.json({ error: 'المدرسة والصف والاسم مطلوبة' }, 400)
    }

    school_id = Number(school_id)
    class_id = Number(class_id)
    const placement = await validateStudentPlacement(db, school_id, class_id, null)
    if (!placement.ok) {
      return c.json({ error: placement.error }, placement.status)
    }

    const result = await db.prepare(`
      INSERT INTO sections (school_id, class_id, name, capacity, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', unixepoch(), unixepoch())
    `).bind(school_id, class_id, name, capacity || 30).run()
    return c.json({ data: { id: result.meta.last_row_id, school_id, class_id, name, capacity: capacity || 30, status: 'active' } }, 201)
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء الشعبة', detail: err.message }, 500)
  }
})

app.put('/api/sections/:id', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const id = c.req.param('id')
  try {
    const body = await c.req.json()
    const { class_id, name, capacity, status } = body
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)

    const existing = await db.prepare(`SELECT school_id, class_id FROM sections WHERE id = ?`).bind(id).first<{ school_id: number; class_id: number }>()
    if (!existing) return c.json({ error: 'الشعبة غير موجودة' }, 404)
    if (existing.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: لا يمكنك تعديل شعبة في مدرسة أخرى' }, 403)
    }

    const nextClassId = Number(class_id)
    const placement = await validateStudentPlacement(db, targetSchool.schoolId, nextClassId, null)
    if (!placement.ok) {
      return c.json({ error: placement.error }, placement.status)
    }

    await db.prepare(`
      UPDATE sections SET class_id = ?, name = ?, capacity = ?, status = ?, updated_at = unixepoch()
      WHERE id = ? AND school_id = ?
    `).bind(nextClassId, name, capacity || 30, status || 'active', id, targetSchool.schoolId).run()
    return c.json({ data: { id, class_id, name, capacity, status } })
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث الشعبة', detail: err.message }, 500)
  }
})

app.put('/api/sections/:id/archive', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const id = c.req.param('id')
  try {
    const body = await c.req.json().catch(() => ({}))
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    const existing = await db.prepare(`SELECT school_id FROM sections WHERE id = ?`).bind(id).first<{ school_id: number }>()
    if (!existing) return c.json({ error: 'الشعبة غير موجودة' }, 404)
    if (existing.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: لا يمكنك أرشفة شعبة في مدرسة أخرى' }, 403)
    }

    const students = await db.prepare(`SELECT COUNT(*) as count FROM students WHERE school_id = ? AND section_id = ? AND status = 'active'`).bind(existing.school_id, id).first<{ count: number }>()
    if (students && students.count > 0) {
      return c.json({ error: 'لا يمكن أرشفة الشعبة لأنها تحتوي على طلاب نشطين', detail: `عدد الطلاب: ${students.count}` }, 400)
    }
    await db.prepare(`UPDATE sections SET status = 'archived', updated_at = unixepoch() WHERE id = ? AND school_id = ?`).bind(id, targetSchool.schoolId).run()
    return c.json({ data: { id, status: 'archived' } })
  } catch (err: any) {
    return c.json({ error: 'فشل في أرشفة الشعبة', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Students (with RBAC + school_id filtering)
// ===========================================
app.get('/api/students', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  const classId = c.req.query('class_id')
  const sectionId = c.req.query('section_id')
  try {
    const students = await listStudentsWithEffectivePlacement(db, {
      schoolId: scope === 'single' ? resolvedSchoolId : null,
      classId,
      sectionId,
    })
    return c.json({ data: students })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الطلاب', detail: err.message }, 500)
  }
})

app.get('/api/students/:id', requireAuthEnforced(), requireRoles(ACADEMIC_ACCESS_ROLES), async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  const user: UserContext | null = c.get('user') || null
  try {
    const student = await getStudentWithEffectivePlacement(db, Number(id))
    if (!student) return c.json({ error: 'الطالب غير موجود' }, 404)

    if (user && user.role_key !== 'system_admin') {
      if (student.school_id !== user.school_id) {
        return c.json({ error: 'غير مسموح: لا يمكنك الوصول إلى بيانات هذا الطالب' }, 403)
      }
    }

    return c.json({ data: student })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب بيانات الطالب', detail: err.message }, 500)
  }
})

app.get('/api/students/:id/enrollments', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_ACCESS_ROLES), async (c) => {
  const db = c.env.DB
  const id = Number(c.req.param('id'))
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  if (resolvedSchoolId == null) {
    return c.json({ error: 'يجب تحديد المدرسة المستهدفة لعرض سجل تسجيلات الطالب' }, 400)
  }

  try {
    const student = await db.prepare('SELECT id, school_id FROM students WHERE id = ?')
      .bind(id)
      .first<{ id: number; school_id: number }>()
    if (!student) return c.json({ error: 'الطالب غير موجود' }, 404)
    if (student.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح: لا يمكنك الوصول إلى سجل طالب في مدرسة أخرى' }, 403)
    }

    const history = await listStudentEnrollmentHistory(db, resolvedSchoolId, id)
    return c.json({ data: history })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب سجل تسجيلات الطالب', detail: err.message }, 500)
  }
})

app.post('/api/student-enrollments/promotion/preview', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user = c.get('user') as UserContext
  try {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: 'بيانات معاينة الانتقال السنوي غير صالحة' }, 400)

    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)

    const result = await previewStudentPromotion(db, targetSchool.schoolId, body)
    if (!result.ok) {
      return c.json({ error: result.error, code: result.code, data: result.data }, result.status)
    }
    return c.json({ data: result.data })
  } catch {
    return c.json({ error: 'فشل في معاينة الانتقال السنوي للطالب' }, 500)
  }
})

app.post('/api/student-enrollments/promotion/bulk-preview', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user = c.get('user') as UserContext
  try {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: 'بيانات معاينة الترفيع الجماعي غير صالحة' }, 400)

    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)

    const result = await previewBulkStudentPromotion(db, targetSchool.schoolId, body)
    if (!result.ok) {
      return c.json({ error: result.error, code: result.code }, result.status)
    }
    return c.json({ data: result.data })
  } catch {
    return c.json({ error: 'فشل في معاينة الترفيع الجماعي' }, 500)
  }
})

app.post('/api/student-enrollments/promotion/bulk', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user = c.get('user') as UserContext
  try {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: 'بيانات الترفيع الجماعي غير صالحة' }, 400)

    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)

    const result = await executeBulkStudentPromotion(db, targetSchool.schoolId, user.id, body)
    if (!result.ok) {
      return c.json({ error: result.error, code: result.code, data: result.data }, result.status)
    }
    return c.json({ data: result.data })
  } catch {
    return c.json({ error: 'فشل في تنفيذ الترفيع الجماعي' }, 500)
  }
})

app.post('/api/student-enrollments/promotion', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user = c.get('user') as UserContext
  try {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: 'بيانات الانتقال السنوي غير صالحة' }, 400)

    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)

    const result = await executeStudentPromotion(db, targetSchool.schoolId, user.id, body)
    if (!result.ok) return c.json({ error: result.error, code: result.code }, result.status)
    return c.json({ data: result.data })
  } catch {
    return c.json({ error: 'فشل في تطبيق الانتقال السنوي للطالب' }, 500)
  }
})

app.post('/api/students', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  try {
    const body = await c.req.json()
    let {
      school_id, student_number, full_name, father_name, mother_name,
      gender, religion, birth_date, phone, guardian_name, guardian_phone,
      address, class_id, section_id, photo_url, notes
    } = body

    const targetSchool = await resolveActiveWriteSchool(db, user, school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    school_id = targetSchool.schoolId

    if (!school_id || !student_number || !full_name || !gender) {
      return c.json({ error: 'المدرسة ورقم الطالب والاسم والجنس مطلوبة' }, 400)
    }
    const religionValidation = validateStudentReligion(religion)
    if (!religionValidation.ok) {
      return c.json({ error: 'قيمة الديانة غير صالحة' }, 400)
    }

    class_id = class_id == null || class_id === '' ? null : Number(class_id)
    section_id = section_id == null || section_id === '' ? null : Number(section_id)
    const placement = await validateStudentPlacement(db, school_id, class_id, section_id)
    if (!placement.ok) {
      return c.json({ error: placement.error }, placement.status)
    }

    if (!user) return c.json({ error: 'غير مسموح: يجب تسجيل الدخول أولاً' }, 401)
    const studentValues: StudentWriteValues = {
      school_id,
      student_number,
      full_name,
      father_name: father_name || null,
      mother_name: mother_name || null,
      gender,
      religion: religionValidation.value,
      birth_date: birth_date || null,
      phone: phone || null,
      guardian_name: guardian_name || null,
      guardian_phone: guardian_phone || null,
      address: address || null,
      class_id,
      section_id,
      status: 'active',
      photo_url: photo_url || null,
      notes: notes || null,
    }
    const creation = await createStudentWithEnrollmentBridge(db, studentValues, user.id)
    if (!creation.ok) {
      return c.json({ error: 'لا توجد سنة دراسية فعالة لإنشاء تسجيل الطالب' }, 400)
    }
    return c.json({ data: creation.student }, 201)
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء الطالب', detail: err.message }, 500)
  }
})

app.put('/api/students/:id', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const id = c.req.param('id')
  try {
    const body = await c.req.json()
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)

    const existing = await db.prepare(`SELECT * FROM students WHERE id = ?`).bind(id).first<{
      school_id: number; student_number: string; full_name: string; father_name: string | null; mother_name: string | null;
      gender: string; religion: StudentWriteValues['religion']; birth_date: string | null; phone: string | null; guardian_name: string | null; guardian_phone: string | null;
      address: string | null; class_id: number | null; section_id: number | null; photo_url: string | null; notes: string | null; status: string;
    }>()
    if (!existing) return c.json({ error: 'الطالب غير موجود' }, 404)
    if (existing.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: لا يمكنك تعديل طالب في مدرسة أخرى' }, 403)
    }

    const student_number = body.student_number ?? existing.student_number
    const full_name = body.full_name ?? existing.full_name
    const father_name = body.father_name !== undefined ? body.father_name : existing.father_name
    const mother_name = body.mother_name !== undefined ? body.mother_name : existing.mother_name
    const gender = body.gender ?? existing.gender
    let religion = existing.religion
    if (Object.prototype.hasOwnProperty.call(body, 'religion')) {
      const religionValidation = validateStudentReligion(body.religion)
      if (!religionValidation.ok) return c.json({ error: 'قيمة الديانة غير صالحة' }, 400)
      religion = religionValidation.value
    }
    const birth_date = body.birth_date !== undefined ? body.birth_date : existing.birth_date
    const phone = body.phone !== undefined ? body.phone : existing.phone
    const guardian_name = body.guardian_name !== undefined ? body.guardian_name : existing.guardian_name
    const guardian_phone = body.guardian_phone !== undefined ? body.guardian_phone : existing.guardian_phone
    const address = body.address !== undefined ? body.address : existing.address
    const photo_url = body.photo_url !== undefined ? body.photo_url : existing.photo_url
    const notes = body.notes !== undefined ? body.notes : existing.notes
    const status = body.status ?? existing.status

    const hasClassId = Object.prototype.hasOwnProperty.call(body, 'class_id')
    const hasSectionId = Object.prototype.hasOwnProperty.call(body, 'section_id')
    const requestedClassId = hasClassId
      ? (body.class_id == null || body.class_id === '' ? null : Number(body.class_id))
      : null
    const requestedSectionId = hasSectionId
      ? (body.section_id == null || body.section_id === '' ? null : Number(body.section_id))
      : null
    const enrollmentContext = await loadCurrentStudentEnrollmentContext(
      db,
      targetSchool.schoolId,
      Number(id),
    )
    const placementPlan = buildStudentPlacementUpdatePlan(
      { class_id: existing.class_id, section_id: existing.section_id },
      enrollmentContext,
      {
        hasClassId,
        hasSectionId,
        class_id: requestedClassId,
        section_id: requestedSectionId,
      },
    )
    if (placementPlan.kind === 'reject') {
      return c.json({
        error: placementPlan.code === 'active_year_required'
          ? 'لا توجد سنة دراسية فعالة لتحديث موقع الطالب'
          : placementPlan.code === 'finalized_enrollment'
            ? FINALIZED_ENROLLMENT_PLACEMENT_ERROR
          : placementPlan.code === 'class_required'
            ? 'لا يمكن تحديد الشعبة دون تحديد الصف'
            : 'لا يمكن إزالة تسجيل الطالب من نموذج الطالب؛ استخدم إجراءات دورة التسجيل المخصصة',
      }, placementPlan.code === 'finalized_enrollment' ? 409 : 400)
    }

    if (placementPlan.kind === 'write') {
      const placement = await validateStudentPlacement(
        db,
        targetSchool.schoolId,
        placementPlan.class_id,
        placementPlan.section_id,
      )
      if (!placement.ok) {
        return c.json({ error: placement.error }, placement.status)
      }
    }

    if (!user) return c.json({ error: 'غير مسموح: يجب تسجيل الدخول أولاً' }, 401)
    const studentValues: StudentWriteValues = {
      school_id: targetSchool.schoolId,
      student_number,
      full_name,
      father_name,
      mother_name,
      gender,
      religion,
      birth_date,
      phone,
      guardian_name,
      guardian_phone,
      address,
      class_id: existing.class_id,
      section_id: existing.section_id,
      photo_url,
      notes,
      status,
    }
    if (placementPlan.kind === 'write') {
      await updateStudentPlacementAtomically(db, Number(id), studentValues, placementPlan, user.id)
    } else {
      await updateStudentIdentityOnly(db, Number(id), studentValues)
    }
    return c.json({ data: { id, student_number, full_name, religion, status } })
  } catch (err: any) {
    if (err instanceof FinalizedEnrollmentPlacementError) {
      return c.json({ error: FINALIZED_ENROLLMENT_PLACEMENT_ERROR }, 409)
    }
    return c.json({ error: 'فشل في تحديث بيانات الطالب', detail: err.message }, 500)
  }
})

app.put('/api/students/:id/archive', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const id = c.req.param('id')
  try {
    const body = await c.req.json().catch(() => ({}))
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    const existing = await db.prepare(`SELECT school_id FROM students WHERE id = ?`).bind(id).first<{ school_id: number }>()
    if (!existing) return c.json({ error: 'الطالب غير موجود' }, 404)
    if (existing.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: لا يمكنك أرشفة طالب في مدرسة أخرى' }, 403)
    }

    await archiveStudentWithoutEnrollmentMutation(db, Number(id), targetSchool.schoolId)
    return c.json({ data: { id, status: 'archived' } })
  } catch (err: any) {
    return c.json({ error: 'فشل في أرشفة الطالب', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Subjects (with RBAC + school_id filtering)
// ===========================================
const BULK_SUBJECT_VALIDATION_MESSAGES: Record<BulkSubjectValidationCode, string> = {
  not_object: 'بيانات الإنشاء الجماعي غير صالحة',
  unknown_field: 'تحتوي البيانات على حقل غير مدعوم',
  invalid_classes: 'يجب اختيار صف واحد صالح على الأقل',
  too_many_classes: 'لا يمكن اختيار أكثر من 50 صفًا في العملية الواحدة',
  duplicate_class: 'لا يمكن تكرار الصف في القائمة',
  invalid_name: 'اسم المادة مطلوب ويجب أن يكون صالحًا',
  invalid_type: 'نوع المادة غير صالح',
  invalid_religious_track: 'نوع مادة الديانة غير صالح',
  invalid_boolean: 'إعدادات ظهور المادة واحتسابها غير صالحة',
  invalid_grade: 'درجات النجاح والإعفاء يجب أن تكون بين 0 و100',
  confirmation_required: 'يجب تأكيد الإنشاء الجماعي صراحةً',
}

async function loadBulkSubjectPlan(
  db: D1Database,
  schoolId: number,
  values: BulkSubjectValues,
): Promise<BulkSubjectPlan> {
  const placeholders = values.class_ids.map(() => '?').join(', ')
  const [classRows, existingRows] = await Promise.all([
    db.prepare(`
      SELECT id, name, status, order_index
      FROM classes
      WHERE school_id = ? AND id IN (${placeholders})
    `).bind(schoolId, ...values.class_ids).all<BulkSubjectClassRecord>(),
    db.prepare(`
      SELECT id, class_id, name, status
      FROM subjects
      WHERE school_id = ?
        AND class_id IN (${placeholders})
        AND section_id IS NULL
        AND status = 'active'
      ORDER BY class_id, order_index, id
    `).bind(schoolId, ...values.class_ids).all<BulkSubjectExistingRecord>(),
  ])
  return buildBulkSubjectPlan(
    values.class_ids,
    values.normalized_name,
    classRows.results || [],
    existingRows.results || [],
  )
}

function bulkSubjectInvalidResponse(c: any, plan: BulkSubjectPlan) {
  const invalid = plan.items.filter((item) => item.status === 'invalid')
  if (invalid.some((item) => item.reason === 'missing_or_not_in_scope')) {
    return c.json({ error: 'أحد الصفوف المحددة غير موجود أو غير متاح ضمن المدرسة المستهدفة', data: plan }, 404)
  }
  return c.json({ error: 'يجب أن تكون جميع الصفوف المحددة فعالة', data: plan }, 400)
}

app.get('/api/subjects', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  const classId = c.req.query('class_id')
  const sectionId = c.req.query('section_id')
  try {
    let query = `
      SELECT sb.*, c.name as class_name, s.name as section_name
      FROM subjects sb
      JOIN classes c ON sb.class_id = c.id AND c.school_id = sb.school_id
      LEFT JOIN sections s ON sb.section_id = s.id AND s.school_id = sb.school_id
    `
    const conditions: string[] = []
    const binds: (string | number)[] = []
    if (scope === 'single' && resolvedSchoolId != null) { conditions.push('sb.school_id = ?'); binds.push(resolvedSchoolId) }
    if (classId) { conditions.push('sb.class_id = ?'); binds.push(classId) }
    if (sectionId) { conditions.push('sb.section_id = ?'); binds.push(sectionId) }
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`
    }
    query += ` ORDER BY c.order_index, sb.order_index, sb.id`
    const { results } = await db.prepare(query).bind(...binds).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب المواد', detail: err.message }, 500)
  }
})

app.post('/api/subjects/bulk-preview', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  try {
    const body = await c.req.json().catch(() => null)
    const validation = validateBulkSubjectPayload(body)
    if (!validation.ok) {
      return c.json({ error: BULK_SUBJECT_VALIDATION_MESSAGES[validation.code] }, 400)
    }
    const targetSchool = await resolveActiveWriteSchool(db, user, validation.value.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)

    const plan = await loadBulkSubjectPlan(db, targetSchool.schoolId, validation.value)
    return c.json({
      data: {
        school_id: targetSchool.schoolId,
        subject: {
          name: validation.value.name,
          subject_type: validation.value.subject_type,
          religious_track: validation.value.religious_track,
          counts_in_average: validation.value.counts_in_average,
          appears_in_report_card: validation.value.appears_in_report_card,
          passing_grade: validation.value.passing_grade,
          exemption_grade: validation.value.exemption_grade,
        },
        ...plan,
      },
    })
  } catch (error) {
    console.error('[subjects/bulk-preview] unexpected failure', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    })
    return c.json({ error: 'فشل في معاينة الإنشاء الجماعي للمواد' }, 500)
  }
})

app.post('/api/subjects/bulk', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  try {
    const body = await c.req.json().catch(() => null)
    const validation = validateBulkSubjectPayload(body, { requireConfirmation: true })
    if (!validation.ok) {
      return c.json({ error: BULK_SUBJECT_VALIDATION_MESSAGES[validation.code] }, 400)
    }
    const targetSchool = await resolveActiveWriteSchool(db, user, validation.value.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)

    // Re-read all scope and duplicate inputs immediately before constructing the
    // atomic insert. Invalid classes reject the entire operation; active
    // equivalents are intentional no-op skips.
    const plan = await loadBulkSubjectPlan(db, targetSchool.schoolId, validation.value)
    if (!plan.can_create) return bulkSubjectInvalidResponse(c, plan)

    const createClassIds = new Set(
      plan.items.filter((item) => item.status === 'create').map((item) => item.class_id),
    )
    let inserted: Array<{ id: number; class_id: number }> = []
    if (createClassIds.size > 0) {
      const selectedValues = validation.value.class_ids
        .map((classId) => `(?, ${createClassIds.has(classId) ? 1 : 0})`)
        .join(', ')
      const insertStatement = db.prepare(`
        WITH RECURSIVE selected(class_id, should_create) AS (
          VALUES ${selectedValues}
        ), valid AS (
          SELECT selected.class_id, selected.should_create
          FROM selected
          JOIN classes class_record ON class_record.id = selected.class_id
          WHERE class_record.school_id = ? AND class_record.status = 'active'
        ), normalized_existing(id, class_id, normalized_name) AS (
          SELECT existing.id, existing.class_id, ${SUBJECT_NAME_SQL_NORMALIZATION_SEED}
          FROM subjects existing
          JOIN selected ON selected.class_id = existing.class_id
          WHERE existing.school_id = ?
            AND existing.section_id IS NULL
            AND existing.status = 'active'
          UNION ALL
          SELECT id, class_id, replace(normalized_name, '  ', ' ')
          FROM normalized_existing
          WHERE instr(normalized_name, '  ') > 0
        ), existing_equivalent AS (
          SELECT id, class_id
          FROM normalized_existing
          WHERE instr(normalized_name, '  ') = 0
            AND normalized_name = ?
        ), eligible AS (
          SELECT valid.class_id
          FROM valid
          WHERE valid.should_create = 1
            AND NOT EXISTS (
              SELECT 1
              FROM existing_equivalent
              WHERE existing_equivalent.class_id = valid.class_id
            )
        )
        INSERT INTO subjects (
          school_id, class_id, section_id, name, subject_type, religious_track,
          counts_in_average, appears_in_report_card, passing_grade, exemption_grade,
          order_index, status, created_at, updated_at
        )
        SELECT
          ?, eligible.class_id, NULL, ?, ?, ?, ?, ?, ?, ?,
          (
            SELECT COALESCE(MAX(subject_order.order_index), 0) + 1
            FROM subjects subject_order
            WHERE subject_order.school_id = ?
              AND subject_order.class_id = eligible.class_id
              AND subject_order.status = 'active'
          ),
          'active', unixepoch(), unixepoch()
        FROM eligible
        WHERE (SELECT COUNT(*) FROM valid) = (SELECT COUNT(*) FROM selected)
        RETURNING id, class_id
      `).bind(
        ...validation.value.class_ids,
        targetSchool.schoolId,
        targetSchool.schoolId,
        validation.value.normalized_name,
        targetSchool.schoolId,
        validation.value.name,
        validation.value.subject_type,
        validation.value.religious_track,
        validation.value.counts_in_average ? 1 : 0,
        validation.value.appears_in_report_card ? 1 : 0,
        validation.value.passing_grade,
        validation.value.exemption_grade,
        targetSchool.schoolId,
      )
      const batchResults = await db.batch<{ id: number; class_id: number }>([insertStatement])
      inserted = batchResults[0]?.results || []
    }

    // Only a zero-row authoritative INSERT needs a post-read: it distinguishes
    // a legitimate concurrent duplicate from an invalid class at write time.
    // Once INSERT returns rows, never let later state changes misreport that
    // committed work as a zero-write failure.
    let reportingPlan = plan
    if (inserted.length === 0 && createClassIds.size > 0) {
      const finalPlan = await loadBulkSubjectPlan(db, targetSchool.schoolId, validation.value)
      if (!finalPlan.can_create || finalPlan.counts.create > 0) {
        return c.json({ error: 'تغيرت حالة أحد الصفوف أثناء الحفظ؛ لم يتم إنشاء أي مادة' }, 409)
      }
      reportingPlan = finalPlan
    }
    const insertedByClass = new Map(inserted.map((row) => [Number(row.class_id), Number(row.id)]))
    const existingByClass = new Map(
      reportingPlan.items
        .filter((item) => item.existing_subject_id != null)
        .map((item) => [item.class_id, Number(item.existing_subject_id)]),
    )
    const items = validation.value.class_ids.map((classId) => {
      const className = reportingPlan.items.find((item) => item.class_id === classId)?.class_name || null
      const insertedId = insertedByClass.get(classId)
      return insertedId != null
        ? { class_id: classId, class_name: className, status: 'created', subject_id: insertedId }
        : { class_id: classId, class_name: className, status: 'already_exists', subject_id: existingByClass.get(classId) || null }
    })
    const created = items
      .filter((item): item is typeof item & { subject_id: number } => item.status === 'created' && item.subject_id != null)
      .map((item) => ({ class_id: item.class_id, class_name: item.class_name, subject_id: item.subject_id }))
    const skippedExisting = items
      .filter((item) => item.status === 'already_exists')
      .map((item) => ({
        class_id: item.class_id,
        class_name: item.class_name,
        existing_subject_id: item.subject_id,
      }))
    return c.json({
      data: {
        school_id: targetSchool.schoolId,
        created,
        skipped_existing: skippedExisting,
        created_count: created.length,
        skipped_count: skippedExisting.length,
        items,
        counts: {
          selected: items.length,
          created: created.length,
          already_exists: skippedExisting.length,
        },
      },
    }, created.length > 0 ? 201 : 200)
  } catch (error) {
    console.error('[subjects/bulk-create] unexpected failure', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    })
    return c.json({ error: 'فشل في الإنشاء الجماعي للمواد' }, 500)
  }
})

app.post('/api/subjects', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  try {
    const body = await c.req.json()
    let {
      school_id, class_id, section_id, name, subject_type, religious_track,
      counts_in_average, appears_in_report_card,
      passing_grade, exemption_grade, order_index
    } = body

    const targetSchool = await resolveActiveWriteSchool(db, user, school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    school_id = targetSchool.schoolId

    const canonicalName = typeof name === 'string' ? canonicalizeSubjectDisplayName(name) : ''
    if (!school_id || !class_id || !canonicalName || canonicalName.length > 200) {
      return c.json({ error: 'المدرسة والصف واسم المادة مطلوبة' }, 400)
    }
    name = canonicalName
    const religiousTrackValidation = validateReligiousTrack(religious_track)
    if (!religiousTrackValidation.ok) {
      return c.json({ error: 'نوع مادة الديانة غير صالح' }, 400)
    }

    class_id = Number(class_id)
    section_id = section_id == null || section_id === '' ? null : Number(section_id)
    const placement = await validateStudentPlacement(db, school_id, class_id, section_id)
    if (!placement.ok) {
      return c.json({ error: placement.error }, placement.status)
    }

    const numericOrderIndex = Number(order_index)
    const explicitOrderIndex = order_index !== undefined && order_index !== null && order_index !== ''
      && Number.isInteger(numericOrderIndex) && numericOrderIndex > 0
      ? numericOrderIndex
      : null

    const result = await db.prepare(`
      INSERT INTO subjects (
        school_id, class_id, section_id, name, subject_type, religious_track,
        counts_in_average, appears_in_report_card,
        passing_grade, exemption_grade, order_index,
        status, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        COALESCE(?, (
          SELECT COALESCE(MAX(order_index), 0) + 1
          FROM subjects
          WHERE school_id = ? AND class_id = ? AND status = 'active'
        )),
        'active', unixepoch(), unixepoch()
      )
    `).bind(
      school_id, class_id, section_id || null, name, subject_type || 'أساسية', religiousTrackValidation.value,
      counts_in_average !== undefined ? (counts_in_average ? 1 : 0) : 1,
      appears_in_report_card !== undefined ? (appears_in_report_card ? 1 : 0) : 1,
      passing_grade || 50, exemption_grade || 25,
      explicitOrderIndex, school_id, class_id,
    ).run()
    return c.json({ data: { id: result.meta.last_row_id, school_id, class_id, name, religious_track: religiousTrackValidation.value, status: 'active' } }, 201)
  } catch (error) {
    console.error('[subjects/create] unexpected failure', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    })
    return c.json({ error: 'فشل في إنشاء المادة' }, 500)
  }
})

app.put('/api/subjects/reorder', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  try {
    const body = await c.req.json()
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)

    const classId = Number(body.class_id)
    if (!Number.isInteger(classId) || classId <= 0) {
      return c.json({ error: 'يجب تحديد صف صالح لترتيب المواد' }, 400)
    }

    const classRecord = await db.prepare('SELECT id, school_id, status FROM classes WHERE id = ?')
      .bind(classId)
      .first<{ id: number; school_id: number; status: string }>()
    if (!classRecord) return c.json({ error: 'الصف غير موجود' }, 404)
    if (classRecord.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: الصف ينتمي إلى مدرسة أخرى' }, 403)
    }
    if (classRecord.status !== 'active') {
      return c.json({ error: 'لا يمكن ترتيب مواد صف غير فعال' }, 400)
    }

    const uniqueNumericIds = Array.isArray(body.ordered_subject_ids)
      && body.ordered_subject_ids.every((id: unknown) => typeof id === 'number' && Number.isInteger(id) && id > 0)
      && new Set(body.ordered_subject_ids).size === body.ordered_subject_ids.length
      ? body.ordered_subject_ids as number[]
      : []
    const suppliedSubjects = uniqueNumericIds.length > 0
      ? await db.prepare(`
          SELECT id, school_id, class_id, status
          FROM subjects
          WHERE id IN (${uniqueNumericIds.map(() => '?').join(', ')})
        `).bind(...uniqueNumericIds).all<SubjectOrderRecord>()
      : { results: [] as SubjectOrderRecord[] }
    const activeSubjects = await db.prepare(`
      SELECT id
      FROM subjects
      WHERE school_id = ? AND class_id = ? AND status = 'active'
      ORDER BY order_index, id
    `).bind(targetSchool.schoolId, classId).all<{ id: number }>()

    const validation = validateSubjectOrder(
      body.ordered_subject_ids,
      suppliedSubjects.results || [],
      (activeSubjects.results || []).map((subject) => subject.id),
      targetSchool.schoolId,
      classId,
    )
    if (!validation.ok) {
      const errors: Record<typeof validation.code, { status: 400 | 403 | 404; error: string }> = {
        not_array: { status: 400, error: 'قائمة ترتيب المواد مطلوبة' },
        invalid_id: { status: 400, error: 'قائمة المواد تحتوي على معرّف غير صالح' },
        duplicate_id: { status: 400, error: 'لا يمكن تكرار المادة في الترتيب' },
        subject_missing: { status: 404, error: 'إحدى المواد غير موجودة' },
        cross_school: { status: 403, error: 'غير مسموح: إحدى المواد تنتمي إلى مدرسة أخرى' },
        wrong_class: { status: 400, error: 'إحدى المواد لا تنتمي إلى الصف المحدد' },
        inactive_subject: { status: 400, error: 'يمكن ترتيب المواد الفعالة فقط' },
        partial_list: { status: 400, error: 'يجب إرسال جميع المواد الفعالة للصف دون حذف أو إضافة' },
      }
      const failure = errors[validation.code]
      return c.json({ error: failure.error }, failure.status)
    }

    if (validation.orderedIds.length === 0) return c.json({ data: [] })

    // The builder embeds only validated positive integer IDs. Its exact-set guards
    // keep this one UPDATE all-or-nothing if the active set changes concurrently.
    const updateResult = await db.prepare(
      buildAtomicSubjectOrderUpdateSql(validation.orderedIds),
    ).bind(
      targetSchool.schoolId, classId,
      targetSchool.schoolId, classId, validation.orderedIds.length,
      targetSchool.schoolId, classId,
    ).run()
    if (Number(updateResult.meta.changes || 0) !== validation.orderedIds.length) {
      return c.json({ error: 'تغيرت قائمة المواد أثناء الحفظ؛ راجع القائمة وحاول مجددًا' }, 409)
    }

    const reordered = await db.prepare(`
      SELECT sb.*, c.name AS class_name, s.name AS section_name
      FROM subjects sb
      JOIN classes c ON sb.class_id = c.id AND c.school_id = sb.school_id
      LEFT JOIN sections s ON sb.section_id = s.id AND s.school_id = sb.school_id
      WHERE sb.school_id = ? AND sb.class_id = ? AND sb.status = 'active'
      ORDER BY sb.order_index, sb.id
    `).bind(targetSchool.schoolId, classId).all()
    return c.json({ data: reordered.results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في حفظ ترتيب المواد', detail: err.message }, 500)
  }
})

app.put('/api/subjects/:id', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const id = c.req.param('id')
  try {
    const body = await c.req.json()
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    const {
      class_id, section_id, name, subject_type, religious_track,
      counts_in_average, appears_in_report_card,
      passing_grade, exemption_grade, order_index, status
    } = body

    const existing = await db.prepare(`SELECT school_id, class_id, order_index, status, religious_track FROM subjects WHERE id = ?`).bind(id).first<{
      school_id: number
      class_id: number
      order_index: number
      status: string
      religious_track: ReligiousTrack | null
    }>()
    if (!existing) return c.json({ error: 'المادة غير موجودة' }, 404)
    if (existing.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: لا يمكنك تعديل مادة في مدرسة أخرى' }, 403)
    }

    const canonicalName = typeof name === 'string' ? canonicalizeSubjectDisplayName(name) : ''
    if (!canonicalName || canonicalName.length > 200) {
      return c.json({ error: 'اسم المادة مطلوب ويجب أن يكون صالحًا' }, 400)
    }

    const hasReligiousTrack = Object.prototype.hasOwnProperty.call(body, 'religious_track')
    const religiousTrackValidation = hasReligiousTrack
      ? validateReligiousTrack(religious_track)
      : { ok: true as const, value: existing.religious_track }
    if (!religiousTrackValidation.ok) {
      return c.json({ error: 'نوع مادة الديانة غير صالح' }, 400)
    }
    if (religiousTrackValidation.value != null && religiousTrackValidation.value !== existing.religious_track) {
      const conflictingStudentsCount = await countSubjectReligiousConversionConflicts(
        db,
        targetSchool.schoolId,
        Number(id),
      )
      if (conflictingStudentsCount > 0) {
        return c.json({
          error: 'لا يمكن تحويل المادة إلى مادة ديانة لأن بعض الطلاب لديهم مادة ديانة فعالة أخرى',
          meta: { conflicting_students_count: conflictingStudentsCount },
        }, 409)
      }
    }

    const nextClassId = Number(class_id)
    const nextSectionId = section_id == null || section_id === '' ? null : Number(section_id)
    const placement = await validateStudentPlacement(
      db,
      targetSchool.schoolId,
      nextClassId,
      nextSectionId,
    )
    if (!placement.ok) {
      return c.json({ error: placement.error }, placement.status)
    }

    const numericOrderIndex = Number(order_index)
    const explicitOrderIndex = order_index !== undefined && order_index !== null && order_index !== ''
      && Number.isInteger(numericOrderIndex) && numericOrderIndex > 0
      ? numericOrderIndex
      : null
    let nextOrderIndex = explicitOrderIndex ?? existing.order_index
    if (explicitOrderIndex == null && nextClassId !== existing.class_id) {
      const appendedOrder = await db.prepare(`
        SELECT COALESCE(MAX(order_index), 0) + 1 AS next_order_index
        FROM subjects
        WHERE school_id = ? AND class_id = ? AND status = 'active'
      `).bind(targetSchool.schoolId, nextClassId).first<{ next_order_index: number }>()
      nextOrderIndex = appendedOrder?.next_order_index ?? 1
    }
    const nextStatus = status || existing.status

    await db.prepare(`
      UPDATE subjects SET
        class_id = ?, section_id = ?, name = ?, subject_type = ?, religious_track = ?,
        counts_in_average = ?, appears_in_report_card = ?,
        passing_grade = ?, exemption_grade = ?, order_index = ?, status = ?,
        updated_at = unixepoch()
      WHERE id = ? AND school_id = ?
    `).bind(
      nextClassId, nextSectionId, canonicalName, subject_type || 'أساسية', religiousTrackValidation.value,
      counts_in_average !== undefined ? (counts_in_average ? 1 : 0) : 1,
      appears_in_report_card !== undefined ? (appears_in_report_card ? 1 : 0) : 1,
      passing_grade || 50, exemption_grade || 25, nextOrderIndex, nextStatus, id, targetSchool.schoolId
    ).run()
    return c.json({ data: { id, name: canonicalName, religious_track: religiousTrackValidation.value, status: nextStatus, order_index: nextOrderIndex } })
  } catch (error) {
    console.error('[subjects/update] unexpected failure', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    })
    return c.json({ error: 'فشل في تحديث المادة' }, 500)
  }
})

app.put('/api/subjects/:id/archive', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const id = c.req.param('id')
  try {
    const body = await c.req.json().catch(() => ({}))
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    const existing = await db.prepare(`SELECT school_id FROM subjects WHERE id = ?`).bind(id).first<{ school_id: number }>()
    if (!existing) return c.json({ error: 'المادة غير موجودة' }, 404)
    if (existing.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: لا يمكنك أرشفة مادة في مدرسة أخرى' }, 403)
    }

    await db.prepare(`UPDATE subjects SET status = 'archived', updated_at = unixepoch() WHERE id = ? AND school_id = ?`).bind(id, targetSchool.schoolId).run()
    return c.json({ data: { id, status: 'archived' } })
  } catch (err: any) {
    return c.json({ error: 'فشل في أرشفة المادة', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Student Subjects (Phase 3)
// ===========================================

// Helper: verify a student and subject belong to the same school as the user
async function verifyStudentSubjectSchool(
  db: D1Database,
  user: UserContext | null,
  student_id: number,
  subject_id: number
): Promise<{ ok: boolean; school_id?: number; error?: string; status?: number }> {
  const st = await db.prepare('SELECT school_id, class_id, section_id FROM students WHERE id = ?').bind(student_id).first<{ school_id: number; class_id: number | null; section_id: number | null }>();
  const su = await db.prepare('SELECT school_id, class_id, section_id FROM subjects WHERE id = ?').bind(subject_id).first<{ school_id: number; class_id: number | null; section_id: number | null }>();
  if (!st) return { ok: false, error: 'الطالب غير موجود', status: 404 };
  if (!su) return { ok: false, error: 'المادة غير موجودة', status: 404 };
  if (st.school_id !== su.school_id) return { ok: false, error: 'الطالب والمادة لا ينتميان لنفس المدرسة', status: 400 };
  if (user && user.role_key !== 'system_admin' && st.school_id !== user.school_id) {
    return { ok: false, error: 'غير مسموح: لا يمكنك الوصول إلى بيانات هذه المدرسة', status: 403 };
  }
  return { ok: true, school_id: st.school_id };
}

// Helper: get the effective active-year class/section for academic assignment.
async function getStudentClassSection(db: D1Database, student_id: number) {
  const student = await getStudentWithEffectivePlacement(db, student_id);
  return student ? { class_id: student.class_id, section_id: student.section_id } : null;
}

type StudentSubjectAssignmentValidation =
  | { ok: true; class_id: number | null; section_id: number | null }
  | { ok: false; status: 400 | 403 | 404; error: string };

async function validateStudentSubjectAssignment(
  db: D1Database,
  schoolId: number,
  studentId: number,
  subjectId: number,
): Promise<StudentSubjectAssignmentValidation> {
  const student = await getStudentWithEffectivePlacement(db, studentId);
  if (!student) return { ok: false, status: 404, error: 'الطالب غير موجود' };

  const subject = await db.prepare(
    'SELECT school_id, class_id, section_id FROM subjects WHERE id = ?',
  ).bind(subjectId).first<{
    school_id: number;
    class_id: number | null;
    section_id: number | null;
  }>();
  if (!subject) return { ok: false, status: 404, error: 'المادة غير موجودة' };
  if (student.school_id !== schoolId || subject.school_id !== schoolId) {
    return {
      ok: false,
      status: 403,
      error: 'الطالب والمادة يجب أن ينتميا إلى مدرسة الاستيراد',
    };
  }
  if (subject.class_id != null && subject.class_id !== student.class_id) {
    return { ok: false, status: 400, error: 'المادة لا تتبع صف الطالب' };
  }
  if (subject.section_id != null && subject.section_id !== student.section_id) {
    return { ok: false, status: 400, error: 'المادة لا تتبع شعبة الطالب' };
  }
  return {
    ok: true,
    class_id: student.class_id,
    section_id: student.section_id,
  };
}

// GET /api/student-subjects - list assignments with filters
app.get('/api/student-subjects', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId');
  const scope: 'all' | 'single' = c.get('scope');
  const qStudent = c.req.query('student_id');
  const qClass = c.req.query('class_id');
  const qSection = c.req.query('section_id');
  const qSubject = c.req.query('subject_id');
  const qActive = c.req.query('is_active');
  try {
    let query = `
      SELECT ss.*,
        st.full_name as student_name, st.student_number,
        su.name as subject_name, su.subject_type, su.religious_track, su.counts_in_average, su.appears_in_report_card,
        c.name as class_name, se.name as section_name,
        u.full_name as assigned_by_name
      FROM student_subjects ss
      JOIN students st ON ss.student_id = st.id AND st.school_id = ss.school_id
      JOIN subjects su ON ss.subject_id = su.id AND su.school_id = ss.school_id
      LEFT JOIN classes c ON ss.class_id = c.id AND c.school_id = ss.school_id
      LEFT JOIN sections se ON ss.section_id = se.id AND se.school_id = ss.school_id
      LEFT JOIN users u ON ss.assigned_by_user_id = u.id
    `;
    const conditions: string[] = [];
    const binds: (string | number)[] = [];
    if (scope === 'single' && resolvedSchoolId != null) { conditions.push('ss.school_id = ?'); binds.push(resolvedSchoolId); }
    if (qStudent) { conditions.push('ss.student_id = ?'); binds.push(qStudent); }
    if (qClass) { conditions.push('ss.class_id = ?'); binds.push(qClass); }
    if (qSection) { conditions.push('ss.section_id = ?'); binds.push(qSection); }
    if (qSubject) { conditions.push('ss.subject_id = ?'); binds.push(qSubject); }
    if (qActive === '1' || qActive === '0') { conditions.push('ss.is_active = ?'); binds.push(Number(qActive)); }
    if (conditions.length > 0) query += ` WHERE ${conditions.join(' AND ')}`;
    query += ` ORDER BY ss.is_active DESC, ss.assigned_at DESC`;
    const { results } = await db.prepare(query).bind(...binds).all();
    return c.json({ data: results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب تعيينات المواد', detail: err.message }, 500);
  }
});

// GET /api/students/:id/subjects - active subjects for one student
app.get('/api/students/:id/subjects', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const id = Number(c.req.param('id'));
  try {
    const student = await db.prepare('SELECT school_id FROM students WHERE id = ?').bind(id).first<{ school_id: number }>();
    if (!student) return c.json({ error: 'الطالب غير موجود' }, 404);
    if (user && user.role_key !== 'system_admin' && student.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: لا يمكنك الوصول إلى بيانات هذا الطالب' }, 403);
    }
    const { results } = await db.prepare(`
      SELECT ss.*, su.name as subject_name, su.subject_type, su.religious_track, su.counts_in_average, su.appears_in_report_card, c.name as class_name, se.name as section_name
      FROM student_subjects ss
      JOIN subjects su ON ss.subject_id = su.id AND su.school_id = ss.school_id
      LEFT JOIN classes c ON ss.class_id = c.id AND c.school_id = ss.school_id
      LEFT JOIN sections se ON ss.section_id = se.id AND se.school_id = ss.school_id
      WHERE ss.student_id = ? AND ss.school_id = ? AND ss.is_active = 1
      ORDER BY su.order_index, su.id
    `).bind(id, student.school_id).all();
    return c.json({ data: results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب مواد الطالب', detail: err.message }, 500);
  }
});

// GET /api/students/:id/religious-subject - explicit academic religious-subject state.
app.get('/api/students/:id/religious-subject', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_ACCESS_ROLES), async (c) => {
  const db = c.env.DB;
  const studentId = Number(c.req.param('id'));
  const schoolId: number | null = c.get('resolvedSchoolId');
  const scope: 'all' | 'single' = c.get('scope');
  try {
    if (!Number.isInteger(studentId) || studentId <= 0) return c.json({ error: 'معرّف الطالب غير صالح' }, 400);
    if (scope !== 'single' || schoolId == null) return c.json({ error: 'يجب تحديد المدرسة المستهدفة' }, 400);

    const student = await getStudentWithEffectivePlacement(db, studentId);
    if (!student) return c.json({ error: 'الطالب غير موجود' }, 404);
    if (student.school_id !== schoolId) return c.json({ error: 'غير مسموح: الطالب ينتمي إلى مدرسة أخرى' }, 403);

    const currentAssignment = await findActiveReligiousAssignment(db, schoolId, studentId);
    const placementAvailable = student.class_id != null;
    const candidates = placementAvailable
      ? await db.prepare(`
          SELECT id AS subject_id, name AS subject_name, religious_track, class_id, section_id
          FROM subjects
          WHERE school_id = ?
            AND status = 'active'
            AND religious_track IS NOT NULL
            AND class_id = ?
            AND (section_id IS NULL OR section_id = ?)
          ORDER BY order_index, id
        `).bind(schoolId, student.class_id, student.section_id).all<{
          subject_id: number;
          subject_name: string;
          religious_track: ReligiousTrack;
          class_id: number;
          section_id: number | null;
        }>()
      : { results: [] };

    return c.json({
      data: {
        current_assignment: currentAssignment,
        candidates: candidates.results || [],
        meta: {
          placement_available: placementAvailable,
          class_id: student.class_id,
          section_id: student.section_id,
          message: placementAvailable ? null : 'لا يملك الطالب موقعًا دراسيًا حاليًا لاختيار مادة ديانة مناسبة.',
        },
      },
    });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب مادة الديانة الدراسية', detail: err.message }, 500);
  }
});

type ReligiousSubjectSelection = {
  id: number;
  school_id: number;
  name: string;
  class_id: number;
  section_id: number | null;
  status: string;
  religious_track: ReligiousTrack | null;
};

// PUT /api/students/:id/religious-subject - atomically set, switch, or remove the explicit assignment.
app.put('/api/students/:id/religious-subject', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const studentId = Number(c.req.param('id'));
  try {
    if (!Number.isInteger(studentId) || studentId <= 0) return c.json({ error: 'معرّف الطالب غير صالح' }, 400);
    const body = await c.req.json();
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);

    const student = await getStudentWithEffectivePlacement(db, studentId);
    if (!student) return c.json({ error: 'الطالب غير موجود' }, 404);
    if (student.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: الطالب ينتمي إلى مدرسة أخرى' }, 403);
    }

    const requestedSubjectId = body.subject_id == null || body.subject_id === '' ? null : Number(body.subject_id);
    if (requestedSubjectId != null && (!Number.isInteger(requestedSubjectId) || requestedSubjectId <= 0)) {
      return c.json({ error: 'معرّف المادة غير صالح' }, 400);
    }

    let requestedSubject: ReligiousSubjectSelection | null = null;
    if (requestedSubjectId != null) {
      requestedSubject = await db.prepare(`
        SELECT id, school_id, name, class_id, section_id, status, religious_track
        FROM subjects WHERE id = ?
      `).bind(requestedSubjectId).first<ReligiousSubjectSelection>();
      if (!requestedSubject) return c.json({ error: 'المادة غير موجودة' }, 404);
      if (requestedSubject.school_id !== targetSchool.schoolId) {
        return c.json({ error: 'غير مسموح: المادة تنتمي إلى مدرسة أخرى' }, 403);
      }
      if (requestedSubject.status !== 'active') return c.json({ error: 'يجب اختيار مادة فعالة' }, 400);
      if (requestedSubject.religious_track == null) return c.json({ error: 'المادة المحددة ليست مادة ديانة' }, 400);
      if (student.class_id == null) return c.json({ error: 'لا يملك الطالب صفًا حاليًا صالحًا لتعيين مادة ديانة' }, 400);
      if (requestedSubject.class_id !== student.class_id) return c.json({ error: 'مادة الديانة لا تتبع صف الطالب الحالي' }, 400);
      if (requestedSubject.section_id != null && requestedSubject.section_id !== student.section_id) {
        return c.json({ error: 'مادة الديانة لا تتبع شعبة الطالب الحالية' }, 400);
      }
    }

    const currentAssignment = await findActiveReligiousAssignment(db, targetSchool.schoolId, studentId);
    if (currentAssignment?.subject_id === requestedSubjectId || (!currentAssignment && requestedSubjectId == null)) {
      return c.json({ data: { current_assignment: currentAssignment, already_applied: true } });
    }

    if (currentAssignment) {
      const recordedGradeData = await hasRecordedReligiousSubjectGrades(db, targetSchool.schoolId, currentAssignment.assignment_id);
      if (recordedGradeData && body.confirm_existing_grades !== true) {
        return c.json({
          error: 'توجد درجات محفوظة لمادة الديانة الحالية وتحتاج إلى تأكيد قبل تغييرها.',
          code: RELIGIOUS_SUBJECT_HAS_GRADES_CODE,
          meta: {
            current_assignment_id: currentAssignment.assignment_id,
            current_subject_id: currentAssignment.subject_id,
            current_subject_name: currentAssignment.subject_name,
            recorded_grade_data: true,
          },
        }, 409);
      }
    }

    if (requestedSubject) {
      const conflictingAssignment = await findActiveReligiousAssignment(db, targetSchool.schoolId, studentId, {
        excludeAssignmentId: currentAssignment?.assignment_id,
        excludeSubjectId: requestedSubject.id,
      });
      if (conflictingAssignment) {
        return c.json({ error: RELIGIOUS_SUBJECT_CONFLICT_ERROR, meta: { conflicting_assignment_id: conflictingAssignment.assignment_id } }, 409);
      }
    }

    const statements: D1PreparedStatement[] = [];
    if (currentAssignment) {
      statements.push(db.prepare(`
        UPDATE student_subjects
        SET is_active = 0, removed_at = unixepoch(), updated_at = unixepoch()
        WHERE id = ? AND school_id = ? AND student_id = ? AND is_active = 1
      `).bind(currentAssignment.assignment_id, targetSchool.schoolId, studentId));
    }
    if (requestedSubject) {
      statements.push(db.prepare(`
        INSERT INTO student_subjects (
          school_id, student_id, subject_id, class_id, section_id, is_active,
          assigned_by_user_id, assigned_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, unixepoch(), unixepoch(), unixepoch())
      `).bind(
        targetSchool.schoolId,
        studentId,
        requestedSubject.id,
        student.class_id,
        student.section_id,
        user!.id,
      ));
    }
    const results = statements.length > 0 ? await db.batch(statements) : [];
    const insertedResult = requestedSubject ? results[results.length - 1] : null;
    const nextAssignment = requestedSubject ? {
      assignment_id: Number(insertedResult?.meta?.last_row_id),
      subject_id: requestedSubject.id,
      subject_name: requestedSubject.name,
      religious_track: requestedSubject.religious_track,
    } : null;
    return c.json({ data: { current_assignment: nextAssignment, already_applied: false } });
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث مادة الديانة الدراسية', detail: err.message }, 500);
  }
});

// POST /api/student-subjects/assign-class - assign to all active students in a class
app.post('/api/student-subjects/assign-class', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId');
  try {
    const body = await c.req.json();
    const { class_id, subject_ids } = body;
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    if (!class_id) return c.json({ error: 'يجب اختيار الصف' }, 400);
    if (!Array.isArray(subject_ids) || subject_ids.length === 0) return c.json({ error: 'يجب اختيار مادة واحدة على الأقل' }, 400);

    const cls = await db.prepare('SELECT school_id FROM classes WHERE id = ?').bind(class_id).first<{ school_id: number }>();
    if (!cls) return c.json({ error: 'الصف غير موجود' }, 404);
    if (cls.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: الصف لا ينتمي إلى مدرستك' }, 403);
    }

    const school_id = cls.school_id;
    const { results: students } = await db.prepare('SELECT id, section_id FROM students WHERE school_id = ? AND class_id = ? AND status = \'active\'').bind(school_id, class_id).all<{ id: number; section_id: number | null }>();
    if (!students || students.length === 0) return c.json({ error: 'لا يوجد طلاب نشطون في هذا الصف' }, 400);

    // Validate all subjects belong to this school and class
    const subjectChecks = await db.prepare(`
      SELECT id, class_id, section_id, religious_track FROM subjects WHERE id IN (${subject_ids.map(() => '?').join(',')}) AND school_id = ?
    `).bind(...subject_ids, school_id).all<{ id: number; class_id: number | null; section_id: number | null; religious_track: ReligiousTrack | null }>();
    if ((subjectChecks.results || []).some((subject) => subject.religious_track != null)) {
      return c.json({ error: RELIGIOUS_SUBJECT_BULK_ERROR }, 400);
    }
    const validSubjectIds = new Set((subjectChecks.results || []).map((s) => s.id));
    const mismatchedSubjects = (subjectChecks.results || []).filter((s) => s.class_id != null && String(s.class_id) !== String(class_id));
    if (mismatchedSubjects.length > 0) {
      return c.json({ error: `بعض المواد لا تنتمي لهذا الصف: ${mismatchedSubjects.map((s) => s.id).join(', ')}` }, 400);
    }

    const inserted: number[] = [];
    const skipped: number[] = [];
    for (const st of students) {
      for (const suId of subject_ids) {
        if (!validSubjectIds.has(Number(suId))) { skipped.push(st.id); continue; }
        const existing = await db.prepare('SELECT id FROM student_subjects WHERE school_id = ? AND student_id = ? AND subject_id = ? AND is_active = 1').bind(school_id, st.id, suId).first();
        if (existing) { skipped.push(st.id); continue; }
        await db.prepare(`
          INSERT INTO student_subjects (school_id, student_id, subject_id, class_id, section_id, is_active, assigned_by_user_id, assigned_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, unixepoch(), unixepoch(), unixepoch())
        `).bind(school_id, st.id, suId, class_id, st.section_id || null, user?.id || null).run();
        inserted.push(st.id);
      }
    }
    return c.json({ data: { inserted_count: inserted.length, skipped_count: skipped.length } });
  } catch (err: any) {
    return c.json({ error: 'فشل في تعيين المواد للصف', detail: err.message }, 500);
  }
});

// POST /api/student-subjects/assign-section - assign to all active students in a section
app.post('/api/student-subjects/assign-section', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  try {
    const body = await c.req.json();
    const { section_id, subject_ids } = body;
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    if (!section_id) return c.json({ error: 'يجب اختيار الشعبة' }, 400);
    if (!Array.isArray(subject_ids) || subject_ids.length === 0) return c.json({ error: 'يجب اختيار مادة واحدة على الأقل' }, 400);

    const sec = await db.prepare('SELECT school_id, class_id FROM sections WHERE id = ?').bind(section_id).first<{ school_id: number; class_id: number }>();
    if (!sec) return c.json({ error: 'الشعبة غير موجودة' }, 404);
    if (sec.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: الشعبة لا تنتمي إلى مدرستك' }, 403);
    }

    const { results: students } = await db.prepare('SELECT id FROM students WHERE school_id = ? AND section_id = ? AND status = \'active\'').bind(sec.school_id, section_id).all<{ id: number }>();
    if (!students || students.length === 0) return c.json({ error: 'لا يوجد طلاب نشطون في هذه الشعبة' }, 400);

    // Validate all subjects belong to this school, class, and section
    const subjectChecks = await db.prepare(`
      SELECT id, class_id, section_id, religious_track FROM subjects WHERE id IN (${subject_ids.map(() => '?').join(',')}) AND school_id = ?
    `).bind(...subject_ids, sec.school_id).all<{ id: number; class_id: number | null; section_id: number | null; religious_track: ReligiousTrack | null }>();
    if ((subjectChecks.results || []).some((subject) => subject.religious_track != null)) {
      return c.json({ error: RELIGIOUS_SUBJECT_BULK_ERROR }, 400);
    }
    const validSubjectIds = new Set((subjectChecks.results || []).map((s) => s.id));
    const mismatchedSubjects = (subjectChecks.results || []).filter((s) =>
      (s.class_id != null && String(s.class_id) !== String(sec.class_id)) ||
      (s.section_id != null && String(s.section_id) !== String(section_id))
    );
    if (mismatchedSubjects.length > 0) {
      return c.json({ error: `بعض المواد لا تنتمي لهذه الشعبة: ${mismatchedSubjects.map((s) => s.id).join(', ')}` }, 400);
    }

    const inserted: number[] = [];
    const skipped: number[] = [];
    for (const st of students) {
      for (const suId of subject_ids) {
        if (!validSubjectIds.has(Number(suId))) { skipped.push(st.id); continue; }
        const existing = await db.prepare('SELECT id FROM student_subjects WHERE school_id = ? AND student_id = ? AND subject_id = ? AND is_active = 1').bind(sec.school_id, st.id, suId).first();
        if (existing) { skipped.push(st.id); continue; }
        await db.prepare(`
          INSERT INTO student_subjects (school_id, student_id, subject_id, class_id, section_id, is_active, assigned_by_user_id, assigned_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, unixepoch(), unixepoch(), unixepoch())
        `).bind(sec.school_id, st.id, suId, sec.class_id, section_id, user?.id || null).run();
        inserted.push(st.id);
      }
    }
    return c.json({ data: { inserted_count: inserted.length, skipped_count: skipped.length } });
  } catch (err: any) {
    return c.json({ error: 'فشل في تعيين المواد للشعبة', detail: err.message }, 500);
  }
});

// POST /api/student-subjects/assign-students - assign to a chosen list of students
app.post('/api/student-subjects/assign-students', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  try {
    const body = await c.req.json();
    const { student_ids, subject_ids } = body;
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    if (!Array.isArray(student_ids) || student_ids.length === 0) return c.json({ error: 'يجب اختيار طالب واحد على الأقل' }, 400);
    if (!Array.isArray(subject_ids) || subject_ids.length === 0) return c.json({ error: 'يجب اختيار مادة واحدة على الأقل' }, 400);

    const requestedSubjects = await db.prepare(`
      SELECT id, religious_track
      FROM subjects
      WHERE school_id = ? AND id IN (${subject_ids.map(() => '?').join(',')})
    `).bind(targetSchool.schoolId, ...subject_ids).all<{ id: number; religious_track: ReligiousTrack | null }>();
    const requestedReligiousSubjects = (requestedSubjects.results || []).filter((subject) => subject.religious_track != null);
    if (requestedReligiousSubjects.length > 1) {
      return c.json({ error: 'لا يمكن أن يحتوي طلب واحد على أكثر من مادة ديانة واحدة' }, 400);
    }
    const requestedReligiousSubject = requestedReligiousSubjects[0] || null;
    if (requestedReligiousSubject) {
      for (const rawStudentId of student_ids) {
        const studentId = Number(rawStudentId);
        const assignmentValidation = await validateStudentSubjectAssignment(
          db,
          targetSchool.schoolId,
          studentId,
          requestedReligiousSubject.id,
        );
        if (!assignmentValidation.ok) return c.json({ error: assignmentValidation.error }, assignmentValidation.status);
        const conflict = await findActiveReligiousAssignment(db, targetSchool.schoolId, studentId, {
          excludeSubjectId: requestedReligiousSubject.id,
        });
        if (conflict) {
          return c.json({
            error: RELIGIOUS_SUBJECT_CONFLICT_ERROR,
            meta: { student_id: studentId, conflicting_assignment_id: conflict.assignment_id },
          }, 409);
        }
      }
    }

    const inserted: number[] = [];
    const skipped: number[] = [];
    for (const sid of student_ids) {
      const st = await getStudentClassSection(db, Number(sid));
      if (!st) { skipped.push(Number(sid)); continue; }
      const studentMeta = await db.prepare('SELECT school_id FROM students WHERE id = ?').bind(Number(sid)).first<{ school_id: number }>();
      if (!studentMeta) { skipped.push(Number(sid)); continue; }
      const school_id = studentMeta.school_id;
      if (school_id !== targetSchool.schoolId) {
        return c.json({ error: 'غير مسموح: أحد الطلاب لا ينتمي إلى مدرستك' }, 403);
      }
      for (const suId of subject_ids) {
        const su = await db.prepare('SELECT school_id, class_id, section_id FROM subjects WHERE id = ?').bind(Number(suId)).first<{ school_id: number; class_id: number | null; section_id: number | null }>();
        if (!su) { skipped.push(Number(sid)); continue; }
        if (su.school_id !== school_id) {
          return c.json({ error: 'غير مسموح: المادة والطالب لا ينتميان إلى المدرسة نفسها' }, 403);
        }
        if (su && su.class_id != null && String(su.class_id) !== String(st.class_id)) { skipped.push(Number(sid)); continue; }
        if (su && su.section_id != null && String(su.section_id) !== String(st.section_id)) { skipped.push(Number(sid)); continue; }
        const existing = await db.prepare('SELECT id FROM student_subjects WHERE school_id = ? AND student_id = ? AND subject_id = ? AND is_active = 1').bind(school_id, sid, suId).first();
        if (existing) { skipped.push(Number(sid)); continue; }
        await db.prepare(`
          INSERT INTO student_subjects (school_id, student_id, subject_id, class_id, section_id, is_active, assigned_by_user_id, assigned_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, unixepoch(), unixepoch(), unixepoch())
        `).bind(school_id, sid, suId, st.class_id || null, st.section_id || null, user?.id || null).run();
        inserted.push(Number(sid));
      }
    }
    return c.json({ data: { inserted_count: inserted.length, skipped_count: skipped.length } });
  } catch (err: any) {
    return c.json({ error: 'فشل في تعيين المواد للطلاب', detail: err.message }, 500);
  }
});

// POST /api/student-subjects/assign-one - assign to a single student
app.post('/api/student-subjects/assign-one', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  try {
    const body = await c.req.json();
    const { student_id, subject_id } = body;
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    if (!student_id || !subject_id) return c.json({ error: 'الطالب والمادة مطلوبان' }, 400);
    const check = await verifyStudentSubjectSchool(db, user, Number(student_id), Number(subject_id));
    if (!check.ok) return c.json({ error: check.error }, (check.status || 400) as any);
    const school_id = check.school_id!;
    if (school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: الطالب أو المادة لا ينتمي إلى المدرسة المستهدفة' }, 403);
    }

    // Validate class/section match for the subject
    const st = await getStudentClassSection(db, Number(student_id));
    const su = await db.prepare('SELECT class_id, section_id, religious_track FROM subjects WHERE id = ?').bind(Number(subject_id)).first<{ class_id: number | null; section_id: number | null; religious_track: ReligiousTrack | null }>();
    if (su && su.class_id != null && String(su.class_id) !== String(st?.class_id)) {
      return c.json({ error: 'المادة مخصصة لصف مختلف عن صف الطالب' }, 400);
    }
    if (su && su.section_id != null && String(su.section_id) !== String(st?.section_id)) {
      return c.json({ error: 'المادة مخصصة لشعبة مختلفة عن شعبة الطالب' }, 400);
    }

    const existing = await db.prepare('SELECT id FROM student_subjects WHERE school_id = ? AND student_id = ? AND subject_id = ? AND is_active = 1').bind(school_id, student_id, subject_id).first();
    if (existing) return c.json({ error: 'هذه المادة مضافة مسبقًا لهذا الطالب' }, 409);
    if (su?.religious_track != null) {
      const conflict = await findActiveReligiousAssignment(db, school_id, Number(student_id), { excludeSubjectId: Number(subject_id) });
      if (conflict) {
        return c.json({ error: RELIGIOUS_SUBJECT_CONFLICT_ERROR, meta: { conflicting_assignment_id: conflict.assignment_id } }, 409);
      }
    }

    const result = await db.prepare(`
      INSERT INTO student_subjects (school_id, student_id, subject_id, class_id, section_id, is_active, assigned_by_user_id, assigned_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, unixepoch(), unixepoch(), unixepoch())
    `).bind(school_id, student_id, subject_id, st?.class_id || null, st?.section_id || null, user?.id || null).run();
    return c.json({ data: { id: result.meta.last_row_id, student_id, subject_id, is_active: 1 } }, 201);
  } catch (err: any) {
    return c.json({ error: 'فشل في تعيين المادة', detail: err.message }, 500);
  }
});

// PUT /api/student-subjects/:id/reactivate - reactivate a deactivated assignment
app.put('/api/student-subjects/:id/reactivate', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const id = Number(c.req.param('id'));
  try {
    const body = await c.req.json().catch(() => ({}));
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const row = await db.prepare(`
      SELECT assignment.school_id, assignment.student_id, assignment.subject_id, assignment.is_active,
             subject.religious_track
      FROM student_subjects assignment
      JOIN subjects subject ON subject.id = assignment.subject_id AND subject.school_id = assignment.school_id
      WHERE assignment.id = ?
    `).bind(id).first<{ school_id: number; student_id: number; subject_id: number; is_active: number; religious_track: ReligiousTrack | null }>();
    if (!row) return c.json({ error: 'التعيين غير موجود' }, 404);
    if (row.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: لا يمكنك تعديل تعيين في مدرسة أخرى' }, 403);
    }
    if (row.is_active === 1) return c.json({ error: 'التعيين مفعّل مسبقًا' }, 400);

    // Prevent reactivation if another active assignment exists for same student+subject
    const existingActive = await db.prepare('SELECT id FROM student_subjects WHERE school_id = ? AND student_id = ? AND subject_id = ? AND is_active = 1').bind(row.school_id, row.student_id, row.subject_id).first();
    if (existingActive) {
      return c.json({ error: 'لا يمكن إعادة التفعيل: يوجد تعيين نشط آخر للطالب في نفس المادة' }, 409);
    }
    if (row.religious_track != null) {
      const conflict = await findActiveReligiousAssignment(db, row.school_id, row.student_id, {
        excludeAssignmentId: id,
        excludeSubjectId: row.subject_id,
      });
      if (conflict) {
        return c.json({ error: RELIGIOUS_SUBJECT_CONFLICT_ERROR, meta: { conflicting_assignment_id: conflict.assignment_id } }, 409);
      }
    }

    await db.prepare(`UPDATE student_subjects SET is_active = 1, removed_at = NULL, updated_at = unixepoch() WHERE id = ? AND school_id = ?`).bind(id, targetSchool.schoolId).run();
    return c.json({ data: { id, is_active: 1, message: 'تم إعادة تفعيل التعيين بنجاح' } });
  } catch (err: any) {
    return c.json({ error: 'فشل في إعادة تفعيل التعيين', detail: err.message }, 500);
  }
});

// PUT /api/student-subjects/:id/deactivate - deactivate one assignment
app.put('/api/student-subjects/:id/deactivate', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const id = Number(c.req.param('id'));
  try {
    const body = await c.req.json().catch(() => ({}));
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const result = await deactivateStudentSubjectAssignments(db, targetSchool.schoolId, [id]);
    if (!result.ok) {
      return c.json({ error: result.error, code: result.code, meta: result.meta }, result.status);
    }
    return c.json({ data: { id, is_active: 0 } });
  } catch (err: any) {
    return c.json({ error: 'فشل في إلغاء التعيين', detail: err.message }, 500);
  }
});

// POST /api/student-subjects/bulk-deactivate - deactivate multiple assignments
app.post('/api/student-subjects/bulk-deactivate', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  try {
    const body = await c.req.json();
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const ids: unknown[] = body.ids || [];
    if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: 'يجب اختيار تعيين واحد على الأقل' }, 400);
    const result = await deactivateStudentSubjectAssignments(db, targetSchool.schoolId, ids);
    if (!result.ok) {
      return c.json({ error: result.error, code: result.code, meta: result.meta }, result.status);
    }
    return c.json({ data: { affected: result.affected } });
  } catch (err: any) {
    return c.json({ error: 'فشل في إلغاء التعيينات', detail: err.message }, 500);
  }
});

// ===========================================

// ===========================================
// Phase 4: Grades & Academic Calculations
// ===========================================

// ===========================================
// Phase 4: Grades & Academic Calculations API
// These routes are appended to worker.ts at build time or imported
// ===========================================

// NOTE: This file is meant to be concatenated into worker.ts manually
// since we can't use ES modules imports in the single-file worker pattern.

// ===========================================
// Grade Calculation Helpers
// ===========================================

function validateGradeValue(value: any, maxGrade: number, fieldName: string): { ok: boolean; error?: string; numeric?: number | null } {
  if (value === '' || value === null || value === undefined) {
    return { ok: true, numeric: null };
  }
  const num = Number(value);
  if (isNaN(num)) {
    return { ok: false, error: `القيمة في حقل ${fieldName} ليست رقمًا صحيحًا` };
  }
  if (num < 0 || num > maxGrade) {
    return { ok: false, error: `القيمة في حقل ${fieldName} يجب أن تكون بين ٠ و ${maxGrade}` };
  }
  return { ok: true, numeric: num };
}

function withNormalizedGradeScheme<T extends Record<string, any>>(settings: T): T {
  return { ...settings, ...normalizeGradeSchemeSettings(settings) };
}

function buildRawGradeUpdates(
  payload: Record<string, any>,
  settings: Record<string, any>,
): { ok: true; updates: Partial<Record<RawGradeField, number | null>> } | { ok: false; error: string } {
  const updates: Partial<Record<RawGradeField, number | null>> = {};
  const disabledField = disabledRawGradeFields(payload, settings)[0];
  if (disabledField) {
    return { ok: false, error: `الحقل «${RAW_GRADE_FIELD_LABELS[disabledField]}» غير مفعّل في نظام الدرجات الحالي` };
  }
  for (const field of RAW_GRADE_FIELDS) {
    if (payload[field] === undefined) continue;
    const validated = validateGradeValue(payload[field], settings.max_grade, RAW_GRADE_FIELD_LABELS[field]);
    if (!validated.ok) return { ok: false, error: validated.error! };
    updates[field] = validated.numeric ?? null;
  }
  return { ok: true, updates };
}

function gradeCalculationInput(
  gradeRow: Record<string, any>,
  updates: Partial<Record<RawGradeField, number | null>>,
): RawGradeValues {
  return Object.fromEntries(RAW_GRADE_FIELDS.map(field => [
    field,
    updates[field] !== undefined ? updates[field] : gradeRow[field] ?? null,
  ])) as RawGradeValues;
}

// ===========================================
// Grade Settings Routes
// ===========================================

app.get('/api/grade-settings', requireSameSchoolOrAdmin(), requireRoles(SETTINGS_VIEW_ROLES), async (c) => {
  const db = c.env.DB;
  try {
    const scope = c.get('scope');
    const resolvedSchoolId = c.get('resolvedSchoolId');

    if (scope !== 'single' || !resolvedSchoolId) {
      return c.json({ error: 'يجب تحديد المدرسة المستهدفة لعرض إعدادات الدرجات' }, 400);
    }

    const row = await db.prepare('SELECT * FROM grade_settings WHERE school_id = ?').bind(resolvedSchoolId).first<any>();
    if (!row) {
      // Auto-create default settings for this school
      await db.prepare(`
        INSERT INTO grade_settings (school_id, max_grade, passing_grade, exemption_grade, general_exemption_average_grade, general_exemption_min_subject_grade, created_at, updated_at)
        VALUES (?, 100, 50, 90, 85, 75, unixepoch(), unixepoch())
      `).bind(resolvedSchoolId).run();
      const newRow = await db.prepare('SELECT * FROM grade_settings WHERE school_id = ?').bind(resolvedSchoolId).first<any>();
      return c.json({ data: newRow ? withNormalizedGradeScheme(newRow) : null });
    }
    return c.json({ data: withNormalizedGradeScheme(row) });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب إعدادات الدرجات', detail: err.message }, 500);
  }
});

app.put('/api/grade-settings', requireSameSchoolOrAdmin(), requireRoles(SETTINGS_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  try {
    const body = await c.req.json();
    const { school_id, max_grade, passing_grade, exemption_grade,
      general_exemption_average_grade, general_exemption_min_subject_grade,
      first_term_formula, second_term_formula, annual_effort_formula,
      final_grade_formula, completion_formula, effective_formula } = body;

    const schemeError = validateGradeSchemeSettings(body);
    if (schemeError) return c.json({ error: schemeError }, 400);

    const targetSchool = await resolveActiveWriteSchool(db, user, school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const targetSchoolId = targetSchool.schoolId;

    // Check existing
    const existing = await db.prepare('SELECT id FROM grade_settings WHERE school_id = ?').bind(targetSchoolId).first<{ id: number }>();

    // Resolve effective values for validation (use existing row or defaults)
    const existingRow = existing ? await db.prepare('SELECT * FROM grade_settings WHERE school_id = ?').bind(targetSchoolId).first<any>() : null;
    const effMax = max_grade !== undefined && max_grade !== null ? Number(max_grade) : (existingRow?.max_grade ?? 100);
    const effPass = passing_grade !== undefined && passing_grade !== null ? Number(passing_grade) : (existingRow?.passing_grade ?? 50);
    const effExempt = exemption_grade !== undefined && exemption_grade !== null ? Number(exemption_grade) : (existingRow?.exemption_grade ?? 90);
    const effGenAvg = general_exemption_average_grade !== undefined && general_exemption_average_grade !== null ? Number(general_exemption_average_grade) : (existingRow?.general_exemption_average_grade ?? 85);
    const effGenMin = general_exemption_min_subject_grade !== undefined && general_exemption_min_subject_grade !== null ? Number(general_exemption_min_subject_grade) : (existingRow?.general_exemption_min_subject_grade ?? 75);
    const effectiveScheme = normalizeGradeSchemeSettings({ ...existingRow, ...body });
    const effectiveSchemeError = validateGradeSchemeSettings(effectiveScheme);
    if (effectiveSchemeError) return c.json({ error: effectiveSchemeError }, 400);

    if (!isFinite(effMax) || !isFinite(effPass) || !isFinite(effExempt) || !isFinite(effGenAvg) || !isFinite(effGenMin)) {
      return c.json({ error: 'قيم الدرجات يجب أن تكون أرقاماً صالحة' }, 400);
    }
    if (effMax <= 0) {
      return c.json({ error: 'الحد الأقصى للدرجة يجب أن يكون أكبر من 0' }, 400);
    }
    if (effPass < 0 || effPass > effMax) {
      return c.json({ error: 'درجة النجاح يجب أن تكون بين 0 والحد الأقصى' }, 400);
    }
    if (effExempt < effPass) {
      return c.json({ error: 'درجة الإعفاء يجب أن تكون أكبر من أو تساوي درجة النجاح' }, 400);
    }
    if (effExempt > effMax) {
      return c.json({ error: 'درجة الإعفاء يجب أن تكون أقل من أو تساوي الحد الأقصى' }, 400);
    }
    if (effGenAvg < effPass || effGenAvg > effMax) {
      return c.json({ error: 'متوسط الإعفاء العام يجب أن يكون بين درجة النجاح والحد الأقصى' }, 400);
    }
    if (effGenMin < effPass || effGenMin > effGenAvg) {
      return c.json({ error: 'أدنى درجة للإعفاء العام يجب أن تكون بين درجة النجاح ومتوسط الإعفاء العام' }, 400);
    }

    const currentMax = Number(existingRow?.max_grade ?? 100);
    if (shouldCheckRawGradeMaxConflict(currentMax, effMax)) {
      const rawMaxConflict = await db.prepare(RAW_GRADE_MAX_CONFLICT_SQL)
        .bind(targetSchoolId, effMax)
        .first<RawGradeMaxConflict>();
      const conflictingGradeRows = Number(rawMaxConflict?.conflicting_grade_rows || 0);
      if (conflictingGradeRows > 0) {
        return c.json({
          error: 'لا يمكن تخفيض الدرجة العظمى لأن هناك درجات محفوظة تتجاوز الحد الجديد',
          meta: {
            conflicting_grade_rows: conflictingGradeRows,
            highest_raw_grade: rawMaxConflict?.highest_raw_grade == null
              ? null
              : Number(rawMaxConflict.highest_raw_grade),
          },
        }, 400);
      }
    }

    let settingsStatement: D1PreparedStatement;
    if (existing) {
      settingsStatement = db.prepare(`
        UPDATE grade_settings SET
          max_grade = COALESCE(?, max_grade),
          passing_grade = COALESCE(?, passing_grade),
          exemption_grade = COALESCE(?, exemption_grade),
          general_exemption_average_grade = COALESCE(?, general_exemption_average_grade),
          general_exemption_min_subject_grade = COALESCE(?, general_exemption_min_subject_grade),
          first_term_input_mode = COALESCE(?, first_term_input_mode),
          second_term_input_mode = COALESCE(?, second_term_input_mode),
          mid_year_exam_enabled = COALESCE(?, mid_year_exam_enabled),
          final_exam_enabled = COALESCE(?, final_exam_enabled),
          completion_exam_enabled = COALESCE(?, completion_exam_enabled),
          first_term_formula = COALESCE(?, first_term_formula),
          second_term_formula = COALESCE(?, second_term_formula),
          annual_effort_formula = COALESCE(?, annual_effort_formula),
          final_grade_formula = COALESCE(?, final_grade_formula),
          completion_formula = COALESCE(?, completion_formula),
          effective_formula = COALESCE(?, effective_formula),
          updated_at = unixepoch(),
          updated_by_user_id = ?
        WHERE school_id = ?
      `).bind(
        max_grade ?? null, passing_grade ?? null, exemption_grade ?? null,
        general_exemption_average_grade ?? null, general_exemption_min_subject_grade ?? null,
        body.first_term_input_mode === undefined ? null : effectiveScheme.first_term_input_mode,
        body.second_term_input_mode === undefined ? null : effectiveScheme.second_term_input_mode,
        body.mid_year_exam_enabled === undefined ? null : effectiveScheme.mid_year_exam_enabled,
        body.final_exam_enabled === undefined ? null : effectiveScheme.final_exam_enabled,
        body.completion_exam_enabled === undefined ? null : effectiveScheme.completion_exam_enabled,
        first_term_formula ?? null, second_term_formula ?? null, annual_effort_formula ?? null,
        final_grade_formula ?? null, completion_formula ?? null, effective_formula ?? null,
        user?.id || null, targetSchoolId
      );
    } else {
      settingsStatement = db.prepare(`
        INSERT INTO grade_settings (school_id, max_grade, passing_grade, exemption_grade, general_exemption_average_grade, general_exemption_min_subject_grade, first_term_input_mode, second_term_input_mode, mid_year_exam_enabled, final_exam_enabled, completion_exam_enabled, first_term_formula, second_term_formula, annual_effort_formula, final_grade_formula, completion_formula, effective_formula, updated_by_user_id, created_at, updated_at)
        VALUES (?, COALESCE(?, 100), COALESCE(?, 50), COALESCE(?, 90), COALESCE(?, 85), COALESCE(?, 75), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
      `).bind(
        targetSchoolId, max_grade ?? null, passing_grade ?? null, exemption_grade ?? null,
        general_exemption_average_grade ?? null, general_exemption_min_subject_grade ?? null,
        effectiveScheme.first_term_input_mode, effectiveScheme.second_term_input_mode,
        effectiveScheme.mid_year_exam_enabled, effectiveScheme.final_exam_enabled, effectiveScheme.completion_exam_enabled,
        first_term_formula ?? null, second_term_formula ?? null, annual_effort_formula ?? null,
        final_grade_formula ?? null, completion_formula ?? null, effective_formula ?? null,
        user?.id || null
      );
    }

    // D1 batch is transactional: settings and all derived grade values commit
    // together, while the set-based recalculation keeps the query count fixed.
    const recalculationStatement = db.prepare(RECALCULATE_SCHOOL_GRADES_SQL)
      .bind(targetSchoolId, targetSchoolId);
    const batchResults = await db.batch([settingsStatement, recalculationStatement]);
    const recalculatedGrades = Number(batchResults[1]?.meta?.changes || 0);

    const row = await db.prepare('SELECT * FROM grade_settings WHERE school_id = ?').bind(targetSchoolId).first<any>();
    return c.json({
      data: row ? withNormalizedGradeScheme(row) : null,
      meta: { recalculated_grades: recalculatedGrades },
      message: 'تم حفظ إعدادات الدرجات وإعادة حساب الدرجات النشطة بنجاح',
    });
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث إعدادات الدرجات', detail: err.message }, 500);
  }
});

// ===========================================
// Grade Query Helpers
// ===========================================

async function getGradeSettings(db: D1Database, schoolId: number): Promise<any> {
  const row = await db.prepare('SELECT * FROM grade_settings WHERE school_id = ?').bind(schoolId).first<any>();
  if (!row) {
    // Insert defaults
    await db.prepare(`
      INSERT INTO grade_settings (school_id, max_grade, passing_grade, exemption_grade, general_exemption_average_grade, general_exemption_min_subject_grade, created_at, updated_at)
      VALUES (?, 100, 50, 90, 85, 75, unixepoch(), unixepoch())
    `).bind(schoolId).run();
    const inserted = await db.prepare('SELECT * FROM grade_settings WHERE school_id = ?').bind(schoolId).first<any>();
    return inserted ? withNormalizedGradeScheme(inserted) : null;
  }
  return withNormalizedGradeScheme(row);
}

async function getActiveStudentSubjects(db: D1Database, studentId: number, schoolId: number): Promise<any[]> {
  const rows = await db.prepare(`
    SELECT ss.id as student_subject_id, s.id as subject_id, s.name as subject_name,
           c.name as class_name, sec.name as section_name
    FROM student_subjects ss
    JOIN subjects s ON ss.subject_id = s.id AND s.school_id = ss.school_id
    LEFT JOIN classes c ON ss.class_id = c.id AND c.school_id = ss.school_id
    LEFT JOIN sections sec ON ss.section_id = sec.id AND sec.school_id = ss.school_id
    WHERE ss.student_id = ? AND ss.school_id = ? AND ss.is_active = 1 AND s.status = 'active'
    ORDER BY s.order_index, s.id
  `).bind(studentId, schoolId).all<any>();
  return rows.results || [];
}

// ===========================================
// GET /api/grades
// ===========================================

app.get('/api/grades', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  try {
    const scope = c.get('scope');
    const resolvedSchoolId = c.get('resolvedSchoolId');

    const q = c.req.query();
    const studentId = q.student_id ? Number(q.student_id) : null;
    const subjectId = q.subject_id ? Number(q.subject_id) : null;
    const classId = q.class_id ? Number(q.class_id) : null;
    const sectionId = q.section_id ? Number(q.section_id) : null;
    const isActive = q.is_active !== undefined ? Number(q.is_active) : null;

    let sql = `
      SELECT g.*,
             st.full_name as student_name, st.student_number,
             s.name as subject_name,
             c.name as class_name, sec.name as section_name
      FROM grades g
      JOIN student_subjects ss ON g.student_subject_id = ss.id
      JOIN students st ON ss.student_id = st.id
      JOIN subjects s ON ss.subject_id = s.id
      LEFT JOIN classes c ON st.class_id = c.id
      LEFT JOIN sections sec ON st.section_id = sec.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (scope === 'single' && resolvedSchoolId) {
      sql += ' AND g.school_id = ?';
      params.push(resolvedSchoolId);
    }
    if (studentId) {
      sql += ' AND ss.student_id = ?';
      params.push(studentId);
    }
    if (subjectId) {
      sql += ' AND ss.subject_id = ?';
      params.push(subjectId);
    }
    if (classId) {
      sql += ' AND st.class_id = ?';
      params.push(classId);
    }
    if (sectionId) {
      sql += ' AND st.section_id = ?';
      params.push(sectionId);
    }
    if (isActive !== null) {
      sql += ' AND g.is_active = ?';
      params.push(isActive);
    } else {
      sql += ' AND g.is_active = 1';
    }

    sql += ' ORDER BY st.full_name, st.id, s.order_index, s.id';

    const stmt = db.prepare(sql);
    const rows = await (params.length > 0 ? stmt.bind(...params).all<any>() : stmt.all<any>());
    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الدرجات', detail: err.message }, 500);
  }
});

// ===========================================
// GET /api/students/:id/grades
// ===========================================

app.get('/api/students/:id/grades', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const studentId = Number(c.req.param('id'));
  try {
    const student = await db.prepare('SELECT school_id, full_name FROM students WHERE id = ?').bind(studentId).first<{ school_id: number; full_name: string }>();
    if (!student) return c.json({ error: 'الطالب غير موجود' }, 404);

    if (user && user.role_key !== 'system_admin' && student.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: الطالب في مدرسة أخرى' }, 403);
    }

    const settings = await getGradeSettings(db, student.school_id);

    const rows = await db.prepare(`
      SELECT g.*, s.name as subject_name, s.id as subject_id
      FROM grades g
      JOIN student_subjects ss ON g.student_subject_id = ss.id AND ss.school_id = g.school_id
      JOIN subjects s ON ss.subject_id = s.id AND s.school_id = g.school_id
      WHERE ss.student_id = ? AND g.school_id = ? AND g.is_active = 1 AND ss.is_active = 1 AND s.status = 'active'
      ORDER BY s.order_index, s.id
    `).bind(studentId, student.school_id).all<any>();

    return c.json({ data: { student_name: student.full_name, settings, grades: rows.results || [] } });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب درجات الطالب', detail: err.message }, 500);
  }
});

// ===========================================
// POST /api/grades/initialize-student/:student_id
// Create empty grade rows for all active student_subjects
// ===========================================

app.post('/api/grades/initialize-student/:student_id', requireSameSchoolOrAdmin(), requireRoles(GRADE_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const studentId = Number(c.req.param('student_id'));
  try {
    const body = await c.req.json().catch(() => ({}));
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const student = await db.prepare('SELECT school_id FROM students WHERE id = ?').bind(studentId).first<{ school_id: number }>();
    if (!student) return c.json({ error: 'الطالب غير موجود' }, 404);

    if (student.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح' }, 403);
    }

    const activeAssignments = await getActiveStudentSubjects(db, studentId, student.school_id);
    let created = 0;
    let skipped = 0;

    for (const assignment of activeAssignments) {
      const existing = await db.prepare('SELECT id FROM grades WHERE student_subject_id = ? AND is_active = 1').bind(assignment.student_subject_id).first<any>();
      if (existing) {
        skipped++;
        continue;
      }
      await db.prepare(`
        INSERT INTO grades (school_id, student_subject_id, is_active, created_at, updated_at, updated_by_user_id)
        VALUES (?, ?, 1, unixepoch(), unixepoch(), ?)
      `).bind(student.school_id, assignment.student_subject_id, user?.id || null).run();
      created++;
    }

    return c.json({ data: { created, skipped, total: activeAssignments.length } });
  } catch (err: any) {
    return c.json({ error: 'فشل في تهيئة درجات الطالب', detail: err.message }, 500);
  }
});

// ===========================================
// POST /api/grades/initialize-section
// Initialize grades for all students in a section for given subjects
// ===========================================

app.post('/api/grades/initialize-section', requireSameSchoolOrAdmin(), requireRoles(GRADE_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  try {
    const body = await c.req.json();
    const { section_id, subject_ids } = body;
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    if (!section_id) return c.json({ error: 'معرف الشعبة مطلوب' }, 400);
    if (!Array.isArray(subject_ids) || subject_ids.length === 0) return c.json({ error: 'يجب اختيار مادة واحدة على الأقل' }, 400);

    const section = await db.prepare('SELECT school_id, class_id FROM sections WHERE id = ?').bind(Number(section_id)).first<{ school_id: number; class_id: number }>();
    if (!section) return c.json({ error: 'الشعبة غير موجودة' }, 404);

    if (section.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح' }, 403);
    }

    const students = (await listStudentsWithEffectivePlacement(db, {
      schoolId: section.school_id,
      classId: section.class_id,
      sectionId: Number(section_id),
    })).filter((student) => student.status === 'active');
    let created = 0;
    let skipped = 0;

    for (const st of students) {
      for (const suId of subject_ids) {
        const ss = await db.prepare(`
          SELECT ss.id
          FROM student_subjects ss
          INNER JOIN subjects su
            ON su.id = ss.subject_id
           AND su.school_id = ss.school_id
           AND su.status = 'active'
          WHERE ss.student_id = ? AND ss.subject_id = ? AND ss.school_id = ?
            AND ss.class_id = ? AND ss.section_id = ? AND ss.is_active = 1
        `).bind(st.id, suId, section.school_id, section.class_id, Number(section_id)).first<{ id: number }>();
        if (!ss) { skipped++; continue; }

        const existing = await db.prepare('SELECT id FROM grades WHERE student_subject_id = ? AND is_active = 1').bind(ss.id).first<any>();
        if (existing) { skipped++; continue; }

        await db.prepare(`
          INSERT INTO grades (school_id, student_subject_id, is_active, created_at, updated_at, updated_by_user_id)
          VALUES (?, ?, 1, unixepoch(), unixepoch(), ?)
        `).bind(section.school_id, ss.id, user?.id || null).run();
        created++;
      }
    }

    return c.json({ data: { created, skipped } });
  } catch (err: any) {
    return c.json({ error: 'فشل في تهيئة درجات الشعبة', detail: err.message }, 500);
  }
});

// ===========================================
// PUT /api/grades/:id - update grade fields with calculations & audit log
// ===========================================

app.put('/api/grades/:id', requireRoles(GRADE_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const gradeId = Number(c.req.param('id'));
  try {
    const body = await c.req.json();
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const gradeRow = await db.prepare(`
      SELECT g.*, ss.is_active as ss_active, s.status as subject_status
      FROM grades g
      JOIN student_subjects ss ON g.student_subject_id = ss.id
      JOIN subjects s ON ss.subject_id = s.id
      WHERE g.id = ?
    `).bind(gradeId).first<any>();
    if (!gradeRow) return c.json({ error: 'الدرجة غير موجودة' }, 404);

    if (gradeRow.ss_active !== 1 || gradeRow.subject_status !== 'active') {
      return c.json({ error: 'المادة غير مفعلة أو غير مسندة للطالب' }, 403);
    }

    if (gradeRow.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح' }, 403);
    }

    const settings = await getGradeSettings(db, gradeRow.school_id);
    const { notes, change_reason } = body;
    const rawUpdates = buildRawGradeUpdates(body, settings);
    if (!rawUpdates.ok) return c.json({ error: rawUpdates.error }, 400);
    const updates: Record<string, any> = { ...rawUpdates.updates };
    if (notes !== undefined) updates.notes = notes;

    // Calculate derived fields using new + existing values
    const calcInput = gradeCalculationInput(gradeRow, rawUpdates.updates);

    const derived = calculateGrades(calcInput, settings);

    // Merge derived into updates
    updates.first_term_average = derived.first_term_average;
    updates.second_term_average = derived.second_term_average;
    updates.annual_effort = derived.annual_effort;
    updates.final_grade = derived.final_grade;
    updates.grade_after_completion = derived.grade_after_completion;
    updates.effective_grade = derived.effective_grade;
    updates.result_status = derived.result_status;
    updates.exemption_status = derived.exemption_status;
    updates.updated_by_user_id = user?.id || null;

    // Perform update
    const setParts: string[] = [];
    const bindVals: any[] = [];
    for (const [k, v] of Object.entries(updates)) {
      setParts.push(`${k} = ?`);
      bindVals.push(v);
    }
    bindVals.push(gradeId, gradeRow.school_id);

    await db.prepare(`UPDATE grades SET ${setParts.join(', ')} WHERE id = ? AND school_id = ?`).bind(...bindVals).run();

    // Audit log for changed scalar fields
    const auditFields: Array<RawGradeField | 'notes'> = [...RAW_GRADE_FIELDS, 'notes'];
    for (const field of auditFields) {
      if (body[field] !== undefined) {
        const oldVal = gradeRow[field] === null || gradeRow[field] === undefined ? '' : String(gradeRow[field]);
        const newVal = body[field] === '' || body[field] === null || body[field] === undefined ? '' : String(body[field]);
        if (oldVal !== newVal) {
          await db.prepare(`
            INSERT INTO grade_change_logs (school_id, grade_id, field_name, old_value, new_value, changed_by_user_id, change_reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
          `).bind(gradeRow.school_id, gradeId, field, oldVal || null, newVal || null, user?.id || null, change_reason || null).run();
        }
      }
    }

    const updated = await db.prepare('SELECT * FROM grades WHERE id = ? AND school_id = ?').bind(gradeId, gradeRow.school_id).first<any>();
    return c.json({ data: updated });
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث الدرجة', detail: err.message }, 500);
  }
});

// ===========================================
// POST /api/grades/bulk-entry
// Body: { entries: [{ grade_id, first_month?, second_month?, ... }] }
// ===========================================

app.post('/api/grades/bulk-entry', requireRoles(GRADE_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  try {
    const body = await c.req.json();
    const { entries } = body;
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    if (!Array.isArray(entries) || entries.length === 0) return c.json({ error: 'يجب إرسال مدخلات واحدة على الأقل' }, 400);

    let updated = 0;
    const errors: string[] = [];

    for (const entry of entries) {
      const { grade_id, notes, change_reason } = entry;
      if (!grade_id) { errors.push('معرف الدرجة مفقود في أحد المدخلات'); continue; }

      const gradeRow = await db.prepare('SELECT * FROM grades WHERE id = ?').bind(Number(grade_id)).first<any>();
      if (!gradeRow) { errors.push(`الدرجة ${grade_id} غير موجودة`); continue; }

      if (gradeRow.school_id !== targetSchool.schoolId) {
        errors.push(`غير مسموح بالدرجة ${grade_id}`); continue;
      }

      const settings = await getGradeSettings(db, gradeRow.school_id);

      const rawUpdates = buildRawGradeUpdates(entry, settings);
      if (!rawUpdates.ok) { errors.push(rawUpdates.error); continue; }
      const updates: Record<string, any> = { ...rawUpdates.updates };
      if (notes !== undefined) updates.notes = notes;

      const calcInput = gradeCalculationInput(gradeRow, rawUpdates.updates);

      const derived = calculateGrades(calcInput, settings);
      updates.first_term_average = derived.first_term_average;
      updates.second_term_average = derived.second_term_average;
      updates.annual_effort = derived.annual_effort;
      updates.final_grade = derived.final_grade;
      updates.grade_after_completion = derived.grade_after_completion;
      updates.effective_grade = derived.effective_grade;
      updates.result_status = derived.result_status;
      updates.exemption_status = derived.exemption_status;
      updates.updated_by_user_id = user?.id || null;

      const setParts: string[] = [];
      const bindVals: any[] = [];
      for (const [k, v] of Object.entries(updates)) {
        setParts.push(`${k} = ?`);
        bindVals.push(v);
      }
      bindVals.push(Number(grade_id), gradeRow.school_id);
      await db.prepare(`UPDATE grades SET ${setParts.join(', ')} WHERE id = ? AND school_id = ?`).bind(...bindVals).run();

      // Audit log
      const auditFields: Array<RawGradeField | 'notes'> = [...RAW_GRADE_FIELDS, 'notes'];
      for (const field of auditFields) {
        if (entry[field] !== undefined) {
          const oldVal = gradeRow[field] === null || gradeRow[field] === undefined ? '' : String(gradeRow[field]);
          const newVal = entry[field] === '' || entry[field] === null || entry[field] === undefined ? '' : String(entry[field]);
          if (oldVal !== newVal) {
            await db.prepare(`
              INSERT INTO grade_change_logs (school_id, grade_id, field_name, old_value, new_value, changed_by_user_id, change_reason, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
            `).bind(gradeRow.school_id, Number(grade_id), field, oldVal || null, newVal || null, user?.id || null, change_reason || null).run();
          }
        }
      }
      updated++;
    }

    return c.json({ data: { updated, errors: errors.length > 0 ? errors : undefined } });
  } catch (err: any) {
    return c.json({ error: 'فشل في الإدخال المجمّع', detail: err.message }, 500);
  }
});

// ===========================================
// GET /api/grades/:id/history - audit log
// ===========================================

app.get('/api/grades/:id/history', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const gradeId = Number(c.req.param('id'));
  try {
    const gradeRow = await db.prepare('SELECT school_id FROM grades WHERE id = ?').bind(gradeId).first<{ school_id: number }>();
    if (!gradeRow) return c.json({ error: 'الدرجة غير موجودة' }, 404);

    if (user && user.role_key !== 'system_admin' && gradeRow.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح' }, 403);
    }

    const rows = await db.prepare(`
      SELECT l.*, u.full_name as changed_by_name
      FROM grade_change_logs l
      LEFT JOIN users u ON l.changed_by_user_id = u.id
      WHERE l.grade_id = ? AND l.school_id = ?
      ORDER BY l.created_at DESC
    `).bind(gradeId, gradeRow.school_id).all<any>();

    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب سجل التعديلات', detail: err.message }, 500);
  }
});

// ===========================================
// Phase 5: Analytics API Routes
// ===========================================

function getAnalyticsFilters(c: any) {
  const user: UserContext | null = c.get('user') || null;
  const querySchoolId = c.req.query('school_id');
  const queryClassId = c.req.query('class_id');
  const querySectionId = c.req.query('section_id');
  const querySubjectId = c.req.query('subject_id');

  const resolved = resolveSchoolScope(user, querySchoolId);
  const schoolId = resolved.schoolId;
  const classId = queryClassId ? parseInt(queryClassId, 10) : null;
  const sectionId = querySectionId ? parseInt(querySectionId, 10) : null;
  const subjectId = querySubjectId ? parseInt(querySubjectId, 10) : null;

  return { user, schoolId, classId, sectionId, subjectId, forbidden: resolved.forbidden };
}

function buildAnalyticsWhere(opts: { schoolId: number | null; classId: number | null; sectionId: number | null; subjectId: number | null }): { where: string; params: any[] } {
  const conditions: string[] = ['g.is_active = 1'];
  const params: any[] = [];
  if (opts.schoolId != null) {
    conditions.push('g.school_id = ?');
    params.push(opts.schoolId);
  }
  if (opts.classId != null) {
    conditions.push('ss.class_id = ?');
    params.push(opts.classId);
  }
  if (opts.sectionId != null) {
    conditions.push('ss.section_id = ?');
    params.push(opts.sectionId);
  }
  if (opts.subjectId != null) {
    conditions.push('ss.subject_id = ?');
    params.push(opts.subjectId);
  }
  return { where: conditions.join(' AND '), params };
}

function rowToAnalytics(row: any, passingGrade: number, exemptionGrade: number) {
  const effective = row.effective_grade;
  const annualEffort = row.annual_effort;
  const final = row.final_grade;
  const completion = row.grade_after_completion;
  const status = row.result_status;
  const exempt = row.exemption_status;
  // close-to-passing uses effective_grade (result-based)
  const closeToPassing = effective != null && effective < passingGrade && (passingGrade - effective) >= 1 && (passingGrade - effective) <= 5;
  // close-to-exemption uses annual_effort (individual exemption based)
  const closeToExemption = annualEffort != null && annualEffort < exemptionGrade && (exemptionGrade - annualEffort) >= 1 && (exemptionGrade - annualEffort) <= 5;
  return {
    ...row,
    close_to_passing: closeToPassing ? 1 : 0,
    close_to_exemption: closeToExemption ? 1 : 0,
    marks_needed_to_pass: closeToPassing && effective != null ? Math.round(passingGrade - effective) : null,
    marks_needed_to_exempt: closeToExemption && annualEffort != null ? Math.round(exemptionGrade - annualEffort) : null,
  };
}

// GET /api/analytics/overview
app.get('/api/analytics/overview', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const filters = getAnalyticsFilters(c);
  if (filters.forbidden) return c.json({ error: 'غير مسموح' }, 403);

  try {
    // Fetch passing/exemption thresholds from grade_settings for the resolved school
    let passingGrade = 50;
    let exemptionGrade = 90;
    if (filters.schoolId) {
      const gs = await db.prepare('SELECT passing_grade, exemption_grade FROM grade_settings WHERE school_id = ?').bind(filters.schoolId).first<{ passing_grade: number; exemption_grade: number }>();
      if (gs) { passingGrade = gs.passing_grade; exemptionGrade = gs.exemption_grade; }
    }

    const { where, params } = buildAnalyticsWhere({ schoolId: filters.schoolId, classId: filters.classId, sectionId: filters.sectionId, subjectId: filters.subjectId });

    const rows = await db.prepare(`
      SELECT
        g.result_status,
        g.exemption_status,
        g.effective_grade,
        g.annual_effort,
        g.grade_after_completion,
        g.final_grade
      ${ANALYTICS_APPLICABLE_GRADE_JOINS}
      WHERE ${where}
    `).bind(...params).all<any>();

    const results = rows.results || [];
    const total = results.length;
    const passCount = results.filter((r: any) => r.result_status === 'ناجح').length;
    const incompleteCount = results.filter((r: any) => r.result_status === 'مكمل').length;
    const failCount = results.filter((r: any) => r.result_status === 'راسب').length;
    const exemptCount = results.filter((r: any) => r.exemption_status === 1).length;
    const closeToPassing = results.filter((r: any) => r.effective_grade != null && r.effective_grade < passingGrade && (passingGrade - r.effective_grade) >= 1 && (passingGrade - r.effective_grade) <= 5).length;
    const closeToExemption = results.filter((r: any) => r.annual_effort != null && r.annual_effort < exemptionGrade && (exemptionGrade - r.annual_effort) >= 1 && (exemptionGrade - r.annual_effort) <= 5).length;

    return c.json({
      data: {
        total,
        pass_count: passCount,
        incomplete_count: incompleteCount,
        fail_count: failCount,
        exempt_count: exemptCount,
        close_to_passing_count: closeToPassing,
        close_to_exemption_count: closeToExemption,
        pass_percentage: total > 0 ? Math.round((passCount / total) * 1000) / 10 : 0,
        incomplete_percentage: total > 0 ? Math.round((incompleteCount / total) * 1000) / 10 : 0,
        fail_percentage: total > 0 ? Math.round((failCount / total) * 1000) / 10 : 0,
        exempt_percentage: total > 0 ? Math.round((exemptCount / total) * 1000) / 10 : 0,
        passing_grade: passingGrade,
        exemption_grade: exemptionGrade,
      }
    });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب تحليل النظرة العامة', detail: err.message }, 500);
  }
});

// GET /api/analytics/by-class
app.get('/api/analytics/by-class', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const filters = getAnalyticsFilters(c);
  if (filters.forbidden) return c.json({ error: 'غير مسموح' }, 403);

  try {
    let passingGrade = 50;
    let exemptionGrade = 90;
    if (filters.schoolId) {
      const gs = await db.prepare('SELECT passing_grade, exemption_grade FROM grade_settings WHERE school_id = ?').bind(filters.schoolId).first<{ passing_grade: number; exemption_grade: number }>();
      if (gs) { passingGrade = gs.passing_grade; exemptionGrade = gs.exemption_grade; }
    }

    const { where, params } = buildAnalyticsWhere({ schoolId: filters.schoolId, classId: filters.classId, sectionId: filters.sectionId, subjectId: filters.subjectId });

    const rows = await db.prepare(`
      SELECT
        cl.id AS class_id,
        cl.name AS class_name,
        g.result_status,
        g.exemption_status,
        g.effective_grade,
        g.annual_effort
      ${ANALYTICS_APPLICABLE_GRADE_JOINS}
      INNER JOIN classes cl ON ss.class_id = cl.id AND cl.school_id = ss.school_id
      WHERE ${where}
    `).bind(...params).all<any>();

    const results = rows.results || [];
    const map: Record<string, any> = {};
    for (const r of results) {
      const key = String(r.class_id || 'unknown');
      if (!map[key]) map[key] = { class_id: r.class_id || null, class_name: r.class_name || 'غير محدد', total: 0, pass_count: 0, incomplete_count: 0, fail_count: 0, exempt_count: 0, close_to_passing: 0, close_to_exemption: 0 };
      map[key].total++;
      if (r.result_status === 'ناجح') map[key].pass_count++;
      if (r.result_status === 'مكمل') map[key].incomplete_count++;
      if (r.result_status === 'راسب') map[key].fail_count++;
      if (r.exemption_status === 1) map[key].exempt_count++;
      if (r.effective_grade != null && r.effective_grade < passingGrade && (passingGrade - r.effective_grade) >= 1 && (passingGrade - r.effective_grade) <= 5) map[key].close_to_passing++;
      if (r.annual_effort != null && r.annual_effort < exemptionGrade && (exemptionGrade - r.annual_effort) >= 1 && (exemptionGrade - r.annual_effort) <= 5) map[key].close_to_exemption++;
    }

    const data = Object.values(map).map((item: any) => ({
      ...item,
      pass_percentage: item.total > 0 ? Math.round((item.pass_count / item.total) * 1000) / 10 : 0,
      fail_percentage: item.total > 0 ? Math.round((item.fail_count / item.total) * 1000) / 10 : 0,
      incomplete_percentage: item.total > 0 ? Math.round((item.incomplete_count / item.total) * 1000) / 10 : 0,
      exempt_percentage: item.total > 0 ? Math.round((item.exempt_count / item.total) * 1000) / 10 : 0,
    }));

    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب التحليل حسب الصف', detail: err.message }, 500);
  }
});

// GET /api/analytics/by-section
app.get('/api/analytics/by-section', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const filters = getAnalyticsFilters(c);
  if (filters.forbidden) return c.json({ error: 'غير مسموح' }, 403);

  try {
    let passingGrade = 50;
    let exemptionGrade = 90;
    if (filters.schoolId) {
      const gs = await db.prepare('SELECT passing_grade, exemption_grade FROM grade_settings WHERE school_id = ?').bind(filters.schoolId).first<{ passing_grade: number; exemption_grade: number }>();
      if (gs) { passingGrade = gs.passing_grade; exemptionGrade = gs.exemption_grade; }
    }

    const { where, params } = buildAnalyticsWhere({ schoolId: filters.schoolId, classId: filters.classId, sectionId: filters.sectionId, subjectId: filters.subjectId });

    const rows = await db.prepare(`
      SELECT
        se.id AS section_id,
        se.name AS section_name,
        cl.name AS class_name,
        g.result_status,
        g.exemption_status,
        g.effective_grade,
        g.annual_effort
      ${ANALYTICS_APPLICABLE_GRADE_JOINS}
      INNER JOIN sections se ON ss.section_id = se.id AND se.school_id = ss.school_id
      INNER JOIN classes cl ON ss.class_id = cl.id AND cl.school_id = ss.school_id
      WHERE ${where}
    `).bind(...params).all<any>();

    const results = rows.results || [];
    const map: Record<string, any> = {};
    for (const r of results) {
      const key = String(r.section_id || 'unknown');
      if (!map[key]) map[key] = { section_id: r.section_id || null, section_name: r.section_name || 'غير محدد', class_name: r.class_name || '', total: 0, pass_count: 0, incomplete_count: 0, fail_count: 0, exempt_count: 0, close_to_passing: 0, close_to_exemption: 0 };
      map[key].total++;
      if (r.result_status === 'ناجح') map[key].pass_count++;
      if (r.result_status === 'مكمل') map[key].incomplete_count++;
      if (r.result_status === 'راسب') map[key].fail_count++;
      if (r.exemption_status === 1) map[key].exempt_count++;
      if (r.effective_grade != null && r.effective_grade < passingGrade && (passingGrade - r.effective_grade) >= 1 && (passingGrade - r.effective_grade) <= 5) map[key].close_to_passing++;
      if (r.annual_effort != null && r.annual_effort < exemptionGrade && (exemptionGrade - r.annual_effort) >= 1 && (exemptionGrade - r.annual_effort) <= 5) map[key].close_to_exemption++;
    }

    const data = Object.values(map).map((item: any) => ({
      ...item,
      pass_percentage: item.total > 0 ? Math.round((item.pass_count / item.total) * 1000) / 10 : 0,
      fail_percentage: item.total > 0 ? Math.round((item.fail_count / item.total) * 1000) / 10 : 0,
      incomplete_percentage: item.total > 0 ? Math.round((item.incomplete_count / item.total) * 1000) / 10 : 0,
      exempt_percentage: item.total > 0 ? Math.round((item.exempt_count / item.total) * 1000) / 10 : 0,
    }));

    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب التحليل حسب الشعبة', detail: err.message }, 500);
  }
});

// GET /api/analytics/by-subject
app.get('/api/analytics/by-subject', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const filters = getAnalyticsFilters(c);
  if (filters.forbidden) return c.json({ error: 'غير مسموح' }, 403);

  try {
    let passingGrade = 50;
    let exemptionGrade = 90;
    if (filters.schoolId) {
      const gs = await db.prepare('SELECT passing_grade, exemption_grade FROM grade_settings WHERE school_id = ?').bind(filters.schoolId).first<{ passing_grade: number; exemption_grade: number }>();
      if (gs) { passingGrade = gs.passing_grade; exemptionGrade = gs.exemption_grade; }
    }

    const { where, params } = buildAnalyticsWhere({ schoolId: filters.schoolId, classId: filters.classId, sectionId: filters.sectionId, subjectId: filters.subjectId });

    const rows = await db.prepare(`
      SELECT
        su.id AS subject_id,
        su.name AS subject_name,
        g.result_status,
        g.exemption_status,
        g.effective_grade,
        g.annual_effort
      ${ANALYTICS_APPLICABLE_GRADE_JOINS}
      WHERE ${where}
    `).bind(...params).all<any>();

    const results = rows.results || [];
    const map: Record<string, any> = {};
    for (const r of results) {
      const key = String(r.subject_id || 'unknown');
      if (!map[key]) map[key] = { subject_id: r.subject_id || null, subject_name: r.subject_name || 'غير محدد', total: 0, pass_count: 0, incomplete_count: 0, fail_count: 0, exempt_count: 0, close_to_passing: 0, close_to_exemption: 0 };
      map[key].total++;
      if (r.result_status === 'ناجح') map[key].pass_count++;
      if (r.result_status === 'مكمل') map[key].incomplete_count++;
      if (r.result_status === 'راسب') map[key].fail_count++;
      if (r.exemption_status === 1) map[key].exempt_count++;
      if (r.effective_grade != null && r.effective_grade < passingGrade && (passingGrade - r.effective_grade) >= 1 && (passingGrade - r.effective_grade) <= 5) map[key].close_to_passing++;
      if (r.annual_effort != null && r.annual_effort < exemptionGrade && (exemptionGrade - r.annual_effort) >= 1 && (exemptionGrade - r.annual_effort) <= 5) map[key].close_to_exemption++;
    }

    const data = Object.values(map).map((item: any) => ({
      ...item,
      pass_percentage: item.total > 0 ? Math.round((item.pass_count / item.total) * 1000) / 10 : 0,
      fail_percentage: item.total > 0 ? Math.round((item.fail_count / item.total) * 1000) / 10 : 0,
      incomplete_percentage: item.total > 0 ? Math.round((item.incomplete_count / item.total) * 1000) / 10 : 0,
      exempt_percentage: item.total > 0 ? Math.round((item.exempt_count / item.total) * 1000) / 10 : 0,
    }));

    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب التحليل حسب المادة', detail: err.message }, 500);
  }
});

// GET /api/analytics/students-close-to-passing
app.get('/api/analytics/students-close-to-passing', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const filters = getAnalyticsFilters(c);
  if (filters.forbidden) return c.json({ error: 'غير مسموح' }, 403);

  try {
    let passingGrade = 50;
    if (filters.schoolId) {
      const gs = await db.prepare('SELECT passing_grade FROM grade_settings WHERE school_id = ?').bind(filters.schoolId).first<{ passing_grade: number }>();
      if (gs) passingGrade = gs.passing_grade;
    }

    const { where, params } = buildAnalyticsWhere({ schoolId: filters.schoolId, classId: filters.classId, sectionId: filters.sectionId, subjectId: filters.subjectId });

    const rows = await db.prepare(`
      SELECT
        st.id AS student_id,
        st.full_name AS student_name,
        st.student_number,
        cl.name AS class_name,
        se.name AS section_name,
        su.name AS subject_name,
        g.effective_grade,
        g.final_grade,
        g.grade_after_completion,
        g.result_status
      ${ANALYTICS_APPLICABLE_GRADE_JOINS}
      INNER JOIN classes cl ON ss.class_id = cl.id AND cl.school_id = ss.school_id
      INNER JOIN sections se ON ss.section_id = se.id AND se.school_id = ss.school_id
      WHERE ${where}
        AND g.effective_grade IS NOT NULL
        AND g.effective_grade < ?
        AND (? - g.effective_grade) >= 1
        AND (? - g.effective_grade) <= 5
      ORDER BY (? - g.effective_grade) ASC, st.full_name
    `).bind(...params, passingGrade, passingGrade, passingGrade, passingGrade).all<any>();

    const results = (rows.results || []).map((r: any) => ({
      ...r,
      marks_needed: r.effective_grade != null ? Math.round(passingGrade - r.effective_grade) : null,
    }));

    return c.json({ data: results });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب قائمة الطلاب القريبين من النجاح', detail: err.message }, 500);
  }
});

// GET /api/analytics/students-close-to-exemption
app.get('/api/analytics/students-close-to-exemption', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const filters = getAnalyticsFilters(c);
  if (filters.forbidden) return c.json({ error: 'غير مسموح' }, 403);

  try {
    let exemptionGrade = 90;
    if (filters.schoolId) {
      const gs = await db.prepare('SELECT exemption_grade FROM grade_settings WHERE school_id = ?').bind(filters.schoolId).first<{ exemption_grade: number }>();
      if (gs) exemptionGrade = gs.exemption_grade;
    }

    const { where, params } = buildAnalyticsWhere({ schoolId: filters.schoolId, classId: filters.classId, sectionId: filters.sectionId, subjectId: filters.subjectId });

    const rows = await db.prepare(`
      SELECT
        st.id AS student_id,
        st.full_name AS student_name,
        st.student_number,
        cl.name AS class_name,
        se.name AS section_name,
        su.name AS subject_name,
        g.effective_grade,
        g.annual_effort,
        g.final_grade,
        g.grade_after_completion,
        g.result_status
      ${ANALYTICS_APPLICABLE_GRADE_JOINS}
      INNER JOIN classes cl ON ss.class_id = cl.id AND cl.school_id = ss.school_id
      INNER JOIN sections se ON ss.section_id = se.id AND se.school_id = ss.school_id
      WHERE ${where}
        AND g.annual_effort IS NOT NULL
        AND g.annual_effort < ?
        AND (? - g.annual_effort) >= 1
        AND (? - g.annual_effort) <= 5
      ORDER BY (? - g.annual_effort) ASC, st.full_name
    `).bind(...params, exemptionGrade, exemptionGrade, exemptionGrade, exemptionGrade).all<any>();

    const results = (rows.results || []).map((r: any) => ({
      ...r,
      marks_needed: r.annual_effort != null ? Math.round(exemptionGrade - r.annual_effort) : null,
    }));

    return c.json({ data: results });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب قائمة الطلاب القريبين من الإعفاء', detail: err.message }, 500);
  }
});

// GET /api/analytics/exemption-blockers
app.get('/api/analytics/exemption-blockers', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const filters = getAnalyticsFilters(c);
  if (filters.forbidden) return c.json({ error: 'غير مسموح' }, 403);

  try {
    const { where, params } = buildAnalyticsWhere({ schoolId: filters.schoolId, classId: filters.classId, sectionId: filters.sectionId, subjectId: null });

    let genMin = 75;
    if (filters.schoolId) {
      const gs = await db.prepare('SELECT general_exemption_min_subject_grade FROM grade_settings WHERE school_id = ?').bind(filters.schoolId).first<{ general_exemption_min_subject_grade: number }>();
      if (gs) genMin = gs.general_exemption_min_subject_grade;
    }

    const rows = await db.prepare(`
      SELECT
        su.id AS subject_id,
        su.name AS subject_name,
        COUNT(*) AS total_students,
        SUM(CASE WHEN g.exemption_status = 1 THEN 1 ELSE 0 END) AS exempt_count,
        SUM(CASE WHEN g.annual_effort IS NULL OR g.annual_effort < ? THEN 1 ELSE 0 END) AS blocker_count
      ${ANALYTICS_APPLICABLE_GRADE_JOINS}
      WHERE ${where}
      GROUP BY su.id, su.name
      HAVING blocker_count > 0
      ORDER BY blocker_count DESC, su.order_index, su.id
    `).bind(genMin, ...params).all<any>();

    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب المواد التي منعت الإعفاء', detail: err.message }, 500);
  }
});

// GET /api/analytics/student-summary/:student_id
app.get('/api/analytics/student-summary/:student_id', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const studentId = Number(c.req.param('student_id'));
  if (!isFinite(studentId)) return c.json({ error: 'معرف الطالب غير صالح' }, 400);

  try {
    const student = await db.prepare(`
      SELECT st.id, st.full_name, st.student_number, st.school_id, st.class_id, st.section_id,
             cl.name AS class_name, se.name AS section_name
      FROM students st
      LEFT JOIN classes cl ON st.class_id = cl.id
      LEFT JOIN sections se ON st.section_id = se.id
      WHERE st.id = ? AND st.status = 'active'
    `).bind(studentId).first<any>();

    if (!student) return c.json({ error: 'الطالب غير موجود' }, 404);

    if (user && user.role_key !== 'system_admin' && student.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح' }, 403);
    }

    let passingGrade = 50;
    let exemptionGrade = 90;
    let genAvg = 85;
    let genMin = 75;
    const gs = await db.prepare('SELECT passing_grade, exemption_grade, general_exemption_average_grade, general_exemption_min_subject_grade FROM grade_settings WHERE school_id = ?').bind(student.school_id).first<any>();
    if (gs) {
      passingGrade = gs.passing_grade;
      exemptionGrade = gs.exemption_grade;
      genAvg = gs.general_exemption_average_grade ?? 85;
      genMin = gs.general_exemption_min_subject_grade ?? 75;
    }

    const gradeRows = await db.prepare(`
      SELECT
        su.id AS subject_id,
        su.name AS subject_name,
        g.effective_grade,
        g.annual_effort,
        g.final_grade,
        g.grade_after_completion,
        g.result_status,
        g.exemption_status,
        g.first_month,
        g.second_month,
        g.third_month,
        g.fourth_month,
        g.mid_year_exam,
        g.final_exam,
        g.completion_exam
      ${ANALYTICS_APPLICABLE_GRADE_JOINS}
      WHERE ss.student_id = ? AND g.is_active = 1
      ORDER BY su.order_index, su.id
    `).bind(studentId).all<any>();

    const subjects = gradeRows.results || [];
    const totalSubjects = subjects.length;
    const passCount = subjects.filter((r: any) => r.result_status === 'ناجح').length;
    const incompleteCount = subjects.filter((r: any) => r.result_status === 'مكمل').length;
    const failCount = subjects.filter((r: any) => r.result_status === 'راسب').length;
    const exemptCount = subjects.filter((r: any) => r.exemption_status === 1).length;

    // General exemption: based on annual_effort only
    // 1. All active assigned subjects have grade records
    // 2. All have annual_effort calculated
    // 3. AVG(annual_effort) >= genAvg
    // 4. MIN(annual_effort) >= genMin
    const annualEfforts = subjects.map((r: any) => r.annual_effort).filter((v: any) => v !== null && v !== undefined && !isNaN(v)) as number[];
    const avgAnnualEffort = annualEfforts.length > 0 ? annualEfforts.reduce((a: number, b: number) => a + b, 0) / annualEfforts.length : null;
    const minAnnualEffort = annualEfforts.length > 0 ? Math.min(...annualEfforts) : null;
    const generalExemptionEligible = totalSubjects > 0 && annualEfforts.length === totalSubjects && avgAnnualEffort !== null && avgAnnualEffort >= genAvg && minAnnualEffort !== null && minAnnualEffort >= genMin;

    return c.json({
      data: {
        student,
        passing_grade: passingGrade,
        exemption_grade: exemptionGrade,
        summary: {
          total_subjects: totalSubjects,
          pass_count: passCount,
          incomplete_count: incompleteCount,
          fail_count: failCount,
          exempt_count: exemptCount,
          general_exemption_eligible: generalExemptionEligible,
        },
        subjects,
      }
    });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب تحليل الطالب', detail: err.message }, 500);
  }
});

// ===========================================
// Phase 6: Result Cards + QR Verification
// ===========================================

function generateVerificationToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 32; i++) {
    token += chars[buf[i] % chars.length];
  }
  return token;
}

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token + 'smart-school-verification-salt-2026');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateCardNumber(schoolId: number, studentId: number): string {
  const ts = Math.floor(Date.now() / 1000);
  return `RC-${schoolId}-${studentId}-${ts}`;
}

interface StudentPlacementRecord {
  id: number;
  school_id: number;
  name: string;
  status: string;
  class_id?: number | null;
}

type StudentPlacementValidation =
  | {
      ok: true;
      classRecord: StudentPlacementRecord | null;
      sectionRecord: StudentPlacementRecord | null;
    }
  | { ok: false; status: 400 | 403; error: string };

async function validateStudentPlacement(
  db: D1Database,
  schoolId: number,
  classId: number | null,
  sectionId: number | null,
): Promise<StudentPlacementValidation> {
  let classRecord: StudentPlacementRecord | null = null;
  let sectionRecord: StudentPlacementRecord | null = null;

  if (classId != null) {
    classRecord = await db.prepare(
      'SELECT id, school_id, name, status FROM classes WHERE id = ?',
    ).bind(classId).first<StudentPlacementRecord>();
  }

  if (sectionId != null) {
    sectionRecord = await db.prepare(
      'SELECT id, school_id, class_id, name, status FROM sections WHERE id = ?',
    ).bind(sectionId).first<StudentPlacementRecord>();
  }
  return validateStudentImportPlacement(schoolId, classId, sectionId, classRecord, sectionRecord);
}

interface ResultCardStudentSnapshot {
  id: number;
  school_id: number;
  full_name: string;
  student_number: string;
  gender: string | null;
  photo_url: string | null;
  class_id: number | null;
  section_id: number | null;
  class_name: string | null;
  class_stage: string | null;
  section_name: string | null;
  school_name: string;
  school_name_en: string | null;
  school_address: string | null;
  school_phone: string | null;
  school_email: string | null;
  school_website: string | null;
  principal_name: string | null;
  logo_url: string | null;
  official_stamp_url: string | null;
}

type ResultCardCreation =
  | { ok: true; card: any; cardNumber: string }
  | {
      ok: false;
      status: 400 | 403 | 409;
      code: string;
      error: string;
      subjects?: string[];
    };

async function loadResultCardStudent(
  db: D1Database,
  studentId: number,
): Promise<ResultCardStudentSnapshot | null> {
  const student = await getStudentWithEffectivePlacement(db, studentId);
  if (!student || student.status !== 'active') return null;

  const school = await db.prepare(`
    SELECT sch.name AS school_name, sch.name_en AS school_name_en,
           sch.address AS school_address, sch.phone AS school_phone,
           sch.email AS school_email, sch.website AS school_website,
           sch.principal_name, sch.logo_url, sch.official_stamp_url,
           c.stage AS class_stage
    FROM schools sch
    LEFT JOIN classes c ON c.id = ? AND c.school_id = sch.id
    WHERE sch.id = ?
  `).bind(student.class_id, student.school_id).first<Omit<
    ResultCardStudentSnapshot,
    'id' | 'school_id' | 'full_name' | 'student_number' | 'gender' |
    'photo_url' | 'class_id' | 'section_id' | 'class_name' | 'section_name'
  >>();
  if (!school) return null;

  return {
    id: student.id,
    school_id: student.school_id,
    full_name: student.full_name,
    student_number: student.student_number,
    gender: student.gender,
    photo_url: student.photo_url,
    class_id: student.class_id,
    section_id: student.section_id,
    class_name: student.class_name,
    section_name: student.section_name,
    ...school,
  };
}

async function loadResultCardEvaluation(
  db: D1Database,
  studentId: number,
  schoolId: number,
): Promise<{
  evaluation: ResultCardEvaluation;
  settings: ResultCardSettings;
  subjects: ResultCardSubject[];
}> {
  const subjectRows = await db.prepare(`
    SELECT su.id, su.name AS subject_name, su.appears_in_report_card,
           su.counts_in_average
    FROM student_subjects ss
    INNER JOIN subjects su
      ON ss.subject_id = su.id AND su.school_id = ss.school_id
    WHERE ss.student_id = ? AND ss.school_id = ?
      AND ss.is_active = 1 AND su.status = 'active'
    ORDER BY su.order_index, su.id
  `).bind(studentId, schoolId).all<ResultCardSubject>();

  const gradeRows = await db.prepare(`
    SELECT
      su.id AS subject_id,
      su.name AS subject_name,
      g.first_term_grade,
      g.first_month,
      g.second_month,
      g.first_term_average,
      g.mid_year_exam,
      g.second_term_grade,
      g.third_month,
      g.fourth_month,
      g.second_term_average,
      g.annual_effort,
      g.final_exam,
      g.final_grade,
      g.completion_exam,
      g.grade_after_completion,
      g.effective_grade,
      g.result_status,
      g.exemption_status
    FROM grades g
    INNER JOIN student_subjects ss
      ON g.student_subject_id = ss.id
      AND ss.is_active = 1
      AND ss.school_id = g.school_id
    INNER JOIN subjects su
      ON ss.subject_id = su.id
      AND su.school_id = ss.school_id
      AND su.status = 'active'
    WHERE ss.student_id = ? AND g.school_id = ? AND g.is_active = 1
    ORDER BY su.order_index, su.id
  `).bind(studentId, schoolId).all<ResultCardGrade>();

  const storedGradeSettings = await db.prepare(
    'SELECT * FROM grade_settings WHERE school_id = ?',
  ).bind(schoolId).first<any>();
  const gradeSettings = withNormalizedGradeScheme({
    max_grade: 100,
    passing_grade: 50,
    exemption_grade: 90,
    general_exemption_average_grade: 85,
    general_exemption_min_subject_grade: 75,
    ...DEFAULT_GRADE_SCHEME_SETTINGS,
    ...storedGradeSettings,
  });
  const settings: ResultCardSettings = {
    max_grade: gradeSettings.max_grade,
    passing_grade: gradeSettings.passing_grade,
    exemption_grade: gradeSettings.exemption_grade,
    general_exemption_average_grade:
      gradeSettings.general_exemption_average_grade ?? 85,
    general_exemption_min_subject_grade:
      gradeSettings.general_exemption_min_subject_grade ?? 75,
    ...normalizeGradeSchemeSettings(gradeSettings),
  };
  const academicYear = await db.prepare(`
    SELECT id, name
    FROM academic_years
    WHERE school_id = ? AND is_active = 1
    ORDER BY id DESC
    LIMIT 1
  `).bind(schoolId).first<ResultCardAcademicYear>();

  return {
    evaluation: evaluateResultCard(
      subjectRows.results || [],
      gradeRows.results || [],
      settings,
      academicYear,
    ),
    settings,
    subjects: subjectRows.results || [],
  };
}

function resultCardEvaluationFailure(
  evaluation: Extract<ResultCardEvaluation, { ok: false }>,
): Extract<ResultCardCreation, { ok: false }> {
  const messages: Record<typeof evaluation.code, string> = {
    no_active_academic_year: 'لا توجد سنة دراسية فعالة لهذه المدرسة',
    no_active_subjects: 'لا توجد مواد مفعلة مسندة لهذا الطالب',
  };
  return {
    ok: false,
    status: 400,
    code: evaluation.code,
    error: messages[evaluation.code],
  };
}

interface ResultCardIssueOptions {
  decisionNote: string | null;
  examRound: string;
}

type ResultCardSnapshotBuild =
  | {
      ok: true;
      evaluation: Extract<ResultCardEvaluation, { ok: true }>;
      cardData: Record<string, any>;
      generatedAt: number;
    }
  | Extract<ResultCardCreation, { ok: false }>;

function resultCardIssueOptions(body: Record<string, any>):
  | { ok: true; options: ResultCardIssueOptions }
  | { ok: false; error: string } {
  const noteError = validateResultCardDecisionNote(body.decision_note);
  if (noteError) return { ok: false, error: noteError };
  if (
    body.exam_round !== undefined &&
    (typeof body.exam_round !== 'string' || body.exam_round.trim().length > 100)
  ) {
    return { ok: false, error: 'الدور يجب أن يكون نصاً لا يتجاوز 100 حرف' };
  }
  return {
    ok: true,
    options: {
      decisionNote: normalizeResultCardDecisionNote(body.decision_note),
      examRound: typeof body.exam_round === 'string' && body.exam_round.trim()
        ? body.exam_round.trim()
        : 'الدور الأول',
    },
  };
}

async function buildResultCardSnapshot(
  db: D1Database,
  user: UserContext,
  student: ResultCardStudentSnapshot,
  options: ResultCardIssueOptions,
  identity: { cardNumber: string | null; token: string | null },
): Promise<ResultCardSnapshotBuild> {
  // With an active academic year, effective placement intentionally resolves to
  // null when the student has no enrollment. Never issue an official card from
  // legacy placement (or from an empty placement) in that state.
  if (student.class_id == null) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_student_placement',
      error: 'لا يوجد تسجيل دراسي فعال للطالب في السنة الدراسية الحالية',
    };
  }
  const placement = await validateStudentPlacement(
    db,
    student.school_id,
    student.class_id,
    student.section_id,
  );
  if (!placement.ok) {
    return {
      ok: false,
      status: placement.status,
      code: 'invalid_student_placement',
      error: placement.error,
    };
  }

  const { evaluation, settings, subjects } = await loadResultCardEvaluation(
    db,
    student.id,
    student.school_id,
  );
  if (!evaluation.ok) return resultCardEvaluationFailure(evaluation);

  const schoolSettings = await db.prepare(`
    SELECT result_card_header_text, result_card_footer_text, verification_note_text,
           use_school_logo_on_docs, use_school_stamp_on_docs,
           result_card_display_settings_json
    FROM school_settings WHERE school_id = ?
  `).bind(student.school_id).first<any>();
  const displaySettings = parseResultCardDisplaySettings(
    schoolSettings?.result_card_display_settings_json,
  );
  const generatedAt = Math.floor(Date.now() / 1000);
  const verificationUrl = identity.token
    ? `/verify/result-card/${identity.token}`
    : null;
  const visibleColumns = buildResultCardColumns(settings, displaySettings);
  const columnAverages = calculateResultCardColumnAverages(
    subjects,
    evaluation.counted_grades,
    settings,
    visibleColumns,
    evaluation.summary.general_exemption_eligible,
  );
  const cardData = {
    schema_version: 4,
    card_mode: evaluation.card_mode,
    school: {
      id: student.school_id,
      name: student.school_name,
      name_en: student.school_name_en,
      address: student.school_address,
      phone: student.school_phone,
      email: student.school_email,
      website: student.school_website,
      principal_name: student.principal_name,
    },
    student: {
      id: student.id,
      name: student.full_name,
      student_number: student.student_number,
      exam_number: null,
      gender: student.gender,
      photo_url: student.photo_url,
    },
    class: { id: student.class_id, name: student.class_name, stage: student.class_stage },
    section: { id: student.section_id, name: student.section_name },
    academic_year: evaluation.academicYear,
    exam_round: options.examRound,
    decision_note: options.decisionNote,
    grade_scheme: settings,
    required_fields: evaluation.required_fields,
    visible_columns: visibleColumns,
    column_averages: columnAverages,
    subjects: evaluation.grades,
    applicability: {
      display_subject_ids: evaluation.grades.map((grade) => grade.subject_id),
      counted_subject_ids: evaluation.counted_grades.map((grade) => grade.subject_id),
    },
    incomplete_subjects: evaluation.incomplete_subjects,
    summary: evaluation.summary,
    document_settings: {
      result_card_header_text: schoolSettings?.result_card_header_text || null,
      result_card_footer_text: schoolSettings?.result_card_footer_text || null,
      verification_note_text: schoolSettings?.verification_note_text || null,
      use_school_logo_on_docs: schoolSettings?.use_school_logo_on_docs === 1,
      use_school_stamp_on_docs: schoolSettings?.use_school_stamp_on_docs === 1,
      logo_url:
        schoolSettings?.use_school_logo_on_docs === 1 && student.logo_url
          ? student.logo_url
          : null,
      official_stamp_url:
        schoolSettings?.use_school_stamp_on_docs === 1 && student.official_stamp_url
          ? student.official_stamp_url
          : null,
      result_card_display_settings: displaySettings,
    },
    verification: identity.token
      ? {
          token: identity.token,
          code: identity.token,
          url: verificationUrl,
          card_number: identity.cardNumber,
        }
      : null,
    generated_by: user.id,
    generated_at: generatedAt,
  };

  return { ok: true, evaluation, cardData, generatedAt };
}

async function createResultCardForStudent(
  db: D1Database,
  user: UserContext,
  student: ResultCardStudentSnapshot,
  options: ResultCardIssueOptions,
): Promise<ResultCardCreation> {
  const token = generateVerificationToken();
  const cardNumber = generateCardNumber(student.school_id, student.id);
  const snapshot = await buildResultCardSnapshot(
    db,
    user,
    student,
    options,
    { cardNumber, token },
  );
  if (!snapshot.ok) return snapshot;
  const { evaluation, cardData, generatedAt } = snapshot;

  const existingActive = await db.prepare(`
    SELECT id FROM result_cards
    WHERE school_id = ? AND student_id = ? AND academic_year_id = ? AND status = 'active'
    LIMIT 1
  `).bind(student.school_id, student.id, evaluation.academicYear.id).first<any>();
  if (existingActive) {
    return {
      ok: false,
      status: 409,
      code: 'active_card_exists',
      error: 'يوجد كارت نتيجة فعّال بالفعل لهذا الطالب في نفس السنة الدراسية',
    };
  }

  const tokenHash = await hashToken(token);
  await db.prepare(`
    INSERT INTO result_cards (
      school_id, student_id, class_id, section_id, academic_year_id,
      card_number, verification_token, verification_hash,
      student_name_snapshot, class_name_snapshot, section_name_snapshot,
      school_name_snapshot, academic_year_snapshot,
      general_exemption_status, annual_effort_average, min_annual_effort,
      overall_result_status, card_data_json,
      generated_by_user_id, generated_at, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', unixepoch(), unixepoch())
  `).bind(
    student.school_id,
    student.id,
    student.class_id,
    student.section_id,
    evaluation.academicYear.id,
    cardNumber,
    token,
    tokenHash,
    student.full_name,
    student.class_name,
    student.section_name,
    student.school_name,
    evaluation.academicYear.name,
    evaluation.summary.general_exemption_eligible ? 1 : 0,
    evaluation.summary.annual_effort_average,
    evaluation.summary.min_annual_effort,
    evaluation.summary.overall_result_status,
    JSON.stringify(cardData),
    user.id,
    generatedAt,
  ).run();

  const card = await db.prepare(`
    SELECT * FROM result_cards WHERE verification_token = ? AND school_id = ?
  `).bind(token, student.school_id).first<any>();
  if (card) card.card_data_parsed = cardData;
  return { ok: true, card, cardNumber };
}

// GET /api/result-cards
// ===========================================
app.get(
  '/api/result-cards',
  requireSameSchoolOrAdmin(),
  requireRoles(RESULT_CARD_VIEW_ROLES),
  async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  try {
    if (!resolvedSchoolId) {
      return c.json({ error: 'يجب تحديد المدرسة المستهدفة لعرض كارتات النتائج' }, 400);
    }
    const query = c.req.query();
    const classId = query.class_id ? parseInt(query.class_id, 10) : null;
    const sectionId = query.section_id ? parseInt(query.section_id, 10) : null;
    const studentId = query.student_id ? parseInt(query.student_id, 10) : null;
    const status = query.status || null;

    let sql = `SELECT rc.id, rc.school_id, rc.card_number, rc.student_name_snapshot, rc.class_name_snapshot, rc.section_name_snapshot, rc.school_name_snapshot, rc.academic_year_snapshot, rc.general_exemption_status, rc.overall_result_status, rc.generated_at, rc.printed_at, rc.status, rc.verification_token FROM result_cards rc WHERE rc.school_id = ?`;
    const params: any[] = [resolvedSchoolId];

    if (classId) { sql += ` AND rc.class_id = ?`; params.push(classId); }
    if (sectionId) { sql += ` AND rc.section_id = ?`; params.push(sectionId); }
    if (studentId) { sql += ` AND rc.student_id = ?`; params.push(studentId); }
    if (status) { sql += ` AND rc.status = ?`; params.push(status); }

    sql += ` ORDER BY rc.generated_at DESC`;

    const stmt = db.prepare(sql);
    const rows = await stmt.bind(...params).all<any>();
    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب كارتات النتائج', detail: err.message }, 500);
  }
  },
);

// GET /api/result-cards/:id
// ===========================================
app.get(
  '/api/result-cards/:id',
  requireSameSchoolOrAdmin(),
  requireRoles(RESULT_CARD_VIEW_ROLES),
  async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = parseInt(c.req.param('id'), 10);

  try {
    if (!resolvedSchoolId) {
      return c.json({ error: 'يجب تحديد المدرسة المستهدفة لعرض كارت النتيجة' }, 400);
    }
    const row = await db.prepare(`SELECT * FROM result_cards WHERE id = ?`).bind(id).first<any>();
    if (!row) {
      return c.json({ error: 'كارت النتيجة غير موجود' }, 404);
    }
    if (row.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح: لا يمكنك الوصول إلى هذا الكارت' }, 403);
    }
    let data = row;
    try {
      data = { ...row, card_data_parsed: JSON.parse(row.card_data_json) };
    } catch { /* leave as-is */ }
    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب كارت النتيجة', detail: err.message }, 500);
  }
  },
);

// POST /api/result-cards/preview-student/:student_id
// Builds a live, read-only card without issuing an identity or writing a snapshot.
// ===========================================
app.post(
  '/api/result-cards/preview-student/:student_id',
  requireSameSchoolOrAdmin(),
  requireRoles(RESULT_CARD_MANAGEMENT_ROLES),
  async (c) => {
    const db = c.env.DB;
    const user = c.get('user') as UserContext;
    const studentId = parseInt(c.req.param('student_id'), 10);
    if (!Number.isInteger(studentId)) {
      return c.json({ error: 'معرّف الطالب غير صالح' }, 400);
    }

    try {
      const body = await c.req.json().catch(() => ({}));
      const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
      if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
      const parsedOptions = resultCardIssueOptions(body);
      if (!parsedOptions.ok) return c.json({ error: parsedOptions.error }, 400);
      const student = await loadResultCardStudent(db, studentId);
      if (!student) return c.json({ error: 'الطالب غير موجود أو غير فعال' }, 404);
      if (student.school_id !== targetSchool.schoolId) {
        return c.json({ error: 'غير مسموح: لا يمكنك معاينة طالب من مدرسة أخرى' }, 403);
      }

      const snapshot = await buildResultCardSnapshot(
        db,
        user,
        student,
        parsedOptions.options,
        { cardNumber: null, token: null },
      );
      if (!snapshot.ok) {
        return c.json({ error: snapshot.error, code: snapshot.code }, snapshot.status);
      }
      return c.json({
        data: {
          card: {
            id: null,
            school_id: student.school_id,
            card_number: 'معاينة غير محفوظة',
            verification_token: null,
            student_name_snapshot: student.full_name,
            class_name_snapshot: student.class_name,
            section_name_snapshot: student.section_name,
            school_name_snapshot: student.school_name,
            academic_year_snapshot: snapshot.evaluation.academicYear.name,
            general_exemption_status:
              snapshot.evaluation.summary.general_exemption_eligible === true ? 1 : 0,
            overall_result_status: snapshot.evaluation.summary.overall_result_status,
            generated_at: snapshot.generatedAt,
            printed_at: null,
            status: 'preview',
            card_data_parsed: snapshot.cardData,
          },
        },
        message: snapshot.evaluation.card_mode === 'partial'
          ? 'تم إعداد معاينة جزئية دون حفظ'
          : 'تم إعداد معاينة مكتملة دون حفظ',
      });
    } catch (err: any) {
      return c.json({ error: 'فشل في معاينة كارت النتيجة', detail: err.message }, 500);
    }
  },
);

// POST /api/result-cards/generate-student/:student_id
// ===========================================
app.post(
  '/api/result-cards/generate-student/:student_id',
  requireSameSchoolOrAdmin(),
  requireRoles(RESULT_CARD_MANAGEMENT_ROLES),
  async (c) => {
    const db = c.env.DB;
    const user = c.get('user') as UserContext;
    const scope = c.get('scope') as 'all' | 'single';
    const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
    const studentId = parseInt(c.req.param('student_id'), 10);

    if (!Number.isInteger(studentId)) {
      return c.json({ error: 'معرّف الطالب غير صالح' }, 400);
    }

    try {
      const body = await c.req.json().catch(() => ({}));
      const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
      if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
      const parsedOptions = resultCardIssueOptions(body);
      if (!parsedOptions.ok) return c.json({ error: parsedOptions.error }, 400);
      const student = await loadResultCardStudent(db, studentId);
      if (!student) {
        return c.json({ error: 'الطالب غير موجود أو غير فعال' }, 404);
      }
      if (student.school_id !== targetSchool.schoolId) {
        return c.json(
          { error: 'غير مسموح: لا يمكنك إنشاء كارت لطالب من مدرسة أخرى' },
          403,
        );
      }

      const created = await createResultCardForStudent(db, user, student, parsedOptions.options);
      if (!created.ok) {
        return c.json(
          {
            error: created.error,
            code: created.code,
            subjects: created.subjects,
          },
          created.status,
        );
      }

      return c.json({
        data: {
          card: created.card,
          verification_url: `/verify/result-card/${created.card.verification_token}`,
        },
        message: 'تم إنشاء كارت النتيجة بنجاح',
      });
    } catch (err: any) {
      return c.json(
        { error: 'فشل في إنشاء كارت النتيجة', detail: err.message },
        500,
      );
    }
  },
);


// POST /api/result-cards/generate-section
// ===========================================
app.post(
  '/api/result-cards/generate-section',
  requireSameSchoolOrAdmin(),
  requireRoles(RESULT_CARD_MANAGEMENT_ROLES),
  async (c) => {
    const db = c.env.DB;
    const user = c.get('user') as UserContext;
    const scope = c.get('scope') as 'all' | 'single';
    const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
    const body = await c.req.json();
    const classId = Number(body.class_id);
    const sectionId = Number(body.section_id);

    if (!Number.isInteger(classId) || !Number.isInteger(sectionId)) {
      return c.json({ error: 'الصف والشعبة مطلوبان' }, 400);
    }

    try {
      const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
      if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
      const parsedOptions = resultCardIssueOptions(body);
      if (!parsedOptions.ok) return c.json({ error: parsedOptions.error }, 400);
      const section = await db.prepare(`
        SELECT id, school_id, class_id, status
        FROM sections
        WHERE id = ?
      `).bind(sectionId).first<any>();
      if (!section || section.status !== 'active') {
        return c.json({ error: 'الشعبة غير موجودة أو غير فعالة' }, 404);
      }
      if (section.class_id !== classId) {
        return c.json({ error: 'الشعبة لا تتبع الصف المحدد' }, 400);
      }
      if (section.school_id !== targetSchool.schoolId) {
        return c.json(
          { error: 'غير مسموح: لا يمكنك إنشاء كارتات لشعبة من مدرسة أخرى' },
          403,
        );
      }

      const classRow = await db.prepare(`
        SELECT id, school_id, status
        FROM classes
        WHERE id = ?
      `).bind(classId).first<any>();
      if (
        !classRow ||
        classRow.status !== 'active' ||
        classRow.school_id !== section.school_id
      ) {
        return c.json({ error: 'الصف غير موجود أو لا يتبع مدرسة الشعبة' }, 400);
      }

      const academicYear = await db.prepare(`
        SELECT id
        FROM academic_years
        WHERE school_id = ? AND is_active = 1
        ORDER BY id DESC
        LIMIT 1
      `).bind(section.school_id).first<any>();
      if (!academicYear) {
        return c.json(
          { error: 'لا توجد سنة دراسية فعالة لهذه المدرسة' },
          400,
        );
      }

      const students = (await listStudentsWithEffectivePlacement(db, {
        schoolId: section.school_id,
        classId,
        sectionId,
      })).filter((student) => student.status === 'active');

      if (students.length === 0) {
        return c.json({ error: 'لا يوجد طلاب فعالون في هذه الشعبة' }, 400);
      }

      const generated: Array<{
        student_id: number;
        student_name: string;
        card_number: string;
        card_mode: 'partial' | 'complete';
      }> = [];
      const skipped: Array<{
        student_id: number;
        student_name?: string;
        reason: string;
        code: string;
        subjects?: string[];
      }> = [];

      for (const row of students) {
        const student = await loadResultCardStudent(db, row.id);
        if (!student || student.school_id !== section.school_id) {
          skipped.push({
            student_id: row.id,
            reason: 'بيانات الطالب أو تبعيته المدرسية غير صالحة',
            code: 'invalid_student',
          });
          continue;
        }

        const created = await createResultCardForStudent(db, user, student, parsedOptions.options);
        if (!created.ok) {
          skipped.push({
            student_id: row.id,
            student_name: student.full_name,
            reason: created.error,
            code: created.code,
            subjects: created.subjects,
          });
          continue;
        }
        generated.push({
          student_id: row.id,
          student_name: student.full_name,
          card_number: created.cardNumber,
          card_mode: created.card?.overall_result_status === 'غير مكتمل' ? 'partial' : 'complete',
        });
      }

      return c.json({
        data: {
          generated_count: generated.length,
          skipped_count: skipped.length,
          generated,
          skipped,
        },
        message: 'تمت معالجة إنشاء كارتات الشعبة',
      });
    } catch (err: any) {
      return c.json(
        { error: 'فشل في إنشاء كارتات الشعبة', detail: err.message },
        500,
      );
    }
  },
);


// PUT /api/result-cards/:id/mark-printed
// ===========================================
app.put(
  '/api/result-cards/:id/mark-printed',
  requireSameSchoolOrAdmin(),
  requireRoles(RESULT_CARD_PRINT_ROLES),
  async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = parseInt(c.req.param('id'), 10);

  try {
    const body = await c.req.json().catch(() => ({}));
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const row = await db.prepare(`SELECT school_id, status FROM result_cards WHERE id = ?`).bind(id).first<any>();
    if (!row) return c.json({ error: 'كارت النتيجة غير موجود' }, 404);
    if (row.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح' }, 403);
    }
    if (row.status !== 'active') {
      return c.json({ error: 'لا يمكن تعليم كارت غير فعال كمطبوع' }, 400);
    }
    await db.prepare(`UPDATE result_cards SET printed_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND school_id = ?`).bind(id, targetSchool.schoolId).run();
    return c.json({ data: { id, printed_at: Math.floor(Date.now() / 1000) }, message: 'تم تعليم الكارت كمطبوع' });
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث الكارت', detail: err.message }, 500);
  }
  },
);

// PUT /api/result-cards/:id/cancel
// ===========================================
app.put(
  '/api/result-cards/:id/cancel',
  requireSameSchoolOrAdmin(),
  requireRoles(RESULT_CARD_MANAGEMENT_ROLES),
  async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = parseInt(c.req.param('id'), 10);

  try {
    const body = await c.req.json().catch(() => ({}));
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const row = await db.prepare(`SELECT school_id, status FROM result_cards WHERE id = ?`).bind(id).first<any>();
    if (!row) return c.json({ error: 'كارت النتيجة غير موجود' }, 404);
    if (row.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح' }, 403);
    }
    await db.prepare(`UPDATE result_cards SET status = 'cancelled', updated_at = unixepoch() WHERE id = ? AND school_id = ?`).bind(id, targetSchool.schoolId).run();
    return c.json({ data: { id, status: 'cancelled' }, message: 'تم إلغاء الكارت' });
  } catch (err: any) {
    return c.json({ error: 'فشل في إلغاء الكارت', detail: err.message }, 500);
  }
  },
);

// GET /api/verify/result-card/:token
// Public endpoint — no JWT required
// ===========================================
app.get('/api/verify/result-card/:token', async (c) => {
  const db = c.env.DB;
  const token = c.req.param('token');

  try {
    const row = await db.prepare(`
      SELECT card_number, student_name_snapshot, class_name_snapshot, section_name_snapshot,
             school_name_snapshot, academic_year_snapshot, generated_at, status,
             overall_result_status, general_exemption_status,
             card_data_json
      FROM result_cards WHERE verification_token = ?
    `).bind(token).first<any>();

    if (!row) {
      return c.json({
        valid: false,
        message: 'الكارت غير موجود أو رمز التحقق غير صحيح',
      }, 404);
    }

    if (row.status === 'cancelled') {
      return c.json({
        valid: false,
        cancelled: true,
        message: 'هذا الكارت ملغى ولا يُعتد به',
        card_number: row.card_number,
        student_name: row.student_name_snapshot,
        school_name: row.school_name_snapshot,
        generated_at: row.generated_at,
      });
    }

    let cardData = null;
    try {
      cardData = JSON.parse(row.card_data_json || '{}');
    } catch { /* ignore */ }
    const docSettings = cardData?.document_settings || {};
    const displaySettings = parseResultCardDisplaySettings(
      docSettings.result_card_display_settings,
    );
    const summary = cardData?.summary || {};
    return c.json({
      valid: true,
      card_number: row.card_number,
      student_name: row.student_name_snapshot,
      school_name: row.school_name_snapshot,
      class_name: row.class_name_snapshot,
      section_name: row.section_name_snapshot,
      academic_year: row.academic_year_snapshot,
      generated_at: row.generated_at,
      status: row.status,
      card_mode: cardData?.card_mode || 'complete',
      overall_result_status:
        summary.overall_result_status || row.overall_result_status,
      general_exemption_status: row.general_exemption_status === 1,
      decision_note: displaySettings.show_notes_decisions
        ? cardData?.decision_note || null
        : null,
      verification_note: docSettings.verification_note_text || null,
    });
  } catch (err: any) {
    return c.json({ valid: false, message: 'خطأ في التحقق', detail: err.message }, 500);
  }
});

// ===========================================
// Phase 7: Student Fees & Financial Receipts
// ===========================================

function toArabicIndic(num: number | null | undefined): string {
  if (num === null || num === undefined) return '';
  return String(num).replace(/\d/g, d => String.fromCharCode(0x0660 + parseInt(d, 10)));
}

function generateReceiptNumber(schoolId: number, studentId: number): string {
  const ts = Math.floor(Date.now() / 1000);
  return `REC-${schoolId}-${studentId}-${ts}`;
}

function canManageOfficialBookTemplates(roleKey: RoleKey): boolean {
  return hasRole(roleKey, SCHOOL_MANAGEMENT_ROLES);
}

function canManageOfficialBooks(roleKey: RoleKey): boolean {
  return hasRole(roleKey, OFFICIAL_BOOK_ACCESS_ROLES);
}

function canViewOfficialBooks(roleKey: RoleKey): boolean {
  return hasRole(roleKey, OFFICIAL_BOOK_VIEW_ROLES);
}

function canViewPrintRecords(roleKey: RoleKey): boolean {
  return hasRole(roleKey, OFFICIAL_BOOK_VIEW_ROLES);
}

function canManageFees(roleKey: RoleKey): boolean {
  return hasRole(roleKey, FEE_MANAGEMENT_ROLES);
}

function canAccessTreasury(roleKey: RoleKey): boolean {
  return hasRole(roleKey, FINANCE_ACCESS_ROLES);
}

function canManageTreasury(roleKey: RoleKey): boolean {
  return hasRole(roleKey, FINANCE_ACCESS_ROLES);
}

function canViewEmployees(roleKey: RoleKey): boolean {
  return hasRole(roleKey, EMPLOYEE_ACCESS_ROLES);
}

function canManageEmployees(roleKey: RoleKey): boolean {
  return hasRole(roleKey, EMPLOYEE_MANAGEMENT_ROLES);
}

function canManageSalaries(roleKey: RoleKey): boolean {
  return hasRole(roleKey, EMPLOYEE_SALARY_ROLES);
}

// GET /api/student-fees
// ===========================================
app.get('/api/student-fees', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  try {
    const query = c.req.query();
    const studentId = query.student_id ? parseInt(query.student_id, 10) : null;
    const status = query.status || null;

    let sql = `SELECT sf.id, sf.school_id, sf.student_id, sf.academic_year_id, sf.fee_type, sf.amount, sf.currency, sf.due_date, sf.paid_amount, sf.status, sf.notes, sf.discount_type, sf.discount_value, sf.discount_amount, sf.net_fee, sf.created_at, sf.updated_at, st.full_name as student_name, st.student_number, c.name as class_name, s.name as section_name FROM student_fees sf LEFT JOIN students st ON sf.student_id = st.id LEFT JOIN classes c ON st.class_id = c.id LEFT JOIN sections s ON st.section_id = s.id WHERE 1=1`;
    const params: any[] = [];

    if (scope === 'single' && resolvedSchoolId) {
      sql += ` AND sf.school_id = ?`;
      params.push(resolvedSchoolId);
    }

    if (studentId) { sql += ` AND sf.student_id = ?`; params.push(studentId); }
    if (status) { sql += ` AND sf.status = ?`; params.push(status); }

    sql += ` ORDER BY sf.created_at DESC`;

    const stmt = db.prepare(sql);
    const rows = await stmt.bind(...params).all<any>();
    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الأقساط', detail: err.message }, 500);
  }
});

// POST /api/student-fees
// ===========================================
app.post('/api/student-fees', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canManageFees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الأقساط' }, 403);
  }

  try {
    const body = await c.req.json();
    let { school_id, student_id, academic_year_id, fee_type, amount, currency, due_date, notes } = body;
    const targetSchool = await resolveActiveWriteSchool(db, user, school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    school_id = targetSchool.schoolId;

    if (!school_id || !student_id || !amount) {
      return c.json({ error: 'المدرسة والطالب والمبلغ مطلوبة' }, 400);
    }

    const student = await db.prepare('SELECT school_id, status FROM students WHERE id = ?').bind(student_id).first<{ school_id: number; status: string }>();
    if (!student) return c.json({ error: 'الطالب غير موجود' }, 404);
    if (student.school_id !== school_id) return c.json({ error: 'الطالب لا ينتمي لهذه المدرسة' }, 400);
    if (student.status !== 'active') return c.json({ error: 'لا يمكن إنشاء قسط لطالب غير نشط' }, 400);

    // Duplicate fee prevention: same student + academic_year + fee_type (unless academic_year is null, then block any active fee for same type)
    const duplicateCheck = await db.prepare(`
      SELECT id FROM student_fees
      WHERE student_id = ? AND academic_year_id IS ? AND fee_type = ? AND status IN ('pending','partial','paid')
    `).bind(student_id, academic_year_id || null, fee_type || 'رسوم دراسية').first<{ id: number }>();
    if (duplicateCheck) {
      return c.json({ error: 'يوجد قسط نشط بنفس النوع والعام الدراسي لهذا الطالب' }, 409);
    }

    // Discount calculations
    const discount_type = body.discount_type || 'none';
    const discount_value = parseFloat(body.discount_value || '0') || 0;
    const amountNum = parseFloat(amount);
    let discount_amount = 0;
    let net_fee = amountNum;
    if (discount_type === 'fixed') {
      discount_amount = Math.min(discount_value, amountNum);
      net_fee = amountNum - discount_amount;
    } else if (discount_type === 'percentage') {
      discount_amount = Math.min((amountNum * discount_value) / 100, amountNum);
      net_fee = amountNum - discount_amount;
    }

    const result = await db.prepare(`
      INSERT INTO student_fees (school_id, student_id, academic_year_id, fee_type, amount, currency, due_date, paid_amount, status, notes, discount_type, discount_value, discount_amount, net_fee, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?, ?, ?, ?, unixepoch(), unixepoch())
    `).bind(school_id, student_id, academic_year_id || null, fee_type || 'رسوم دراسية', amountNum, currency || 'EGP', due_date || null, notes || null, discount_type, discount_value, discount_amount, net_fee).run();

    return c.json({ data: { id: result.meta.last_row_id, school_id, student_id, amount, status: 'pending' } }, 201);
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء القسط', detail: err.message }, 500);
  }
});

// PUT /api/student-fees/:id
// ===========================================
app.put('/api/student-fees/:id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = parseInt(c.req.param('id'), 10);

  if (!user || !canManageFees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية تعديل الأقساط' }, 403);
  }

  try {
    const body = await c.req.json();
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const existing = await db.prepare('SELECT * FROM student_fees WHERE id = ?').bind(id).first<any>();
    if (!existing) return c.json({ error: 'القسط غير موجود' }, 404);
    if (existing.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح' }, 403);
    }

    const fee_type = body.fee_type !== undefined ? body.fee_type : existing.fee_type;
    const amount = body.amount !== undefined ? parseFloat(body.amount) : existing.amount;
    const currency = body.currency !== undefined ? body.currency : existing.currency;
    const due_date = body.due_date !== undefined ? body.due_date : existing.due_date;
    const notes = body.notes !== undefined ? body.notes : existing.notes;

    // Recalculate discount if amount or discount fields changed
    const discount_type = body.discount_type !== undefined ? body.discount_type : (existing.discount_type || 'none');
    const discount_value = body.discount_value !== undefined ? parseFloat(body.discount_value || '0') : (existing.discount_value || 0);
    let discount_amount = 0;
    let net_fee = amount;
    if (discount_type === 'fixed') {
      discount_amount = Math.min(discount_value, amount);
      net_fee = amount - discount_amount;
    } else if (discount_type === 'percentage') {
      discount_amount = Math.min((amount * discount_value) / 100, amount);
      net_fee = amount - discount_amount;
    }

    await db.prepare(`
      UPDATE student_fees SET fee_type = ?, amount = ?, currency = ?, due_date = ?, notes = ?, discount_type = ?, discount_value = ?, discount_amount = ?, net_fee = ?, updated_at = unixepoch() WHERE id = ? AND school_id = ?
    `).bind(fee_type, amount, currency, due_date, notes, discount_type, discount_value, discount_amount, net_fee, id, targetSchool.schoolId).run();

    return c.json({ data: { id, fee_type, amount, currency, due_date, notes, discount_type, discount_value, discount_amount, net_fee }, message: 'تم تحديث القسط' });
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث القسط', detail: err.message }, 500);
  }
});

// DELETE /api/student-fees/:id
// ===========================================
app.delete('/api/student-fees/:id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = parseInt(c.req.param('id'), 10);

  if (!user || !canManageFees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية حذف الأقساط' }, 403);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const existing = await db.prepare('SELECT school_id, paid_amount FROM student_fees WHERE id = ?').bind(id).first<{ school_id: number; paid_amount: number }>();
    if (!existing) return c.json({ error: 'القسط غير موجود' }, 404);
    if (existing.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح' }, 403);
    }
    if (existing.paid_amount > 0) {
      return c.json({ error: 'لا يمكن حذف قسط تم سداد جزء منه' }, 400);
    }

    // Also block if any payment records exist (even zero-amount ones)
    const paymentCount = await db.prepare('SELECT COUNT(*) as cnt FROM fee_payments WHERE student_fee_id = ?').bind(id).first<{ cnt: number }>();
    if (paymentCount && paymentCount.cnt > 0) {
      return c.json({ error: 'لا يمكن حذف قسط له مدفوعات مسجلة. استخدم إلغاء القسط بدلاً من الحذف.' }, 400);
    }

    await db.prepare('DELETE FROM student_fees WHERE id = ? AND school_id = ?').bind(id, targetSchool.schoolId).run();
    return c.json({ data: { id }, message: 'تم حذف القسط' });
  } catch (err: any) {
    return c.json({ error: 'فشل في حذف القسط', detail: err.message }, 500);
  }
});

// GET /api/fee-payments
// ===========================================
app.get('/api/fee-payments', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  try {
    const query = c.req.query();
    const studentId = query.student_id ? parseInt(query.student_id, 10) : null;
    const studentFeeId = query.student_fee_id ? parseInt(query.student_fee_id, 10) : null;

    let sql = `SELECT fp.id, fp.school_id, fp.student_fee_id, fp.student_id, fp.amount, fp.payment_method, fp.payment_date, fp.receipt_number, fp.notes, fp.created_by_user_id, fp.created_at, st.full_name as student_name, st.student_number, u.full_name as created_by_name FROM fee_payments fp LEFT JOIN students st ON fp.student_id = st.id LEFT JOIN users u ON fp.created_by_user_id = u.id WHERE 1=1`;
    const params: any[] = [];

    if (scope === 'single' && resolvedSchoolId) {
      sql += ` AND fp.school_id = ?`;
      params.push(resolvedSchoolId);
    }

    if (studentId) { sql += ` AND fp.student_id = ?`; params.push(studentId); }
    if (studentFeeId) { sql += ` AND fp.student_fee_id = ?`; params.push(studentFeeId); }

    sql += ` ORDER BY fp.payment_date DESC`;

    const stmt = db.prepare(sql);
    const rows = await stmt.bind(...params).all<any>();
    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب المدفوعات', detail: err.message }, 500);
  }
});

// POST /api/fee-payments
// ===========================================
app.post('/api/fee-payments', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canManageFees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية تسجيل المدفوعات' }, 403);
  }

  try {
    const body = await c.req.json();
    const { student_fee_id, amount, payment_method, payment_date, notes } = body;
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);

    if (!student_fee_id || !amount || !payment_date) {
      return c.json({ error: 'معرف القسط والمبلغ وتاريخ الدفع مطلوبة' }, 400);
    }
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return c.json({ error: 'المبلغ يجب أن يكون أكبر من صفر' }, 400);
    }

    const fee = await db.prepare('SELECT * FROM student_fees WHERE id = ?').bind(student_fee_id).first<any>();
    if (!fee) return c.json({ error: 'القسط غير موجود' }, 404);

    if (fee.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: القسط لا ينتمي إلى مدرستك' }, 403);
    }

    // Use net_fee for remaining if available (discount-aware), fallback to amount
    const targetAmount = fee.net_fee || fee.amount;
    const remaining = targetAmount - fee.paid_amount;
    if (amountNum > remaining) {
      return c.json({ error: `المبلغ المدفوع (${amountNum}) يتجاوز المتبقي (${remaining})` }, 400);
    }

    const newPaid = fee.paid_amount + amountNum;
    const newStatus = newPaid >= targetAmount ? 'paid' : (newPaid > 0 ? 'partial' : 'pending');

    // Save original fee state for potential compensating rollback
    const originalPaid = fee.paid_amount;
    const originalStatus = fee.status;

    const result = await db.prepare(`
      INSERT INTO fee_payments (school_id, student_fee_id, student_id, amount, payment_method, payment_date, notes, created_by_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).bind(fee.school_id, student_fee_id, fee.student_id, amountNum, payment_method || 'cash', payment_date, notes || null, user.id).run();

    await db.prepare(`
      UPDATE student_fees SET paid_amount = ?, status = ?, updated_at = unixepoch() WHERE id = ? AND school_id = ?
    `).bind(newPaid, newStatus, student_fee_id, targetSchool.schoolId).run();

    const paymentId = result.meta.last_row_id;

    // ── Treasury auto-income transaction (Phase 8) ──
    try {
      // Check for duplicate treasury transaction
      const existingTx = await db.prepare(`
        SELECT id FROM treasury_transactions WHERE school_id = ? AND source_type = 'fee_payment' AND source_id = ?
      `).bind(fee.school_id, paymentId).first<any>();

      if (!existingTx) {
        // TEST HOOK: simulate treasury insert failure for rollback testing
        if (body._force_treasury_failure === true) {
          throw new Error('SIMULATED_TREASURY_INSERT_FAILURE');
        }
        // Create treasury income transaction
        await db.prepare(`
          INSERT INTO treasury_transactions
          (school_id, transaction_type, category, amount, currency, description,
           source_type, source_id, status, created_by, created_at)
          VALUES (?, 'income', 'tuition_fee', ?, 'IQD', 'دفعة قسط طالب',
                  'fee_payment', ?, 'active', ?, unixepoch())
        `).bind(fee.school_id, amountNum, paymentId, user.id).run();

        // Update cached balance
        await db.prepare(`
          INSERT INTO treasury_accounts (school_id, current_balance, updated_at)
          VALUES (?, ?, unixepoch())
          ON CONFLICT(school_id) DO UPDATE SET
            current_balance = treasury_accounts.current_balance + excluded.current_balance,
            updated_at = unixepoch()
        `).bind(fee.school_id, amountNum).run();
      }
    } catch (treasuryErr: any) {
      // COMPENSATING ROLLBACK — treasury failed, undo payment to maintain financial consistency
      await db.prepare(`DELETE FROM fee_payments WHERE id = ?`).bind(paymentId).run();
      await db.prepare(`
        UPDATE student_fees SET paid_amount = ?, status = ?, updated_at = unixepoch() WHERE id = ?
      `).bind(originalPaid, originalStatus, student_fee_id).run();

      return c.json({
        error: 'تعذر تسجيل الدفعة في الخزنة، تم التراجع عن الدفعة',
        detail: treasuryErr.message
      }, 500);
    }

    // ── Auto-generate receipt (best-effort, isolated from payment/treasury success) ──
    let autoReceipt = null;
    let receiptWarning = null;
    if (body.auto_generate_receipt === true) {
      try {
        const dupCheck = await db.prepare(`SELECT id FROM fee_receipts WHERE payment_ids_json LIKE ?`).bind(`%"${paymentId}"%`).first<any>();
        if (!dupCheck) {
          const student = await db.prepare(`
            SELECT s.id, s.school_id, s.full_name, s.student_number, s.class_id, s.section_id,
                   c.name AS class_name, sec.name AS section_name, sch.name AS school_name
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN sections sec ON s.section_id = sec.id
            LEFT JOIN schools sch ON s.school_id = sch.id
            WHERE s.id = ? AND s.status = 'active'
          `).bind(fee.student_id).first<any>();

          if (student) {
            const ay = await db.prepare(`SELECT id, name FROM academic_years WHERE school_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1`).bind(student.school_id).first<any>();
            const token = generateVerificationToken();
            const tokenHash = await hashToken(token);
            const receiptNumber = generateReceiptNumber(student.school_id, fee.student_id);
            const paymentsSnapshot = [{
              payment_id: paymentId,
              amount: amountNum,
              payment_method: payment_method || 'cash',
              payment_date: payment_date,
              fee_type: fee.fee_type,
            }];
            const receiptSettings = await db.prepare(`
              SELECT receipt_footer_text, verification_note_text, use_school_logo_on_docs
              FROM school_settings WHERE school_id = ?
            `).bind(student.school_id).first<any>();
            const schoolLogoForReceipt = await db.prepare(`SELECT logo_url FROM schools WHERE id = ?`).bind(student.school_id).first<any>();
            const settingsSnapshot = {
              receipt_footer_text: receiptSettings?.receipt_footer_text || null,
              verification_note_text: receiptSettings?.verification_note_text || null,
              logo_url: (receiptSettings?.use_school_logo_on_docs === 1 && schoolLogoForReceipt?.logo_url) ? schoolLogoForReceipt.logo_url : null,
            };
            await db.prepare(`
              INSERT INTO fee_receipts (
                school_id, student_id, receipt_number, total_amount,
                payment_ids_json, payments_snapshot_json, settings_snapshot_json,
                student_name_snapshot, class_name_snapshot, section_name_snapshot,
                school_name_snapshot, academic_year_snapshot,
                verification_token, verification_hash,
                status, created_by_user_id, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, unixepoch(), unixepoch())
            `).bind(
              student.school_id, fee.student_id, receiptNumber, amountNum,
              JSON.stringify([paymentId]), JSON.stringify(paymentsSnapshot), JSON.stringify(settingsSnapshot),
              student.full_name, student.class_name || null, student.section_name || null,
              student.school_name || null, ay?.name || null,
              token, tokenHash,
              user.id
            ).run();
            autoReceipt = { receipt_number: receiptNumber, verification_url: `/verify/receipt/${token}` };
          }
        }
      } catch (receiptErr: any) {
        receiptWarning = 'تعذر إنشاء الإيصال التلقائي: ' + (receiptErr?.message || receiptErr);
      }
    }

    const response: any = { data: { id: paymentId, amount: amountNum, payment_method, remaining: targetAmount - newPaid, auto_receipt: autoReceipt } };
    if (receiptWarning) response.data.receipt_warning = receiptWarning;
    return c.json(response, 201);
  } catch (err: any) {
    return c.json({ error: 'فشل في تسجيل الدفع', detail: err.message }, 500);
  }
});

// GET /api/fee-receipts
// ===========================================
app.get('/api/fee-receipts', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  try {
    const query = c.req.query();
    const studentId = query.student_id ? parseInt(query.student_id, 10) : null;

    let sql = `SELECT fr.id, fr.school_id, fr.student_id, fr.receipt_number, fr.total_amount, fr.student_name_snapshot, fr.class_name_snapshot, fr.section_name_snapshot, fr.school_name_snapshot, fr.academic_year_snapshot, fr.status, fr.verification_token, fr.created_at, fr.created_by_user_id, u.full_name as created_by_name FROM fee_receipts fr LEFT JOIN users u ON fr.created_by_user_id = u.id WHERE 1=1`;
    const params: any[] = [];

    if (scope === 'single' && resolvedSchoolId) {
      sql += ` AND fr.school_id = ?`;
      params.push(resolvedSchoolId);
    }

    if (studentId) { sql += ` AND fr.student_id = ?`; params.push(studentId); }

    sql += ` ORDER BY fr.created_at DESC`;

    const stmt = db.prepare(sql);
    const rows = await stmt.bind(...params).all<any>();
    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الإيصالات', detail: err.message }, 500);
  }
});

// GET /api/fee-receipts/:id
// ===========================================
app.get('/api/fee-receipts/:id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = parseInt(c.req.param('id'), 10);

  try {
    const row = await db.prepare('SELECT * FROM fee_receipts WHERE id = ?').bind(id).first<any>();
    if (!row) return c.json({ error: 'الإيصال غير موجود' }, 404);
    if (scope === 'single' && resolvedSchoolId && row.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح' }, 403);
    }
    let data = row;
    try {
      data = { ...row, payments_snapshot: JSON.parse(row.payments_snapshot_json || '[]'), payment_ids: JSON.parse(row.payment_ids_json || '[]'), settings_snapshot: JSON.parse(row.settings_snapshot_json || '{}') };
    } catch { /* leave as-is */ }
    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الإيصال', detail: err.message }, 500);
  }
});

// POST /api/fee-receipts/generate
// ===========================================
app.post('/api/fee-receipts/generate', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canManageFees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إنشاء الإيصالات' }, 403);
  }

  try {
    const body = await c.req.json();
    const { student_id, payment_ids } = body;
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);

    if (!student_id || !Array.isArray(payment_ids) || payment_ids.length === 0) {
      return c.json({ error: 'الطالب ومعرفات المدفوعات مطلوبة' }, 400);
    }

    const student = await db.prepare(`
      SELECT s.id, s.school_id, s.full_name, s.student_number, s.class_id, s.section_id,
             c.name AS class_name, sec.name AS section_name, sch.name AS school_name
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN sections sec ON s.section_id = sec.id
      LEFT JOIN schools sch ON s.school_id = sch.id
      WHERE s.id = ? AND s.status = 'active'
    `).bind(student_id).first<any>();

    if (!student) return c.json({ error: 'الطالب غير موجود أو غير نشط' }, 404);
    if (student.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: الطالب لا ينتمي إلى مدرستك' }, 403);
    }

    // Fetch payments
    const placeholders = payment_ids.map(() => '?').join(',');
    const paymentRows = await db.prepare(`
      SELECT fp.*, sf.fee_type FROM fee_payments fp
      JOIN student_fees sf ON fp.student_fee_id = sf.id
      WHERE fp.id IN (${placeholders}) AND fp.student_id = ? AND fp.school_id = ?
    `).bind(...payment_ids, student_id, student.school_id).all<any>();
    const payments = paymentRows.results || [];

    if (payments.length === 0) return c.json({ error: 'لا توجد مدفوعات صالحة' }, 400);

    const totalAmount = payments.reduce((sum: number, p: any) => sum + p.amount, 0);

    const ay = await db.prepare(`SELECT id, name FROM academic_years WHERE school_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1`).bind(student.school_id).first<any>();

    const token = generateVerificationToken();
    const tokenHash = await hashToken(token);
    const receiptNumber = generateReceiptNumber(student.school_id, student_id);

    const paymentsSnapshot = payments.map((p: any) => ({
      payment_id: p.id,
      amount: p.amount,
      payment_method: p.payment_method,
      payment_date: p.payment_date,
      fee_type: p.fee_type,
    }));
    const receiptSettings2 = await db.prepare(`
      SELECT receipt_footer_text, verification_note_text, use_school_logo_on_docs
      FROM school_settings WHERE school_id = ?
    `).bind(student.school_id).first<any>();
    const schoolLogoForReceipt2 = await db.prepare(`SELECT logo_url FROM schools WHERE id = ?`).bind(student.school_id).first<any>();
    const settingsSnapshot2 = {
      receipt_footer_text: receiptSettings2?.receipt_footer_text || null,
      verification_note_text: receiptSettings2?.verification_note_text || null,
      logo_url: (receiptSettings2?.use_school_logo_on_docs === 1 && schoolLogoForReceipt2?.logo_url) ? schoolLogoForReceipt2.logo_url : null,
    };

    await db.prepare(`
      INSERT INTO fee_receipts (
        school_id, student_id, receipt_number, total_amount,
        payment_ids_json, payments_snapshot_json, settings_snapshot_json,
        student_name_snapshot, class_name_snapshot, section_name_snapshot,
        school_name_snapshot, academic_year_snapshot,
        verification_token, verification_hash,
        status, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, unixepoch(), unixepoch())
    `).bind(
      student.school_id, student_id, receiptNumber, totalAmount,
      JSON.stringify(payment_ids), JSON.stringify(paymentsSnapshot), JSON.stringify(settingsSnapshot2),
      student.full_name, student.class_name || null, student.section_name || null,
      student.school_name || null, ay?.name || null,
      token, tokenHash,
      user.id
    ).run();

    const newReceipt = await db.prepare('SELECT * FROM fee_receipts WHERE verification_token = ?').bind(token).first<any>();

    return c.json({
      data: {
        receipt: newReceipt,
        verification_url: `/verify/receipt/${token}`,
      },
      message: 'تم إنشاء الإيصال بنجاح',
    });
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء الإيصال', detail: err.message }, 500);
  }
});

// PUT /api/fee-receipts/:id/cancel
// ===========================================
app.put('/api/fee-receipts/:id/cancel', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = parseInt(c.req.param('id'), 10);

  if (!user || !canManageFees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إلغاء الإيصالات' }, 403);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const row = await db.prepare('SELECT school_id, status FROM fee_receipts WHERE id = ?').bind(id).first<any>();
    if (!row) return c.json({ error: 'الإيصال غير موجود' }, 404);
    if (row.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح' }, 403);
    }
    if (row.status !== 'active') {
      return c.json({ error: 'لا يمكن إلغاء إيصال غير نشط' }, 400);
    }

    await db.prepare(`UPDATE fee_receipts SET status = 'cancelled', updated_at = unixepoch() WHERE id = ? AND school_id = ?`).bind(id, targetSchool.schoolId).run();
    return c.json({ data: { id, status: 'cancelled' }, message: 'تم إلغاء الإيصال' });
  } catch (err: any) {
    return c.json({ error: 'فشل في إلغاء الإيصال', detail: err.message }, 500);
  }
});

// ===========================================
// PUT /api/fee-receipts/:id/mark-printed
// ===========================================
app.put('/api/fee-receipts/:id/mark-printed', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = parseInt(c.req.param('id'), 10);

  if (!user) {
    return c.json({ error: 'غير مسموح: يجب تسجيل الدخول أولاً' }, 403);
  }

  // Fees access required (view, not just manage, because print is a view-level action)
  const canAccess = ['system_admin', 'school_owner', 'principal', 'vice_principal', 'accountant', 'registrar', 'parent'].includes(user.role_key);
  if (!canAccess) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية الوصول إلى الإيصالات' }, 403);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const row = await db.prepare('SELECT school_id, status, receipt_number FROM fee_receipts WHERE id = ?').bind(id).first<any>();
    if (!row) return c.json({ error: 'الإيصال غير موجود' }, 404);
    if (row.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح' }, 403);
    }
    if (row.status !== 'active') {
      return c.json({ error: 'لا يمكن تعليم إيصال غير فعال كمطبوع' }, 400);
    }

    const printedAt = Math.floor(Date.now() / 1000);

    // Update fee_receipts printed_at if column exists (best-effort via migrations; use try/catch for schema robustness)
    try {
      await db.prepare(`UPDATE fee_receipts SET printed_at = ?, updated_at = unixepoch() WHERE id = ? AND school_id = ?`).bind(printedAt, id, targetSchool.schoolId).run();
    } catch (e: any) {
      // If column doesn't exist yet, just continue
      if (e.message && !e.message.includes('no such column')) {
        throw e;
      }
    }

    // Create print record
    const copies = typeof body.copies === 'number' ? body.copies : 1;
    await db.prepare(`
      INSERT INTO print_records (school_id, document_id, print_type, source_type, source_id, document_number, title, printed_at, printed_by_user_id, copies_count, printer_info_json)
      VALUES (?, ?, 'receipt', 'fee_receipts', ?, ?, 'وصل قسط', ?, ?, ?, ?)
    `).bind(targetSchool.schoolId, id, id, row.receipt_number || '', printedAt, user.id, copies, null).run();

    return c.json({ data: { id, printed_at: printedAt }, message: 'تم تعليم الإيصال كمطبوع' });
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث الإيصال', detail: err.message }, 500);
  }
});

// GET /api/verify/receipt/:token
// Public endpoint — no JWT required
// ===========================================
app.get('/api/verify/receipt/:token', async (c) => {
  const db = c.env.DB;
  const token = c.req.param('token');

  try {
    const row = await db.prepare(`
      SELECT receipt_number, student_name_snapshot, class_name_snapshot, section_name_snapshot,
             school_name_snapshot, academic_year_snapshot, total_amount, status, created_at,
             payments_snapshot_json, settings_snapshot_json
      FROM fee_receipts WHERE verification_token = ?
    `).bind(token).first<any>();

    if (!row) {
      return c.json({
        valid: false,
        message: 'الإيصال غير موجود أو رمز التحقق غير صحيح',
      }, 404);
    }

    if (row.status === 'cancelled') {
      return c.json({
        valid: false,
        cancelled: true,
        message: 'هذا الإيصال ملغى ولا يُعتد به',
        receipt_number: row.receipt_number,
        student_name: row.student_name_snapshot,
        school_name: row.school_name_snapshot,
        created_at: row.created_at,
      });
    }

    let payments = [];
    try {
      payments = JSON.parse(row.payments_snapshot_json || '[]');
    } catch { /* ignore */ }
    let receiptSettings = null;
    try {
      receiptSettings = JSON.parse(row.settings_snapshot_json || '{}');
    } catch { /* ignore */ }

    return c.json({
      valid: true,
      receipt_number: row.receipt_number,
      student_name: row.student_name_snapshot,
      school_name: row.school_name_snapshot,
      class_name: row.class_name_snapshot,
      section_name: row.section_name_snapshot,
      academic_year: row.academic_year_snapshot,
      total_amount: row.total_amount,
      created_at: row.created_at,
      status: row.status,
      payments,
      verification_note: receiptSettings?.verification_note_text || null,
    });
  } catch (err: any) {
    return c.json({ valid: false, message: 'خطأ في التحقق', detail: err.message }, 500);
  }
});

// Serve static files (assets, static)
// ===========================================
app.use('/assets/*', serveStatic({ root: './', manifest: {} as any }))
app.use('/static/*', serveStatic({ root: './', manifest: {} as any }))

// ===========================================
// Phase 9: Employees & Salaries (الموظفون والرواتب)
// ===========================================

// GET /api/employees
// ===========================================
app.get('/api/employees', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canViewEmployees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الموظفين والرواتب' }, 403);
  }

  try {
    const query = c.req.query();
    const status = query.status || null;

    let sql = `SELECT e.*, sch.name as school_name FROM employees e LEFT JOIN schools sch ON e.school_id = sch.id WHERE 1=1`;
    const params: any[] = [];

    if (scope === 'single' && resolvedSchoolId) {
      sql += ` AND e.school_id = ?`;
      params.push(resolvedSchoolId);
    }
    if (status) {
      sql += ` AND e.status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY e.created_at DESC`;

    const rows = await db.prepare(sql).bind(...params).all<any>();
    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الموظفين', detail: err.message }, 500);
  }
});

// GET /api/employees/:id
// ===========================================
app.get('/api/employees/:id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canViewEmployees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الموظفين والرواتب' }, 403);
  }

  try {
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'معرف غير صالح' }, 400);

    const row = await db.prepare(`
      SELECT e.*, sch.name as school_name FROM employees e
      LEFT JOIN schools sch ON e.school_id = sch.id
      WHERE e.id = ?
    `).bind(id).first<any>();

    if (!row) return c.json({ error: 'الموظف غير موجود' }, 404);

    if (scope === 'single' && resolvedSchoolId && row.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح: الموظف لا ينتمي إلى مدرستك' }, 403);
    }

    return c.json({ data: row });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الموظف', detail: err.message }, 500);
  }
});

// POST /api/employees
// ===========================================
app.post('/api/employees', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canManageEmployees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الموظفين والرواتب' }, 403);
  }

  try {
    const body = await c.req.json();
    const { full_name, school_id, employee_number, phone, email, role, job_title, salary_amount, hire_date, notes } = body;

    if (!full_name) {
      return c.json({ error: 'اسم الموظف مطلوب' }, 400);
    }

    const targetSchool = await resolveActiveWriteSchool(db, user, school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const targetSchoolId = targetSchool.schoolId;

    const salaryNum = salary_amount !== undefined && salary_amount !== '' ? parseInt(String(salary_amount), 10) : 0;
    if (isNaN(salaryNum) || salaryNum < 0) {
      return c.json({ error: 'راتب الموظف يجب أن يكون صفر أو أكبر' }, 400);
    }

    const result = await db.prepare(`
      INSERT INTO employees (school_id, full_name, employee_number, phone, email, role, job_title, salary_amount, hire_date, notes, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
    `).bind(targetSchoolId, full_name, employee_number || null, phone || null, email || null, role || 'staff', job_title || null, salaryNum, hire_date || null, notes || null, user.id).run();

    const newId = result.meta.last_row_id;
    return c.json({ data: { id: newId, full_name, salary_amount: salaryNum, status: 'active' } }, 201);
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء الموظف', detail: err.message }, 500);
  }
});

// PUT /api/employees/:id
// ===========================================
app.put('/api/employees/:id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canManageEmployees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الموظفين والرواتب' }, 403);
  }

  try {
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'معرف غير صالح' }, 400);

    const body = await c.req.json();
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);

    const existing = await db.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first<any>();
    if (!existing) return c.json({ error: 'الموظف غير موجود' }, 404);

    if (existing.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: الموظف لا ينتمي إلى مدرستك' }, 403);
    }

    const { full_name, employee_number, phone, email, role, job_title, salary_amount, hire_date, notes } = body;

    const salaryNum = salary_amount !== undefined && salary_amount !== '' ? parseInt(String(salary_amount), 10) : existing.salary_amount;
    if (isNaN(salaryNum) || salaryNum < 0) {
      return c.json({ error: 'راتب الموظف يجب أن يكون صفر أو أكبر' }, 400);
    }

    await db.prepare(`
      UPDATE employees SET
        full_name = COALESCE(?, full_name),
        employee_number = COALESCE(?, employee_number),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        role = COALESCE(?, role),
        job_title = COALESCE(?, job_title),
        salary_amount = ?,
        hire_date = COALESCE(?, hire_date),
        notes = COALESCE(?, notes),
        updated_at = unixepoch()
      WHERE id = ? AND school_id = ?
    `).bind(
      full_name || null, employee_number || null, phone || null, email || null,
      role || null, job_title || null, salaryNum, hire_date || null, notes || null, id, targetSchool.schoolId
    ).run();

    return c.json({ data: { id, updated: true } });
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث الموظف', detail: err.message }, 500);
  }
});

// PUT /api/employees/:id/archive
// ===========================================
app.put('/api/employees/:id/archive', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canManageEmployees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الموظفين والرواتب' }, 403);
  }

  try {
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'معرف غير صالح' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);

    const existing = await db.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first<any>();
    if (!existing) return c.json({ error: 'الموظف غير موجود' }, 404);

    if (existing.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: الموظف لا ينتمي إلى مدرستك' }, 403);
    }

    await db.prepare(`UPDATE employees SET status = 'archived', updated_at = unixepoch() WHERE id = ? AND school_id = ?`).bind(id, targetSchool.schoolId).run();
    return c.json({ data: { id, status: 'archived' } });
  } catch (err: any) {
    return c.json({ error: 'فشل في أرشفة الموظف', detail: err.message }, 500);
  }
});

// GET /api/salaries
// ===========================================
app.get('/api/salaries', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canViewEmployees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الموظفين والرواتب' }, 403);
  }

  try {
    const query = c.req.query();
    const employeeId = query.employee_id ? parseInt(query.employee_id, 10) : null;
    const month = query.month ? parseInt(query.month, 10) : null;
    const year = query.year ? parseInt(query.year, 10) : null;
    const status = query.status || null;

    let sql = `SELECT s.*, e.full_name as employee_name, e.employee_number, e.job_title FROM employee_salaries s LEFT JOIN employees e ON s.employee_id = e.id WHERE 1=1`;
    const params: any[] = [];

    if (scope === 'single' && resolvedSchoolId) {
      sql += ` AND s.school_id = ?`;
      params.push(resolvedSchoolId);
    }
    if (employeeId && !isNaN(employeeId)) {
      sql += ` AND s.employee_id = ?`;
      params.push(employeeId);
    }
    if (month !== null && !isNaN(month)) {
      sql += ` AND s.month = ?`;
      params.push(month);
    }
    if (year !== null && !isNaN(year)) {
      sql += ` AND s.year = ?`;
      params.push(year);
    }
    if (status) {
      sql += ` AND s.status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY s.year DESC, s.month DESC, s.created_at DESC`;

    const rows = await db.prepare(sql).bind(...params).all<any>();
    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الرواتب', detail: err.message }, 500);
  }
});

// GET /api/salaries/:id
// ===========================================
app.get('/api/salaries/:id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canViewEmployees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الموظفين والرواتب' }, 403);
  }

  try {
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'معرف غير صالح' }, 400);

    const row = await db.prepare(`
      SELECT s.*, e.full_name as employee_name, e.employee_number, e.job_title, e.status as employee_status
      FROM employee_salaries s
      LEFT JOIN employees e ON s.employee_id = e.id
      WHERE s.id = ?
    `).bind(id).first<any>();

    if (!row) return c.json({ error: 'الراتب غير موجود' }, 404);

    if (scope === 'single' && resolvedSchoolId && row.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح: الراتب لا ينتمي إلى مدرستك' }, 403);
    }

    return c.json({ data: row });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الراتب', detail: err.message }, 500);
  }
});

// POST /api/salaries/generate
// ===========================================
app.post('/api/salaries/generate', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canManageSalaries(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الموظفين والرواتب' }, 403);
  }

  try {
    const body = await c.req.json();
    const { employee_id, month, year, base_salary, bonus_amount, deduction_amount } = body;
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);

    if (!employee_id || !month || !year) {
      return c.json({ error: 'معرف الموظف والشهر والسنة مطلوبة' }, 400);
    }

    const emp = await db.prepare(`SELECT * FROM employees WHERE id = ?`).bind(employee_id).first<any>();
    if (!emp) return c.json({ error: 'الموظف غير موجود' }, 404);

    const targetSchoolId = targetSchool.schoolId;
    if (emp.school_id !== targetSchoolId) {
      return c.json({ error: 'غير مسموح: الموظف لا ينتمي إلى مدرستك' }, 403);
    }

    if (emp.status === 'archived') {
      return c.json({ error: 'لا يمكن توليد راتب لموظف مؤرشف' }, 400);
    }

    const base = base_salary !== undefined ? parseInt(String(base_salary), 10) : emp.salary_amount;
    const bonus = bonus_amount !== undefined ? parseInt(String(bonus_amount), 10) : 0;
    const deduction = deduction_amount !== undefined ? parseInt(String(deduction_amount), 10) : 0;

    if (isNaN(base) || base < 0 || isNaN(bonus) || bonus < 0 || isNaN(deduction) || deduction < 0) {
      return c.json({ error: 'المبالغ يجب أن تكون صفر أو أكبر' }, 400);
    }

    const net = base + bonus - deduction;
    if (net < 0) {
      return c.json({ error: 'مبلغ الاستقطاع أكبر من الراتب والمكافأة' }, 400);
    }

    const result = await db.prepare(`
      INSERT INTO employee_salaries (school_id, employee_id, month, year, base_salary, bonus_amount, deduction_amount, net_salary, status, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, unixepoch(), unixepoch())
    `).bind(targetSchoolId, employee_id, month, year, base, bonus, deduction, net, user.id).run();

    const newId = result.meta.last_row_id;
    return c.json({ data: { id: newId, employee_id, month, year, base_salary: base, bonus_amount: bonus, deduction_amount: deduction, net_salary: net, status: 'unpaid' } }, 201);
  } catch (err: any) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'يوجد راتب مسجل لهذا الموظف في هذا الشهر' }, 409);
    }
    return c.json({ error: 'فشل في توليد الراتب', detail: err.message }, 500);
  }
});

// POST /api/salaries/generate-all
// ===========================================
app.post('/api/salaries/generate-all', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canManageSalaries(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الموظفين والرواتب' }, 403);
  }

  try {
    const body = await c.req.json();
    const { school_id, month, year, bonus_amount, deduction_amount } = body;

    if (!month || !year) {
      return c.json({ error: 'الشهر والسنة مطلوبة' }, 400);
    }

    const targetSchool = await resolveActiveWriteSchool(db, user, school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const targetSchoolId = targetSchool.schoolId;

    const bonus = bonus_amount !== undefined ? parseInt(String(bonus_amount), 10) : 0;
    const deduction = deduction_amount !== undefined ? parseInt(String(deduction_amount), 10) : 0;

    if (isNaN(bonus) || bonus < 0 || isNaN(deduction) || deduction < 0) {
      return c.json({ error: 'المبالغ يجب أن تكون صفر أو أكبر' }, 400);
    }

    const employees = await db.prepare(`
      SELECT * FROM employees WHERE school_id = ? AND status = 'active'
    `).bind(targetSchoolId).all<any>();

    const created: any[] = [];
    const skipped: any[] = [];

    for (const emp of (employees.results || [])) {
      const base = emp.salary_amount || 0;
      const net = base + bonus - deduction;
      if (net < 0) {
        skipped.push({ employee_id: emp.id, reason: 'مبلغ الاستقطاع أكبر من الراتب والمكافأة' });
        continue;
      }
      try {
        const result = await db.prepare(`
          INSERT INTO employee_salaries (school_id, employee_id, month, year, base_salary, bonus_amount, deduction_amount, net_salary, status, created_by_user_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, unixepoch(), unixepoch())
        `).bind(targetSchoolId, emp.id, month, year, base, bonus, deduction, net, user.id).run();
        created.push({ id: result.meta.last_row_id, employee_id: emp.id, month, year, net_salary: net });
      } catch (insertErr: any) {
        if (insertErr.message && insertErr.message.includes('UNIQUE constraint failed')) {
          skipped.push({ employee_id: emp.id, reason: 'يوجد راتب مسجل لهذا الموظف في هذا الشهر' });
        } else {
          skipped.push({ employee_id: emp.id, reason: insertErr.message });
        }
      }
    }

    return c.json({ data: { created, skipped, count: created.length } });
  } catch (err: any) {
    return c.json({ error: 'فشل في توليد الرواتب', detail: err.message }, 500);
  }
});

// PUT /api/salaries/:id/pay
// ===========================================
app.put('/api/salaries/:id/pay', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canManageSalaries(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الموظفين والرواتب' }, 403);
  }

  try {
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'معرف غير صالح' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);

    const salary = await db.prepare(`
      SELECT s.*, e.full_name as employee_name FROM employee_salaries s
      LEFT JOIN employees e ON s.employee_id = e.id
      WHERE s.id = ?
    `).bind(id).first<any>();

    if (!salary) return c.json({ error: 'الراتب غير موجود' }, 404);

    if (salary.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: الراتب لا ينتمي إلى مدرستك' }, 403);
    }

    if (salary.status === 'paid') {
      return c.json({ error: 'تم دفع هذا الراتب مسبقاً' }, 409);
    }
    if (salary.status === 'cancelled') {
      return c.json({ error: 'هذا الراتب ملغى مسبقاً' }, 409);
    }

    // Check duplicate treasury transaction
    const existingTx = await db.prepare(`
      SELECT id FROM treasury_transactions WHERE school_id = ? AND source_type = 'salary_payment' AND source_id = ?
    `).bind(salary.school_id, id).first<any>();

    if (existingTx) {
      return c.json({ error: 'تم دفع هذا الراتب مسبقاً' }, 409);
    }

    const paidAt = body.paid_at || new Date().toISOString().split('T')[0];
    const paidAtUnix = Math.floor(new Date(paidAt).getTime() / 1000) || Math.floor(Date.now() / 1000);

    // ── Mark salary paid first (optimistic), then treasury; rollback on failure ──
    await db.prepare(`
      UPDATE employee_salaries SET status = 'paid', paid_at = ?, paid_by_user_id = ?, updated_at = unixepoch() WHERE id = ? AND school_id = ?
    `).bind(paidAtUnix, user.id, id, targetSchool.schoolId).run();

    try {
      // Create treasury expense transaction
      await db.prepare(`
        INSERT INTO treasury_transactions
        (school_id, transaction_type, category, amount, currency, description,
         source_type, source_id, status, created_by, created_at)
        VALUES (?, 'expense', 'salary', ?, 'IQD', ?,
                'salary_payment', ?, 'active', ?, unixepoch())
      `).bind(salary.school_id, salary.net_salary, `دفع راتب ${salary.employee_name || salary.employee_id}`, id, user.id).run();

      // Update cached balance
      await db.prepare(`
        INSERT INTO treasury_accounts (school_id, current_balance, updated_at)
        VALUES (?, ?, unixepoch())
        ON CONFLICT(school_id) DO UPDATE SET
          current_balance = treasury_accounts.current_balance + excluded.current_balance,
          updated_at = unixepoch()
      `).bind(salary.school_id, -salary.net_salary).run();

      // Link treasury transaction id back to salary
      const txRow = await db.prepare(`
        SELECT id FROM treasury_transactions WHERE school_id = ? AND source_type = 'salary_payment' AND source_id = ? ORDER BY id DESC LIMIT 1
      `).bind(salary.school_id, id).first<any>();

      if (txRow) {
        await db.prepare(`UPDATE employee_salaries SET treasury_transaction_id = ? WHERE id = ?`).bind(txRow.id, id).run();
      }
    } catch (treasuryErr: any) {
      // COMPENSATING ROLLBACK — treasury failed, revert salary to unpaid
      await db.prepare(`
        UPDATE employee_salaries SET status = 'unpaid', paid_at = NULL, paid_by_user_id = NULL, treasury_transaction_id = NULL, updated_at = unixepoch() WHERE id = ?
      `).bind(id).run();

      return c.json({
        error: 'تعذر تسجيل الدفع في الخزنة، تم التراجع عن دفع الراتب',
        detail: treasuryErr.message
      }, 500);
    }

    return c.json({ data: { id, status: 'paid', paid_at: paidAtUnix, net_salary: salary.net_salary } });
  } catch (err: any) {
    return c.json({ error: 'فشل في دفع الراتب', detail: err.message }, 500);
  }
});

// PUT /api/salaries/:id/cancel
// ===========================================
app.put('/api/salaries/:id/cancel', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canManageSalaries(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الموظفين والرواتب' }, 403);
  }

  try {
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'معرف غير صالح' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);

    const salary = await db.prepare(`SELECT * FROM employee_salaries WHERE id = ?`).bind(id).first<any>();
    if (!salary) return c.json({ error: 'الراتب غير موجود' }, 404);

    if (salary.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: الراتب لا ينتمي إلى مدرستك' }, 403);
    }

    if (salary.status === 'cancelled') {
      return c.json({ error: 'هذا الراتب ملغى مسبقاً' }, 409);
    }

    const { cancel_reason } = body;
    if (!cancel_reason || typeof cancel_reason !== 'string' || cancel_reason.trim().length === 0) {
      return c.json({ error: 'سبب الإلغاء مطلوب' }, 400);
    }

    // If paid, cancel linked treasury transaction and reverse balance
    if (salary.status === 'paid' && salary.treasury_transaction_id) {
      const tx = await db.prepare(`SELECT * FROM treasury_transactions WHERE id = ? AND source_type = 'salary_payment' AND source_id = ?`)
        .bind(salary.treasury_transaction_id, id).first<any>();
      if (tx && tx.status === 'active') {
        await db.prepare(`
          UPDATE treasury_transactions SET status = 'cancelled', cancel_reason = ?, cancelled_by = ?, cancelled_at = unixepoch(), updated_at = unixepoch() WHERE id = ?
        `).bind(cancel_reason, user.id, tx.id).run();

        // Reverse cached balance
        await db.prepare(`
          INSERT INTO treasury_accounts (school_id, current_balance, updated_at)
          VALUES (?, ?, unixepoch())
          ON CONFLICT(school_id) DO UPDATE SET
            current_balance = treasury_accounts.current_balance + excluded.current_balance,
            updated_at = unixepoch()
        `).bind(salary.school_id, salary.net_salary).run();
      }
    }

    await db.prepare(`
      UPDATE employee_salaries SET status = 'cancelled', cancel_reason = ?, updated_at = unixepoch() WHERE id = ? AND school_id = ?
    `).bind(cancel_reason, id, targetSchool.schoolId).run();

    return c.json({ data: { id, status: 'cancelled', cancel_reason } });
  } catch (err: any) {
    return c.json({ error: 'فشل في إلغاء الراتب', detail: err.message }, 500);
  }
});

// GET /api/salaries/reports/monthly
// ===========================================
app.get('/api/salaries/reports/monthly', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canViewEmployees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الموظفين والرواتب' }, 403);
  }

  try {
    const query = c.req.query();
    const month = query.month ? parseInt(query.month, 10) : null;
    const year = query.year ? parseInt(query.year, 10) : null;

    let targetSchoolId = (scope === 'single' && resolvedSchoolId) ? resolvedSchoolId : (query.school_id ? parseInt(query.school_id, 10) : null);

    let sql = `
      SELECT month, year,
        COALESCE(SUM(base_salary), 0) as total_base,
        COALESCE(SUM(bonus_amount), 0) as total_bonus,
        COALESCE(SUM(deduction_amount), 0) as total_deduction,
        COALESCE(SUM(net_salary), 0) as total_net,
        COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid_count,
        COUNT(CASE WHEN status = 'unpaid' THEN 1 END) as unpaid_count,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_count,
        COUNT(*) as total_count
      FROM employee_salaries
      WHERE 1=1
    `;
    const params: any[] = [];

    if (targetSchoolId) {
      sql += ` AND school_id = ?`;
      params.push(targetSchoolId);
    }
    if (month !== null && !isNaN(month)) {
      sql += ` AND month = ?`;
      params.push(month);
    }
    if (year !== null && !isNaN(year)) {
      sql += ` AND year = ?`;
      params.push(year);
    }
    sql += ` GROUP BY month, year ORDER BY year DESC, month DESC`;

    const rows = await db.prepare(sql).bind(...params).all<any>();
    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب تقرير الرواتب', detail: err.message }, 500);
  }
});

// ===========================================
// SPA Fallback: serve index.html for all non-API routes
// ===========================================
app.get('/*', async (c, next) => {
  if (new URL(c.req.url).pathname.startsWith('/api/')) {
    return await next();
  }
  try {
    const html = await c.env.ASSETS!.fetch(new URL('/index.html', c.req.url))
    if (html.status === 200) {
      return new Response(html.body, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    }
  } catch (e) {
    // fallback below
  }
  return c.html(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>نظام المدرسة الذكي</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <script type="module" crossorigin src="/assets/main-Bq_OpL6C.js"></script>
  <link rel="stylesheet" crossorigin href="/assets/main-X0FolEOP.css">
</head>
<body>
  <div id="root"></div>
</body>
</html>`)
})

// ===========================================
// Phase 8: Treasury, Income & Expenses
// ===========================================

// GET /api/treasury/summary
// ===========================================
app.get('/api/treasury/summary', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canAccessTreasury(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الخزنة' }, 403);
  }

  try {
    const query = c.req.query();
    const schoolIdParam = query.school_id ? parseInt(query.school_id, 10) : null;
    const targetSchoolId = (scope === 'single' && resolvedSchoolId) ? resolvedSchoolId : schoolIdParam;

    if (!targetSchoolId) {
      return c.json({ error: 'معرف المدرسة مطلوب' }, 400);
    }

    // Source-of-truth balance calculation from active transactions
    const balanceRow = await db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN transaction_type = 'income' AND status = 'active' THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN transaction_type = 'expense' AND status = 'active' THEN amount ELSE 0 END), 0)
      AS verified_balance
      FROM treasury_transactions WHERE school_id = ?
    `).bind(targetSchoolId).first<{ verified_balance: number }>();

    const verifiedBalance = balanceRow?.verified_balance || 0;

    // Today's income & expense
    const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const todayEnd = todayStart + 86400;

    const todayRow = await db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN transaction_type = 'income' AND status = 'active' THEN amount ELSE 0 END), 0) AS today_income,
        COALESCE(SUM(CASE WHEN transaction_type = 'expense' AND status = 'active' THEN amount ELSE 0 END), 0) AS today_expense,
        COUNT(CASE WHEN status = 'active' THEN 1 END) AS today_count
      FROM treasury_transactions
      WHERE school_id = ? AND created_at >= ? AND created_at < ?
    `).bind(targetSchoolId, todayStart, todayEnd).first<any>();

    // Cached balance (may differ, used for quick display)
    const cachedRow = await db.prepare(`SELECT current_balance FROM treasury_accounts WHERE school_id = ?`).bind(targetSchoolId).first<{ current_balance: number }>();

    // Pending fees count for quick reference
    const pendingFees = await db.prepare(`SELECT COUNT(*) as count FROM student_fees WHERE school_id = ? AND status IN ('pending','partial')`).bind(targetSchoolId).first<{ count: number }>();

    return c.json({
      data: {
        school_id: targetSchoolId,
        verified_balance: verifiedBalance,
        cached_balance: cachedRow?.current_balance || 0,
        balance_sync: verifiedBalance === (cachedRow?.current_balance || 0),
        today_income: todayRow?.today_income || 0,
        today_expense: todayRow?.today_expense || 0,
        today_net: (todayRow?.today_income || 0) - (todayRow?.today_expense || 0),
        today_transaction_count: todayRow?.today_count || 0,
        pending_fees_count: pendingFees?.count || 0,
      }
    });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب ملخص الخزنة', detail: err.message }, 500);
  }
});

// GET /api/treasury/transactions
// ===========================================
app.get('/api/treasury/transactions', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canAccessTreasury(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الخزنة' }, 403);
  }

  try {
    const query = c.req.query();
    const schoolIdParam = query.school_id ? parseInt(query.school_id, 10) : null;
    const targetSchoolId = (scope === 'single' && resolvedSchoolId) ? resolvedSchoolId : schoolIdParam;
    const type = query.type || null;
    const category = query.category || null;
    const status = query.status || null;
    const dateFrom = query.date_from ? parseInt(query.date_from, 10) : null;
    const dateTo = query.date_to ? parseInt(query.date_to, 10) : null;
    const limit = Math.min(parseInt(query.limit || '50', 10), 200);
    const offset = parseInt(query.offset || '0', 10);

    let sql = `SELECT t.*, u.full_name as created_by_name FROM treasury_transactions t LEFT JOIN users u ON t.created_by = u.id WHERE 1=1`;
    const params: any[] = [];

    if (targetSchoolId) { sql += ` AND t.school_id = ?`; params.push(targetSchoolId); }
    if (type) { sql += ` AND t.transaction_type = ?`; params.push(type); }
    if (category) { sql += ` AND t.category = ?`; params.push(category); }
    if (status) { sql += ` AND t.status = ?`; params.push(status); }
    if (dateFrom) { sql += ` AND t.created_at >= ?`; params.push(dateFrom); }
    if (dateTo) { sql += ` AND t.created_at < ?`; params.push(dateTo); }

    sql += ` ORDER BY t.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = await db.prepare(sql).bind(...params).all<any>();

    // Get total count for pagination
    let countSql = `SELECT COUNT(*) as total FROM treasury_transactions t WHERE 1=1`;
    const countParams: any[] = [];
    if (targetSchoolId) { countSql += ` AND t.school_id = ?`; countParams.push(targetSchoolId); }
    if (type) { countSql += ` AND t.transaction_type = ?`; countParams.push(type); }
    if (category) { countSql += ` AND t.category = ?`; countParams.push(category); }
    if (status) { countSql += ` AND t.status = ?`; countParams.push(status); }
    if (dateFrom) { countSql += ` AND t.created_at >= ?`; countParams.push(dateFrom); }
    if (dateTo) { countSql += ` AND t.created_at < ?`; countParams.push(dateTo); }

    const countRow = await db.prepare(countSql).bind(...countParams).first<{ total: number }>();

    return c.json({ data: rows.results || [], meta: { total: countRow?.total || 0, limit, offset } });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب القيود المالية', detail: err.message }, 500);
  }
});

// POST /api/treasury/transactions
// ===========================================
app.post('/api/treasury/transactions', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canManageTreasury(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الخزنة' }, 403);
  }

  try {
    const body = await c.req.json();
    let { school_id, transaction_type, category, amount, currency, description } = body;
    const targetSchool = await resolveActiveWriteSchool(db, user, school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    school_id = targetSchool.schoolId;

    if (!school_id || !transaction_type || !category || amount === undefined || amount === null || amount === '') {
      return c.json({ error: 'المدرسة ونوع القيد والتصنيف والمبلغ مطلوبة' }, 400);
    }

    if (!['income', 'expense'].includes(transaction_type)) {
      return c.json({ error: 'نوع القيد يجب أن يكون وارد أو مصروف' }, 400);
    }

    const amountNum = parseInt(amount, 10);
    if (isNaN(amountNum) || amountNum <= 0) {
      return c.json({ error: 'المبلغ يجب أن يكون عدداً صحيحاً أكبر من صفر' }, 400);
    }

    // Validate category exists
    const catRow = await db.prepare(`SELECT name FROM treasury_categories WHERE name = ?`).bind(category).first<any>();
    if (!catRow) {
      return c.json({ error: 'التصنيف غير موجود' }, 400);
    }

    const result = await db.prepare(`
      INSERT INTO treasury_transactions
      (school_id, transaction_type, category, amount, currency, description,
       source_type, source_id, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'manual', NULL, 'active', ?, unixepoch())
    `).bind(school_id, transaction_type, category, amountNum, currency || 'IQD', description || null, user.id).run();

    // Update cached balance
    const balanceDelta = transaction_type === 'income' ? amountNum : -amountNum;
    await db.prepare(`
      INSERT INTO treasury_accounts (school_id, current_balance, updated_at)
      VALUES (?, ?, unixepoch())
      ON CONFLICT(school_id) DO UPDATE SET
        current_balance = treasury_accounts.current_balance + excluded.current_balance,
        updated_at = unixepoch()
    `).bind(school_id, balanceDelta).run();

    return c.json({ data: { id: result.meta.last_row_id, transaction_type, amount: amountNum, status: 'active' } }, 201);
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء القيد المالي', detail: err.message }, 500);
  }
});

// PUT /api/treasury/transactions/:id/cancel
// ===========================================
app.put('/api/treasury/transactions/:id/cancel', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canManageTreasury(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الخزنة' }, 403);
  }

  try {
    const id = parseInt(c.req.param('id'), 10);
    const body = await c.req.json();
    const { cancel_reason } = body;
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);

    const tx = await db.prepare(`SELECT * FROM treasury_transactions WHERE id = ?`).bind(id).first<any>();
    if (!tx) return c.json({ error: 'القيد المالي غير موجود' }, 404);

    if (tx.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: القيد لا ينتمي إلى مدرستك' }, 403);
    }

    if (tx.status === 'cancelled') {
      return c.json({ error: 'القيد المالي ملغى مسبقاً' }, 400);
    }

    // Cannot cancel fee_payment linked transactions from here (must cancel the fee payment itself)
    if (tx.source_type === 'fee_payment') {
      return c.json({ error: 'لا يمكن إلغاء قيد مرتبط بدفعة طالب من هنا. استخدم إلغاء الدفعة.' }, 400);
    }

    if (!cancel_reason || typeof cancel_reason !== 'string' || cancel_reason.trim().length === 0) {
      return c.json({ error: 'سبب الإلغاء مطلوب' }, 400);
    }

    await db.prepare(`
      UPDATE treasury_transactions
      SET status = 'cancelled', cancelled_at = unixepoch(), cancelled_by = ?, cancel_reason = ?, updated_at = unixepoch()
      WHERE id = ? AND school_id = ?
    `).bind(user.id, cancel_reason.trim(), id, targetSchool.schoolId).run();

    // Reverse cached balance
    const reverseDelta = tx.transaction_type === 'income' ? -tx.amount : tx.amount;
    await db.prepare(`
      INSERT INTO treasury_accounts (school_id, current_balance, updated_at)
      VALUES (?, ?, unixepoch())
      ON CONFLICT(school_id) DO UPDATE SET
        current_balance = treasury_accounts.current_balance + excluded.current_balance,
        updated_at = unixepoch()
    `).bind(tx.school_id, reverseDelta).run();

    return c.json({ data: { id, status: 'cancelled', cancel_reason } });
  } catch (err: any) {
    return c.json({ error: 'فشل في إلغاء القيد المالي', detail: err.message }, 500);
  }
});

// GET /api/treasury/daily-closings
// ===========================================
app.get('/api/treasury/daily-closings', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canAccessTreasury(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الخزنة' }, 403);
  }

  try {
    const query = c.req.query();
    const schoolIdParam = query.school_id ? parseInt(query.school_id, 10) : null;
    const targetSchoolId = (scope === 'single' && resolvedSchoolId) ? resolvedSchoolId : schoolIdParam;
    const limit = Math.min(parseInt(query.limit || '50', 10), 200);
    const offset = parseInt(query.offset || '0', 10);

    if (!targetSchoolId) {
      return c.json({ error: 'معرف المدرسة مطلوب' }, 400);
    }

    const rows = await db.prepare(`
      SELECT c.*, u.full_name as closed_by_name
      FROM treasury_closings c
      LEFT JOIN users u ON c.closed_by = u.id
      WHERE c.school_id = ?
      ORDER BY c.closing_date DESC
      LIMIT ? OFFSET ?
    `).bind(targetSchoolId, limit, offset).all<any>();

    const countRow = await db.prepare(`SELECT COUNT(*) as total FROM treasury_closings WHERE school_id = ?`).bind(targetSchoolId).first<{ total: number }>();

    return c.json({ data: rows.results || [], meta: { total: countRow?.total || 0, limit, offset } });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب سجل الإقفالات', detail: err.message }, 500);
  }
});

// POST /api/treasury/daily-closings/close-day
// ===========================================
app.post('/api/treasury/daily-closings/close-day', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canManageTreasury(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الخزنة' }, 403);
  }

  try {
    const body = await c.req.json();
    let { school_id, closing_date, notes } = body;
    const targetSchool = await resolveActiveWriteSchool(db, user, school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    school_id = targetSchool.schoolId;

    if (!school_id || !closing_date) {
      return c.json({ error: 'المدرسة وتاريخ الإقفال مطلوبان' }, 400);
    }

    // Validate date format YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closing_date)) {
      return c.json({ error: 'تاريخ الإقفال يجب أن يكون بالصيغة YYYY-MM-DD' }, 400);
    }

    // Check if already closed
    const existing = await db.prepare(`SELECT id FROM treasury_closings WHERE school_id = ? AND closing_date = ?`).bind(school_id, closing_date).first<any>();
    if (existing) {
      return c.json({ error: 'تم إقفال هذا اليوم مسبقاً' }, 409);
    }

    // Parse date boundaries
    const dateObj = new Date(closing_date + 'T00:00:00');
    const dayStart = Math.floor(dateObj.getTime() / 1000);
    const dayEnd = dayStart + 86400;

    // Calculate opening balance from last closing
    const lastClosing = await db.prepare(`
      SELECT closing_balance FROM treasury_closings
      WHERE school_id = ? AND closing_date < ?
      ORDER BY closing_date DESC LIMIT 1
    `).bind(school_id, closing_date).first<{ closing_balance: number }>();
    const openingBalance = lastClosing?.closing_balance || 0;

    // Calculate day's transactions
    const dayStats = await db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN transaction_type = 'income' AND status = 'active' THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN transaction_type = 'expense' AND status = 'active' THEN amount ELSE 0 END), 0) AS total_expense,
        COUNT(CASE WHEN status = 'active' THEN 1 END) AS transaction_count
      FROM treasury_transactions
      WHERE school_id = ? AND created_at >= ? AND created_at < ?
    `).bind(school_id, dayStart, dayEnd).first<any>();

    const totalIncome = dayStats?.total_income || 0;
    const totalExpense = dayStats?.total_expense || 0;
    const closingBalance = openingBalance + totalIncome - totalExpense;
    const txCount = dayStats?.transaction_count || 0;

    const result = await db.prepare(`
      INSERT INTO treasury_closings
      (school_id, closing_date, opening_balance, total_income, total_expense, closing_balance, transaction_count, notes, closed_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).bind(school_id, closing_date, openingBalance, totalIncome, totalExpense, closingBalance, txCount, notes || null, user.id).run();

    // Update cached last_closing info
    await db.prepare(`
      INSERT INTO treasury_accounts (school_id, current_balance, last_closing_balance, last_closing_date, updated_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(school_id) DO UPDATE SET
        last_closing_balance = excluded.last_closing_balance,
        last_closing_date = excluded.last_closing_date,
        updated_at = unixepoch()
    `).bind(school_id, closingBalance, closingBalance, dayStart).run();

    return c.json({ data: {
      id: result.meta.last_row_id,
      school_id,
      closing_date,
      opening_balance: openingBalance,
      total_income: totalIncome,
      total_expense: totalExpense,
      closing_balance: closingBalance,
      transaction_count: txCount,
    }}, 201);
  } catch (err: any) {
    return c.json({ error: 'فشل في إقفال اليوم المالي', detail: err.message }, 500);
  }
});

// GET /api/treasury/reports/daily
// ===========================================
app.get('/api/treasury/reports/daily', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canAccessTreasury(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الخزنة' }, 403);
  }

  try {
    const query = c.req.query();
    const schoolIdParam = query.school_id ? parseInt(query.school_id, 10) : null;
    const targetSchoolId = (scope === 'single' && resolvedSchoolId) ? resolvedSchoolId : schoolIdParam;
    const date = query.date || new Date().toISOString().split('T')[0];

    if (!targetSchoolId) {
      return c.json({ error: 'معرف المدرسة مطلوب' }, 400);
    }

    const dateObj = new Date(date + 'T00:00:00');
    const dayStart = Math.floor(dateObj.getTime() / 1000);
    const dayEnd = dayStart + 86400;

    // Summary
    const summary = await db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN transaction_type = 'income' AND status = 'active' THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN transaction_type = 'expense' AND status = 'active' THEN amount ELSE 0 END), 0) AS total_expense,
        COUNT(CASE WHEN status = 'active' THEN 1 END) AS transaction_count
      FROM treasury_transactions
      WHERE school_id = ? AND created_at >= ? AND created_at < ?
    `).bind(targetSchoolId, dayStart, dayEnd).first<any>();

    // By category
    const byCategory = await db.prepare(`
      SELECT category, transaction_type, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
      FROM treasury_transactions
      WHERE school_id = ? AND created_at >= ? AND created_at < ? AND status = 'active'
      GROUP BY category, transaction_type
      ORDER BY transaction_type, total DESC
    `).bind(targetSchoolId, dayStart, dayEnd).all<any>();

    // Transactions list
    const transactions = await db.prepare(`
      SELECT t.*, u.full_name as created_by_name
      FROM treasury_transactions t
      LEFT JOIN users u ON t.created_by = u.id
      WHERE t.school_id = ? AND t.created_at >= ? AND t.created_at < ?
      ORDER BY t.created_at DESC
    `).bind(targetSchoolId, dayStart, dayEnd).all<any>();

    return c.json({ data: {
      date,
      school_id: targetSchoolId,
      summary: {
        total_income: summary?.total_income || 0,
        total_expense: summary?.total_expense || 0,
        net: (summary?.total_income || 0) - (summary?.total_expense || 0),
        transaction_count: summary?.transaction_count || 0,
      },
      by_category: byCategory.results || [],
      transactions: transactions.results || [],
    }});
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب التقرير اليومي', detail: err.message }, 500);
  }
});

// GET /api/treasury/reports/monthly
// ===========================================
app.get('/api/treasury/reports/monthly', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canAccessTreasury(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الخزنة' }, 403);
  }

  try {
    const query = c.req.query();
    const schoolIdParam = query.school_id ? parseInt(query.school_id, 10) : null;
    const targetSchoolId = (scope === 'single' && resolvedSchoolId) ? resolvedSchoolId : schoolIdParam;
    const year = parseInt(query.year || new Date().getFullYear().toString(), 10);
    const month = parseInt(query.month || (new Date().getMonth() + 1).toString(), 10);

    if (!targetSchoolId) {
      return c.json({ error: 'معرف المدرسة مطلوب' }, 400);
    }

    // Calculate month boundaries
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1);
    const startTs = Math.floor(monthStart.getTime() / 1000);
    const endTs = Math.floor(monthEnd.getTime() / 1000);

    // Daily breakdown
    const dailyBreakdown = await db.prepare(`
      SELECT 
        DATE(datetime(created_at, 'unixepoch')) as day,
        COALESCE(SUM(CASE WHEN transaction_type = 'income' AND status = 'active' THEN amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN transaction_type = 'expense' AND status = 'active' THEN amount ELSE 0 END), 0) AS expense,
        COUNT(CASE WHEN status = 'active' THEN 1 END) AS count
      FROM treasury_transactions
      WHERE school_id = ? AND created_at >= ? AND created_at < ?
      GROUP BY day
      ORDER BY day
    `).bind(targetSchoolId, startTs, endTs).all<any>();

    // Category summary
    const categorySummary = await db.prepare(`
      SELECT category, transaction_type, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
      FROM treasury_transactions
      WHERE school_id = ? AND created_at >= ? AND created_at < ? AND status = 'active'
      GROUP BY category, transaction_type
      ORDER BY transaction_type, total DESC
    `).bind(targetSchoolId, startTs, endTs).all<any>();

    // Monthly totals
    const totals = await db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN transaction_type = 'income' AND status = 'active' THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN transaction_type = 'expense' AND status = 'active' THEN amount ELSE 0 END), 0) AS total_expense,
        COUNT(CASE WHEN status = 'active' THEN 1 END) AS transaction_count
      FROM treasury_transactions
      WHERE school_id = ? AND created_at >= ? AND created_at < ?
    `).bind(targetSchoolId, startTs, endTs).first<any>();

    return c.json({ data: {
      year,
      month,
      school_id: targetSchoolId,
      summary: {
        total_income: totals?.total_income || 0,
        total_expense: totals?.total_expense || 0,
        net: (totals?.total_income || 0) - (totals?.total_expense || 0),
        transaction_count: totals?.transaction_count || 0,
      },
      daily_breakdown: dailyBreakdown.results || [],
      category_summary: categorySummary.results || [],
    }});
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب التقرير الشهري', detail: err.message }, 500);
  }
});

// GET /api/treasury/categories
// ===========================================
app.get('/api/treasury/categories', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;

  if (!user || !canAccessTreasury(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الخزنة' }, 403);
  }

  try {
    const query = c.req.query();
    const type = query.type || null;

    let sql = `SELECT * FROM treasury_categories WHERE 1=1`;
    const params: any[] = [];

    if (type) { sql += ` AND type = ?`; params.push(type); }
    sql += ` ORDER BY type, name`;

    const rows = await db.prepare(sql).bind(...params).all<any>();
    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب التصنيفات', detail: err.message }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// PHASE 11: SETTINGS MODULE
// ═══════════════════════════════════════════════════════════════

function withResultCardDisplaySettings<T extends Record<string, any>>(row: T): T & {
  result_card_display_settings: ResultCardDisplaySettings;
} {
  const { result_card_display_settings_json: _storedDisplaySettings, ...settings } = row;
  return {
    ...settings,
    result_card_display_settings: parseResultCardDisplaySettings(
      row.result_card_display_settings_json,
    ),
  } as T & { result_card_display_settings: ResultCardDisplaySettings };
}

// ===========================================
// GET /api/settings/school
// Returns: school profile + document settings + system settings merged
// ===========================================
app.get('/api/settings/school', requireSameSchoolOrAdmin(), requireRoles(SETTINGS_VIEW_ROLES), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const targetSchoolId = c.get('resolvedSchoolId') as number;

  if (!targetSchoolId) {
    return c.json({ error: 'معرف المدرسة مطلوب' }, 400);
  }

  try {
    // Fetch school profile
    const school = await db.prepare(`
      SELECT id, name, name_en, school_type, city, province, address, phone, email, website, principal_name, logo_url, official_stamp_url, status, created_at, updated_at
      FROM schools WHERE id = ?
    `).bind(targetSchoolId).first<any>();

    if (!school) {
      return c.json({ error: 'المدرسة غير موجودة' }, 404);
    }

    // Fetch school_settings (document + system preferences)
    let settings = await db.prepare(`
      SELECT school_id, result_card_header_text, result_card_footer_text, receipt_footer_text, official_book_header_text, official_book_footer_text, verification_note_text,
             result_card_display_settings_json,
             use_school_logo_on_docs, use_school_stamp_on_docs, default_print_size, default_receipt_size,
             use_arabic_indic_digits, currency_label, date_format, created_at, updated_at
      FROM school_settings WHERE school_id = ?
    `).bind(targetSchoolId).first<any>();

    // Auto-create default settings row if missing
    if (!settings) {
      await db.prepare(`
        INSERT OR IGNORE INTO school_settings
        (school_id, use_school_logo_on_docs, use_school_stamp_on_docs, default_print_size, default_receipt_size, use_arabic_indic_digits, currency_label, date_format)
        VALUES (?, 1, 0, 'A4', 'A5', 1, 'د.ع', 'dd/MM/yyyy')
      `).bind(targetSchoolId).run();
      settings = await db.prepare(`
        SELECT school_id, result_card_header_text, result_card_footer_text, receipt_footer_text, official_book_header_text, official_book_footer_text, verification_note_text,
               result_card_display_settings_json,
               use_school_logo_on_docs, use_school_stamp_on_docs, default_print_size, default_receipt_size,
               use_arabic_indic_digits, currency_label, date_format, created_at, updated_at
        FROM school_settings WHERE school_id = ?
      `).bind(targetSchoolId).first<any>();
    }

    return c.json({
      data: {
        school,
        settings: settings ? withResultCardDisplaySettings(settings) : settings,
      },
    });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب إعدادات المدرسة', detail: err.message }, 500);
  }
});

// ===========================================
// PUT /api/settings/school
// Updates: school profile fields only (safe fields)
// ===========================================
app.put('/api/settings/school', requireSameSchoolOrAdmin(), requireRoles(SETTINGS_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;

  try {
    const body = await c.req.json();
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const targetSchoolId = targetSchool.schoolId;
    const allowedFields = ['name', 'name_en', 'school_type', 'city', 'province', 'address', 'phone', 'email', 'website', 'principal_name', 'logo_url', 'official_stamp_url'];
    const updates: string[] = [];
    const params: any[] = [];

    for (const key of allowedFields) {
      if (body[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(body[key]);
      }
    }

    if (updates.length === 0) {
      return c.json({ error: 'لا توجد بيانات للتحديث' }, 400);
    }

    updates.push(`updated_at = unixepoch()`);
    params.push(targetSchoolId);
    const sql = `UPDATE schools SET ${updates.join(', ')} WHERE id = ?`;
    await db.prepare(sql).bind(...params).run();

    return c.json({ data: { message: 'تم تحديث بيانات المدرسة بنجاح' } });
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث بيانات المدرسة', detail: err.message }, 500);
  }
});

// ===========================================
// GET /api/settings/document
// Returns: document/print preferences only
// ===========================================
app.get('/api/settings/document', requireSameSchoolOrAdmin(), requireRoles(SETTINGS_VIEW_ROLES), async (c) => {
  const db = c.env.DB;
  const targetSchoolId = c.get('resolvedSchoolId') as number;

  if (!targetSchoolId) {
    return c.json({ error: 'معرف المدرسة مطلوب' }, 400);
  }

  try {
    let row = await db.prepare(`
      SELECT result_card_header_text, result_card_footer_text, receipt_footer_text, official_book_header_text, official_book_footer_text, verification_note_text,
             result_card_display_settings_json,
             use_school_logo_on_docs, use_school_stamp_on_docs, default_print_size, default_receipt_size, updated_at
      FROM school_settings WHERE school_id = ?
    `).bind(targetSchoolId).first<any>();

    if (!row) {
      // Return defaults
      return c.json({ data: {
        result_card_header_text: null,
        result_card_footer_text: null,
        receipt_footer_text: null,
        official_book_header_text: null,
        official_book_footer_text: null,
        verification_note_text: null,
        result_card_display_settings: normalizeResultCardDisplaySettings(null),
        use_school_logo_on_docs: 1,
        use_school_stamp_on_docs: 0,
        default_print_size: 'A4',
        default_receipt_size: 'A5',
      }});
    }

    return c.json({ data: withResultCardDisplaySettings(row) });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب إعدادات الوثائق', detail: err.message }, 500);
  }
});

// ===========================================
// PUT /api/settings/document
// Updates: document/print preferences
// ===========================================
app.put('/api/settings/document', requireSameSchoolOrAdmin(), requireRoles(SETTINGS_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;

  try {
    const body = await c.req.json();
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const targetSchoolId = targetSchool.schoolId;
    const displaySettingsError = validateResultCardDisplaySettings(
      body.result_card_display_settings,
    );
    if (displaySettingsError) return c.json({ error: displaySettingsError }, 400);

    // Ensure row exists
    const existing = await db.prepare(`SELECT id FROM school_settings WHERE school_id = ?`).bind(targetSchoolId).first<any>();
    if (!existing) {
      await db.prepare(`
        INSERT OR IGNORE INTO school_settings
        (school_id, use_school_logo_on_docs, use_school_stamp_on_docs, default_print_size, default_receipt_size, use_arabic_indic_digits, currency_label, date_format)
        VALUES (?, 1, 0, 'A4', 'A5', 1, 'د.ع', 'dd/MM/yyyy')
      `).bind(targetSchoolId).run();
    }

    const allowedFields = ['result_card_header_text', 'result_card_footer_text', 'receipt_footer_text', 'official_book_header_text', 'official_book_footer_text', 'verification_note_text',
      'use_school_logo_on_docs', 'use_school_stamp_on_docs', 'default_print_size', 'default_receipt_size'];
    const updates: string[] = [];
    const params: any[] = [];

    for (const key of allowedFields) {
      if (body[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(body[key]);
      }
    }
    if (body.result_card_display_settings !== undefined) {
      updates.push('result_card_display_settings_json = ?');
      params.push(JSON.stringify(normalizeResultCardDisplaySettings(
        body.result_card_display_settings,
      )));
    }

    // Always update updated_at explicitly (no trigger)
    updates.push('updated_at = unixepoch()');

    if (updates.length === 1) {
      return c.json({ error: 'لا توجد بيانات للتحديث' }, 400);
    }

    params.push(targetSchoolId);
    const sql = `UPDATE school_settings SET ${updates.join(', ')} WHERE school_id = ?`;
    await db.prepare(sql).bind(...params).run();

    return c.json({ data: { message: 'تم تحديث إعدادات الوثائق بنجاح' } });
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث إعدادات الوثائق', detail: err.message }, 500);
  }
});

// ===========================================
// GET /api/settings/system
// Returns: localization preferences only
// ===========================================
app.get('/api/settings/system', requireSameSchoolOrAdmin(), requireRoles(SETTINGS_VIEW_ROLES), async (c) => {
  const db = c.env.DB;
  const targetSchoolId = c.get('resolvedSchoolId') as number;

  if (!targetSchoolId) {
    return c.json({ error: 'معرف المدرسة مطلوب' }, 400);
  }

  try {
    let row = await db.prepare(`
      SELECT use_arabic_indic_digits, currency_label, date_format, updated_at
      FROM school_settings WHERE school_id = ?
    `).bind(targetSchoolId).first<any>();

    if (!row) {
      return c.json({ data: {
        use_arabic_indic_digits: 1,
        currency_label: 'د.ع',
        date_format: 'dd/MM/yyyy',
      }});
    }

    return c.json({ data: row });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب إعدادات النظام', detail: err.message }, 500);
  }
});

// ===========================================
// PUT /api/settings/system
// Updates: localization preferences
// ===========================================
app.put('/api/settings/system', requireSameSchoolOrAdmin(), requireRoles(SETTINGS_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;

  try {
    const body = await c.req.json();
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const targetSchoolId = targetSchool.schoolId;

    // Ensure row exists
    const existing = await db.prepare(`SELECT id FROM school_settings WHERE school_id = ?`).bind(targetSchoolId).first<any>();
    if (!existing) {
      await db.prepare(`
        INSERT OR IGNORE INTO school_settings
        (school_id, use_school_logo_on_docs, use_school_stamp_on_docs, default_print_size, default_receipt_size, use_arabic_indic_digits, currency_label, date_format)
        VALUES (?, 1, 0, 'A4', 'A5', 1, 'د.ع', 'dd/MM/yyyy')
      `).bind(targetSchoolId).run();
    }

    const allowedFields = ['use_arabic_indic_digits', 'currency_label', 'date_format'];
    const updates: string[] = [];
    const params: any[] = [];

    for (const key of allowedFields) {
      if (body[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(body[key]);
      }
    }

    updates.push('updated_at = unixepoch()');

    if (updates.length === 1) {
      return c.json({ error: 'لا توجد بيانات للتحديث' }, 400);
    }

    params.push(targetSchoolId);
    const sql = `UPDATE school_settings SET ${updates.join(', ')} WHERE school_id = ?`;
    await db.prepare(sql).bind(...params).run();

    return c.json({ data: { message: 'تم تحديث إعدادات النظام بنجاح' } });
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث إعدادات النظام', detail: err.message }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// PHASE 12: OFFICIAL BOOKS MODULE
// ═══════════════════════════════════════════════════════════════

// ===========================================
// GET /api/official-book-templates
// ===========================================
app.get('/api/official-book-templates', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  try {
    let sql = `SELECT obt.id, obt.school_id, obt.title, obt.body_text, obt.paper_size, obt.requires_student, obt.requires_employee, obt.status, obt.created_by_user_id, obt.created_at, obt.updated_at, u.full_name as created_by_name FROM official_book_templates obt LEFT JOIN users u ON obt.created_by_user_id = u.id AND (u.school_id = obt.school_id OR u.school_id IS NULL) WHERE 1=1`;
    const params: any[] = [];

    if (scope === 'single' && resolvedSchoolId) {
      sql += ` AND obt.school_id = ?`;
      params.push(resolvedSchoolId);
    }

    sql += ` ORDER BY obt.created_at DESC`;
    const rows = await db.prepare(sql).bind(...params).all<any>();
    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب قوالب الكتب الرسمية', detail: err.message }, 500);
  }
});

// ===========================================
// POST /api/official-book-templates
// ===========================================
app.post('/api/official-book-templates', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canManageOfficialBookTemplates(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة قوالب الكتب الرسمية' }, 403);
  }

  try {
    const body = await c.req.json();
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const schoolId = targetSchool.schoolId;
    if (!body.title || !body.body_text) {
      return c.json({ error: 'العنوان ونص الكتاب مطلوبان' }, 400);
    }

    const paperSize = body.paper_size || 'A4';
    const result = await db.prepare(`
      INSERT INTO official_book_templates (school_id, title, body_text, paper_size, requires_student, requires_employee, status, created_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
    `).bind(schoolId, body.title, body.body_text, paperSize, body.requires_student ? 1 : 0, body.requires_employee ? 1 : 0, user.id).run();

    const id = result.meta?.last_row_id;
    return c.json({ data: { id, message: 'تم إنشاء القالب بنجاح' } }, 201);
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء القالب', detail: err.message }, 500);
  }
});

// ===========================================
// PUT /api/official-book-templates/:id
// ===========================================
app.put('/api/official-book-templates/:id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canManageOfficialBookTemplates(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة قوالب الكتب الرسمية' }, 403);
  }

  try {
    const id = parseInt(c.req.param('id'), 10);
    const body = await c.req.json();
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const template = await db.prepare(
      'SELECT school_id FROM official_book_templates WHERE id = ?',
    ).bind(id).first<{ school_id: number }>();
    if (!template) {
      return c.json({ error: 'القالب غير موجود' }, 404);
    }
    if (template.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: القالب تابع لمدرسة أخرى' }, 403);
    }
    const allowed = ['title', 'body_text', 'paper_size', 'requires_student', 'requires_employee', 'status'];
    const updates: string[] = [];
    const params: any[] = [];

    for (const key of allowed) {
      if (body[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(body[key]);
      }
    }
    if (updates.length === 0) {
      return c.json({ error: 'لا توجد بيانات للتحديث' }, 400);
    }
    updates.push('updated_at = unixepoch()');
    params.push(id, targetSchool.schoolId);

    await db.prepare(`UPDATE official_book_templates SET ${updates.join(', ')} WHERE id = ? AND school_id = ?`).bind(...params).run();
    return c.json({ data: { message: 'تم تحديث القالب بنجاح' } });
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث القالب', detail: err.message }, 500);
  }
});

// ===========================================
// GET /api/official-books
// ===========================================
app.get('/api/official-books', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canViewOfficialBooks(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية عرض الكتب الرسمية' }, 403);
  }

  try {
    let sql = `SELECT ob.id, ob.school_id, ob.template_id, ob.document_number, ob.title, ob.body_text, ob.paper_size, ob.student_id, ob.employee_id, ob.status, ob.created_by_user_id, ob.created_at, ob.updated_at, obt.title as template_title, st.full_name as student_name, emp.full_name as employee_name, u.full_name as created_by_name FROM official_books ob LEFT JOIN official_book_templates obt ON ob.template_id = obt.id AND obt.school_id = ob.school_id LEFT JOIN students st ON ob.student_id = st.id AND st.school_id = ob.school_id LEFT JOIN employees emp ON ob.employee_id = emp.id AND emp.school_id = ob.school_id LEFT JOIN users u ON ob.created_by_user_id = u.id AND (u.school_id = ob.school_id OR u.school_id IS NULL) WHERE 1=1`;
    const params: any[] = [];

    if (scope === 'single' && resolvedSchoolId) {
      sql += ` AND ob.school_id = ?`;
      params.push(resolvedSchoolId);
    }
    if (user.role_key === 'teacher') {
      sql += ` AND ob.student_id IS NOT NULL`;
    }

    sql += ` ORDER BY ob.created_at DESC`;
    const rows = await db.prepare(sql).bind(...params).all<any>();
    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الكتب الرسمية', detail: err.message }, 500);
  }
});

// ===========================================
// GET /api/official-books/:id
// Single official book with RBAC and same-school enforcement
// ===========================================
app.get('/api/official-books/:id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = parseInt(c.req.param('id'), 10);

  if (!user || !canViewOfficialBooks(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية عرض الكتب الرسمية' }, 403);
  }

  try {
    const row = await db.prepare(`
      SELECT ob.id, ob.school_id, ob.template_id, ob.document_number, ob.title, ob.body_text, ob.paper_size, ob.student_id, ob.employee_id, ob.status, ob.created_by_user_id, ob.created_at, ob.updated_at, ob.school_name_snapshot, ob.principal_name_snapshot, ob.logo_url_snapshot, ob.stamp_url_snapshot, ob.use_logo_snapshot, ob.use_stamp_snapshot, ob.header_text_snapshot, ob.footer_text_snapshot, ob.verification_note_snapshot, ob.date_format_snapshot, ob.use_arabic_indic_digits_snapshot, ob.settings_snapshot_json, ob.verification_token, obt.title as template_title, st.full_name as student_name, emp.full_name as employee_name, u.full_name as created_by_name
      FROM official_books ob
      LEFT JOIN official_book_templates obt ON ob.template_id = obt.id AND obt.school_id = ob.school_id
      LEFT JOIN students st ON ob.student_id = st.id AND st.school_id = ob.school_id
      LEFT JOIN employees emp ON ob.employee_id = emp.id AND emp.school_id = ob.school_id
      LEFT JOIN users u ON ob.created_by_user_id = u.id AND (u.school_id = ob.school_id OR u.school_id IS NULL)
      WHERE ob.id = ?
    `).bind(id).first<any>();

    if (!row) {
      return c.json({ error: 'الكتاب الرسمي غير موجود' }, 404);
    }

    if (scope === 'single' && resolvedSchoolId && row.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح' }, 403);
    }

    if (user.role_key === 'teacher' && row.student_id === null) {
      return c.json({ error: 'غير مسموح: المعلم يمكنه فقط الوصول إلى الكتب المرتبطة بالطلاب' }, 403);
    }

    if (['accountant', 'parent'].includes(user.role_key)) {
      return c.json({ error: 'غير مسموح: لا تملك صلاحية عرض الكتب الرسمية' }, 403);
    }

    let data = row;
    try {
      data = { ...row, settings_snapshot: JSON.parse(row.settings_snapshot_json || '{}') };
    } catch { /* leave as-is */ }

    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الكتاب الرسمي', detail: err.message }, 500);
  }
});

// ===========================================
// POST /api/official-books
// Generate official book with snapshot + two-step numbering
// ===========================================
app.post('/api/official-books', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canManageOfficialBooks(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الكتب الرسمية' }, 403);
  }

  try {
    const body = await c.req.json();
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const schoolId = targetSchool.schoolId;
    const templateId = Number(body.template_id);
    const studentId = body.student_id ? Number(body.student_id) : null;
    const employeeId = body.employee_id ? Number(body.employee_id) : null;

    if (!templateId) {
      return c.json({ error: 'معرف المدرسة والقالب مطلوبان' }, 400);
    }

    const school = await db.prepare(`
      SELECT name, principal_name, logo_url, official_stamp_url
      FROM schools
      WHERE id = ?
    `).bind(schoolId).first<any>();
    if (!school) {
      return c.json({ error: 'المدرسة غير موجودة' }, 404);
    }

    // Fetch by ID first so a cross-school reference is distinguishable from a missing template.
    const template = await db.prepare(
      `SELECT * FROM official_book_templates WHERE id = ?`,
    ).bind(templateId).first<any>();
    if (!template) {
      return c.json({ error: 'القالب غير موجود' }, 404);
    }
    if (template.school_id !== schoolId) {
      return c.json({ error: 'غير مسموح: القالب تابع لمدرسة أخرى' }, 403);
    }
    if (template.status !== 'active') {
      return c.json({ error: 'القالب غير فعال' }, 400);
    }

    // Validate required entities
    if (template.requires_student && !studentId) {
      return c.json({ error: 'هذا القالب يتطلب اختيار طالب' }, 400);
    }
    if (template.requires_employee && !employeeId) {
      return c.json({ error: 'هذا القالب يتطلب اختيار موظف' }, 400);
    }

    // Fetch settings for snapshot
    const settings = await db.prepare(`SELECT official_book_header_text, official_book_footer_text, verification_note_text, use_school_logo_on_docs, use_school_stamp_on_docs, default_print_size, date_format, use_arabic_indic_digits FROM school_settings WHERE school_id = ?`).bind(schoolId).first<any>();

    // Fetch student/employee if needed
    let studentName = null, studentNumber = null, className = null, sectionName = null;
    let employeeName = null, employeePosition = null;
    if (studentId) {
      const st = await db.prepare(`
        SELECT id, school_id, full_name, student_number, class_id, section_id, status
        FROM students
        WHERE id = ?
      `).bind(studentId).first<any>();
      if (!st) {
        return c.json({ error: 'الطالب غير موجود' }, 404);
      }
      if (st.school_id !== schoolId) {
        return c.json({ error: 'غير مسموح: الطالب تابع لمدرسة أخرى' }, 403);
      }
      if (st.status !== 'active') {
        return c.json({ error: 'الطالب غير فعال' }, 400);
      }
      const placement = await validateStudentPlacement(
        db,
        schoolId,
        st.class_id,
        st.section_id,
      );
      if (!placement.ok) {
        return c.json({ error: placement.error }, placement.status);
      }
      studentName = st.full_name;
      studentNumber = st.student_number;
      className = placement.classRecord?.name || null;
      sectionName = placement.sectionRecord?.name || null;
    }
    if (employeeId) {
      const emp = await db.prepare(`
        SELECT school_id, full_name, job_title, status
        FROM employees
        WHERE id = ?
      `).bind(employeeId).first<any>();
      if (!emp) {
        return c.json({ error: 'الموظف غير موجود' }, 404);
      }
      if (emp.school_id !== schoolId) {
        return c.json({ error: 'غير مسموح: الموظف تابع لمدرسة أخرى' }, 403);
      }
      if (emp.status !== 'active') {
        return c.json({ error: 'الموظف غير فعال' }, 400);
      }
      employeeName = emp.full_name;
      employeePosition = emp.job_title;
    }

    // Build snapshot JSON
    const snapshot = {
      school_name: school?.name || '',
      principal_name: school?.principal_name || '',
      logo_url: school?.logo_url || null,
      stamp_url: school?.official_stamp_url || null,
      use_logo: settings?.use_school_logo_on_docs === 1,
      use_stamp: settings?.use_school_stamp_on_docs === 1,
      official_book_header_text: settings?.official_book_header_text || null,
      official_book_footer_text: settings?.official_book_footer_text || null,
      verification_note: settings?.verification_note_text || null,
      paper_size: template.paper_size || settings?.default_print_size || 'A4',
      date_format: settings?.date_format || 'dd/MM/yyyy',
      use_arabic_indic_digits: settings?.use_arabic_indic_digits === 1,
    };

    // Placeholder replacement
    let bodyText = template.body_text;
    const dateStr = new Date().toLocaleDateString('ar-IQ');
    const placeholders: Record<string, string | null> = {
      '{{school_name}}': snapshot.school_name,
      '{{principal_name}}': snapshot.principal_name,
      '{{student_name}}': studentName,
      '{{student_number}}': studentNumber,
      '{{class_name}}': className,
      '{{section_name}}': sectionName,
      '{{academic_year}}': null,
      '{{employee_name}}': employeeName,
      '{{employee_position}}': employeePosition,
      '{{date}}': dateStr,
      '{{document_number}}': null, // filled later
    };

    for (const [key, value] of Object.entries(placeholders)) {
      if (value !== null) {
        bodyText = bodyText.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), String(value));
      }
    }

    // Generate verification token + hash
    const token = crypto.randomUUID().replace(/-/g, '');
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Step 1: Insert with temporary document number
    const tempNumber = `TEMP-${Date.now()}`;
    const result = await db.prepare(`
      INSERT INTO official_books (school_id, template_id, document_number, title, body_text, paper_size, student_id, employee_id, school_name_snapshot, principal_name_snapshot, logo_url_snapshot, stamp_url_snapshot, use_logo_snapshot, use_stamp_snapshot, header_text_snapshot, footer_text_snapshot, verification_note_snapshot, date_format_snapshot, use_arabic_indic_digits_snapshot, settings_snapshot_json, verification_token, verification_hash, status, created_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).bind(schoolId, templateId, tempNumber, template.title, bodyText, snapshot.paper_size, studentId, employeeId, snapshot.school_name, snapshot.principal_name || null, snapshot.logo_url, snapshot.stamp_url, snapshot.use_logo ? 1 : 0, snapshot.use_stamp ? 1 : 0, snapshot.official_book_header_text, snapshot.official_book_footer_text, snapshot.verification_note, snapshot.date_format, snapshot.use_arabic_indic_digits ? 1 : 0, JSON.stringify(snapshot), token, hashHex, user.id).run();

    const bookId = result.meta?.last_row_id;
    const ts = Math.floor(Date.now() / 1000);
    const documentNumber = `BOOK-${schoolId}-${bookId}-${ts}`;

    // Step 2: Update document number
    await db.prepare(`UPDATE official_books SET document_number = ? WHERE id = ? AND school_id = ?`).bind(documentNumber, bookId, schoolId).run();

    // Final placeholder replacement for document number
    bodyText = bodyText.replace(/\{\{document_number\}\}/g, documentNumber);
    await db.prepare(`UPDATE official_books SET body_text = ? WHERE id = ? AND school_id = ?`).bind(bodyText, bookId, schoolId).run();

    return c.json({ data: { id: bookId, document_number: documentNumber, verification_token: token, message: 'تم إنشاء الكتاب الرسمي بنجاح' } }, 201);
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء الكتاب الرسمي', detail: err.message }, 500);
  }
});

// ===========================================
// PUT /api/official-books/:id/cancel
// ===========================================
app.put('/api/official-books/:id/cancel', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;

  if (!user || !canManageOfficialBooks(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الكتب الرسمية' }, 403);
  }

  try {
    const id = parseInt(c.req.param('id'), 10);
    const body = await c.req.json().catch(() => ({}));
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const book = await db.prepare(
      'SELECT school_id FROM official_books WHERE id = ?',
    ).bind(id).first<{ school_id: number }>();
    if (!book) {
      return c.json({ error: 'الكتاب غير موجود' }, 404);
    }
    if (book.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: الكتاب تابع لمدرسة أخرى' }, 403);
    }
    await db.prepare(`UPDATE official_books SET status = 'cancelled', updated_at = unixepoch() WHERE id = ? AND school_id = ?`).bind(id, targetSchool.schoolId).run();
    return c.json({ data: { message: 'تم إلغاء الكتاب بنجاح' } });
  } catch (err: any) {
    return c.json({ error: 'فشل في إلغاء الكتاب', detail: err.message }, 500);
  }
});

// ===========================================
// POST /api/official-books/:id/print
// ===========================================
app.post('/api/official-books/:id/print', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;

  if (!user || !canManageOfficialBooks(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية طباعة الكتب الرسمية' }, 403);
  }

  try {
    const id = parseInt(c.req.param('id'), 10);
    const body = await c.req.json().catch(() => ({}));
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    const book = await db.prepare(`SELECT school_id, status FROM official_books WHERE id = ?`).bind(id).first<any>();
    if (!book) {
      return c.json({ error: 'الكتاب غير موجود' }, 404);
    }
    if (book.school_id !== targetSchool.schoolId) {
      return c.json({ error: 'غير مسموح: الكتاب تابع لمدرسة أخرى' }, 403);
    }
    if (book.status === 'cancelled') {
      return c.json({ error: 'هذا الكتاب ملغى ولا يمكن طباعته' }, 400);
    }

    await db.prepare(`INSERT INTO print_records (school_id, document_id, print_type, printed_at, printed_by_user_id, printer_info_json) VALUES (?, ?, 'official_book', unixepoch(), ?, ?)`).bind(targetSchool.schoolId, id, user.id, null).run();
    return c.json({ data: { message: 'تم تسجيل الطباعة بنجاح' } });
  } catch (err: any) {
    return c.json({ error: 'فشل في تسجيل الطباعة', detail: err.message }, 500);
  }
});

// ===========================================
// GET /api/print-records
// ===========================================
app.get('/api/print-records', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canViewPrintRecords(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية عرض سجلات الطباعة' }, 403);
  }

  try {
    const query = c.req.query();
    const printType = query.print_type || null;
    const fromDate = query.from_date ? parseInt(query.from_date, 10) : null;
    const toDate = query.to_date ? parseInt(query.to_date, 10) : null;
    const userId = query.user_id ? parseInt(query.user_id, 10) : null;

    let sql = `SELECT pr.id, pr.school_id, pr.document_id, pr.print_type, pr.printed_at, pr.printed_by_user_id, pr.printer_info_json, pr.created_at, u.full_name as printed_by_name FROM print_records pr LEFT JOIN users u ON pr.printed_by_user_id = u.id AND (u.school_id = pr.school_id OR u.school_id IS NULL) WHERE 1=1`;
    const params: any[] = [];

    if (scope === 'single' && resolvedSchoolId) {
      sql += ` AND pr.school_id = ?`;
      params.push(resolvedSchoolId);
    }
    if (printType) {
      sql += ` AND pr.print_type = ?`;
      params.push(printType);
    }
    if (fromDate) {
      sql += ` AND pr.printed_at >= ?`;
      params.push(fromDate);
    }
    if (toDate) {
      sql += ` AND pr.printed_at <= ?`;
      params.push(toDate);
    }
    if (userId) {
      sql += ` AND pr.printed_by_user_id = ?`;
      params.push(userId);
    }

    sql += ` ORDER BY pr.printed_at DESC`;
    const rows = await db.prepare(sql).bind(...params).all<any>();
    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب سجلات الطباعة', detail: err.message }, 500);
  }
});

// ===========================================
// GET /api/verify/official-book/:token
// Public — no JWT required
// ===========================================
app.get('/api/verify/official-book/:token', async (c) => {
  const db = c.env.DB;
  const token = c.req.param('token');

  try {
    const book = await db.prepare(`
      SELECT ob.id, ob.document_number, ob.title, ob.body_text, ob.status, ob.created_at, ob.school_name_snapshot, ob.student_id, ob.employee_id, ob.verification_hash, ob.settings_snapshot_json, st.full_name as student_name, emp.full_name as employee_name
      FROM official_books ob
      LEFT JOIN students st ON ob.student_id = st.id
      LEFT JOIN employees emp ON ob.employee_id = emp.id
      WHERE ob.verification_token = ?
    `).bind(token).first<any>();

    if (!book) {
      return c.json({ valid: false, message: 'الكتاب غير موجود أو رمز التحقق غير صحيح' }, 404);
    }

    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    if (hashHex !== book.verification_hash) {
      return c.json({ valid: false, message: 'الكتاب غير موجود أو رمز التحقق غير صحيح' }, 404);
    }

    const settings = book.settings_snapshot_json ? JSON.parse(book.settings_snapshot_json) : {};

    const result: any = {
      valid: true,
      document_number: book.document_number,
      title: book.title,
      school_name: book.school_name_snapshot,
      student_name: book.student_name,
      employee_name: book.employee_name,
      generated_at: book.created_at,
      status: book.status,
      verification_note: settings.verification_note || null,
    };

    if (book.status === 'cancelled') {
      result.cancelled_warning = 'هذا الكتاب ملغى ولا يُعتد به';
    }

    return c.json({ data: result });
  } catch (err: any) {
    return c.json({ valid: false, message: 'الكتاب غير موجود أو رمز التحقق غير صحيح' }, 500);
  }
});

// ===========================================
// Phase 13A: Excel Import/Export Helpers
// ===========================================

function canImportExport(roleKey: RoleKey): boolean {
  return ['system_admin', 'school_owner', 'principal', 'vice_principal', 'registrar'].includes(roleKey);
}

function canImportEmployees(roleKey: RoleKey): boolean {
  return ['system_admin', 'school_owner', 'principal', 'vice_principal'].includes(roleKey);
}

function canImportGrades(roleKey: RoleKey): boolean {
  return ['system_admin', 'school_owner', 'principal', 'vice_principal'].includes(roleKey);
}

function canImportStudentSubjects(roleKey: RoleKey): boolean {
  return ['system_admin', 'school_owner', 'principal', 'vice_principal', 'registrar'].includes(roleKey);
}

function canExport(roleKey: RoleKey): boolean {
  return ['system_admin', 'school_owner', 'principal', 'vice_principal', 'registrar'].includes(roleKey);
}

function normalizeText(v: any): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v).trim();
}

function normalizeNumber(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function normalizeBoolean(v: any): boolean | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim().toLowerCase();
  if (['1','yes','true','نعم','مفعل'].includes(s)) return true;
  if (['0','no','false','لا','غير مفعل'].includes(s)) return false;
  return null;
}

function normalizeDate(v: any): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  // If it's already a valid ISO date or YYYY-MM-DD, return as-is (basic validation)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Try to convert from Excel serial date (number of days since 1900-01-01)
  const n = Number(s);
  if (!isNaN(n) && n > 0) {
    // Excel epoch offset: 1900-01-01 is day 1 in Windows Excel, but JavaScript epoch starts at 1970-01-01
    // This is a simple approximation; frontend should convert serial dates before sending
    return null;
  }
  return null;
}

function isValidGender(v: any): string | null {
  const s = normalizeText(v);
  if (!s) return null;
  const lower = s.toLowerCase();
  if (['male','m','ذكر'].includes(lower)) return 'male';
  if (['female','f','انثى','أنثى'].includes(lower)) return 'female';
  return null;
}

function isValidStatus(v: any): string | null {
  const s = normalizeText(v);
  if (!s) return null;
  const lower = s.toLowerCase();
  if (['active','نشط','مفعل'].includes(lower)) return 'active';
  if (['inactive','غير نشط','غير مفعل','معطل'].includes(lower)) return 'inactive';
  if (['archived','مؤرشف'].includes(lower)) return 'archived';
  return null;
}

function isValidSubjectType(v: any): string | null {
  const s = normalizeText(v);
  if (!s) return null;
  const lower = s.toLowerCase();
  if (['core','أساسية'].includes(lower)) return 'core';
  if (['elective','اختيارية'].includes(lower)) return 'elective';
  if (['religious','دينية'].includes(lower)) return 'religious';
  if (['sport','رياضية','sports'].includes(lower)) return 'sport';
  if (['art','فنية','arts'].includes(lower)) return 'art';
  if (['language','لغة','languages'].includes(lower)) return 'language';
  if (['science','علوم'].includes(lower)) return 'science';
  if (['math','رياضيات','mathematics'].includes(lower)) return 'math';
  if (['other','أخرى'].includes(lower)) return 'other';
  return null;
}

function isValidEmployeeType(v: any): string | null {
  const s = normalizeText(v);
  if (!s) return null;
  const lower = s.toLowerCase();
  if (['teacher','مدرس'].includes(lower)) return 'teacher';
  if (['administrator','إداري'].includes(lower)) return 'administrator';
  if (['accountant','محاسب'].includes(lower)) return 'accountant';
  if (['registrar','شؤون طلاب'].includes(lower)) return 'registrar';
  if (['principal','مدير'].includes(lower)) return 'principal';
  if (['worker','عامل'].includes(lower)) return 'worker';
  if (['driver','سائق'].includes(lower)) return 'driver';
  return 'other';
}

function isValidSalaryType(v: any): string | null {
  const s = normalizeText(v);
  if (!s) return null;
  const lower = s.toLowerCase();
  if (['monthly','شهري'].includes(lower)) return 'monthly';
  if (['hourly','ساعي'].includes(lower)) return 'hourly';
  if (['daily','يومي'].includes(lower)) return 'daily';
  if (['weekly','أسبوعي'].includes(lower)) return 'weekly';
  if (['contract','عقد'].includes(lower)) return 'contract';
  return 'other';
}

function normalizeArabicSubjectName(v: any): string | null {
  const s = normalizeText(v);
  if (!s) return null;
  return s
    .replace(/^[\s\uFEFF]+|[\s\uFEFF]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^ال/, '')
    .replace(/(^|[^\u0600-\u06FF])أ/g, '$1ا')
    .replace(/(^|[^\u0600-\u06FF])إ/g, '$1ا')
    .replace(/(^|[^\u0600-\u06FF])آ/g, '$1ا')
    .toLowerCase();
}

function matchSubjectByName(subjectName: string, subjects: any[]): any | null {
  const normalized = normalizeArabicSubjectName(subjectName);
  if (!normalized) return null;
  const candidates = subjects.filter((s: any) => {
    const sn = normalizeArabicSubjectName(s.name);
    if (!sn) return false;
    return sn === normalized || sn === normalized.replace(/^ال/, '') || normalized === sn.replace(/^ال/, '');
  });
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) return { _ambiguous: true, matches: candidates.length };
  return null;
}

function findStudentByIdentifier(
  identifier: any,
  students: any[],
  className?: string | null,
  sectionName?: string | null,
  classMap?: Map<string, number>,
  sectionMap?: Map<string, number>
): any | null {
  const studentNumber = normalizeText(identifier);
  if (studentNumber) {
    const byNumber = students.find((s: any) => normalizeText(s.student_number) === studentNumber);
    if (byNumber) return byNumber;
  }
  const fullName = normalizeText(identifier);
  if (!fullName) return null;
  const byName = students.filter((s: any) => normalizeText(s.full_name) === fullName);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1 && className && classMap) {
    const classId = classMap.get(className);
    if (classId) {
      const byClass = byName.filter((s: any) => s.class_id === classId);
      if (sectionName && sectionMap && classId) {
        const sectionKey = `${classId}:${sectionName}`;
        const sectionId = sectionMap.get(sectionKey);
        if (sectionId) {
          const bySection = byClass.filter((s: any) => s.section_id === sectionId);
          if (bySection.length === 1) return bySection[0];
        }
      }
      if (byClass.length === 1) return byClass[0];
    }
  }
  if (byName.length > 1) return { _ambiguous: true };
  return null;
}

function isValidEmail(v: any): string | null {
  const s = normalizeText(v);
  if (!s) return null;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(s) ? s : null;
}

function isValidPhone(v: any): string | null {
  const s = normalizeText(v);
  if (!s) return null;
  // Allow digits, spaces, dashes, plus signs, parentheses
  const phoneRegex = /^[\d\s\-+()]+$/;
  return phoneRegex.test(s) ? s : null;
}

const PHASE13A_TYPES = ['students', 'classes-sections', 'subjects', 'employees', 'grades', 'student-subjects'];
const GRADE_IMPORT_MAX_SOURCES = 40;
const GRADE_IMPORT_MAX_ROWS = 2000;
const GRADE_IMPORT_MAX_SPECIAL_VALUES = 50;

function parseGradeImportPayload(body: any): { ok: true; payload: GradeImportPayload } | { ok: false; error: string } {
  const requestedSources = Array.isArray(body?.grade_sources) ? body.grade_sources : body?.grade_sheets;
  if (!Array.isArray(requestedSources) || requestedSources.length === 0) {
    return { ok: false, error: 'يجب اختيار مصدر درجات واحد على الأقل' };
  }
  if (requestedSources.length > GRADE_IMPORT_MAX_SOURCES) {
    return { ok: false, error: `عدد مصادر الدرجات يتجاوز الحد المسموح (${GRADE_IMPORT_MAX_SOURCES})` };
  }
  if (!['update_existing', 'skip_existing', 'error_on_existing'].includes(body.mode || 'update_existing')) {
    return { ok: false, error: 'وضع استيراد الدرجات غير صالح' };
  }
  if (!['strict_existing_assignments', 'auto_assign_missing_subjects'].includes(body.assignment_mode || 'strict_existing_assignments')) {
    return { ok: false, error: 'سياسة تسجيل الطالب في المادة غير صالحة' };
  }

  const seenSourceIds = new Set<string>();
  let totalRows = 0;
  const gradeSources: GradeImportSourcePayload[] = [];
  for (let sourceIndex = 0; sourceIndex < requestedSources.length; sourceIndex += 1) {
    const candidate = requestedSources[sourceIndex];
    const sheetName = normalizeText(candidate?.sheet_name);
    if (!sheetName) return { ok: false, error: 'اسم ورقة الدرجات مطلوب' };
    const sourceId = normalizeText(candidate?.source_id) || `${sheetName}:region:${sourceIndex + 1}`;
    if (seenSourceIds.has(sourceId)) return { ok: false, error: `معرف مصدر الدرجات "${sourceId}" مكرر في الطلب` };
    seenSourceIds.add(sourceId);
    if (!Array.isArray(candidate.rows) || candidate.rows.length === 0) {
      return { ok: false, error: `لا توجد صفوف قابلة للاستيراد في المصدر "${sourceId}"` };
    }
    if (!candidate.mapping || typeof candidate.mapping !== 'object' || Array.isArray(candidate.mapping)) {
      return { ok: false, error: `تعيين الأعمدة غير صالح في الورقة "${sheetName}"` };
    }
    totalRows += candidate.rows.length;
    const subjectSource = candidate.subject_source
      || (candidate.subject_id != null ? 'fixed' : candidate.mapping.subject_name ? 'column' : 'inferred');
    if (!['fixed', 'column', 'inferred'].includes(subjectSource)) {
      return { ok: false, error: `مصدر المادة غير صالح في المصدر "${sourceId}"` };
    }
    const subjectId = candidate.subject_id == null ? null : Number(candidate.subject_id);
    if (subjectId != null && (!Number.isInteger(subjectId) || subjectId <= 0)) {
      return { ok: false, error: `معرف المادة غير صالح في المصدر "${sourceId}"` };
    }
    const classId = candidate.class_id == null ? null : Number(candidate.class_id);
    const sectionId = candidate.section_id == null ? null : Number(candidate.section_id);
    if (classId != null && (!Number.isInteger(classId) || classId <= 0)) return { ok: false, error: `معرف الصف غير صالح في المصدر "${sourceId}"` };
    if (sectionId != null && (!Number.isInteger(sectionId) || sectionId <= 0)) return { ok: false, error: `معرف الشعبة غير صالح في المصدر "${sourceId}"` };
    const rowStart = candidate.row_start == null ? null : Number(candidate.row_start);
    const rowEnd = candidate.row_end == null ? null : Number(candidate.row_end);
    if (rowStart != null && (!Number.isInteger(rowStart) || rowStart <= 0)) return { ok: false, error: `بداية نطاق الصفوف غير صالحة في المصدر "${sourceId}"` };
    if (rowEnd != null && (!Number.isInteger(rowEnd) || rowEnd <= 0)) return { ok: false, error: `نهاية نطاق الصفوف غير صالحة في المصدر "${sourceId}"` };
    if (rowStart != null && rowEnd != null && rowStart > rowEnd) return { ok: false, error: `نطاق الصفوف معكوس في المصدر "${sourceId}"` };
    const candidateSpecialValues = candidate.special_values ?? {};
    if (typeof candidateSpecialValues !== 'object' || Array.isArray(candidateSpecialValues)) {
      return { ok: false, error: `تفسير القيم الخاصة غير صالح في المصدر "${sourceId}"` };
    }
    const specialValueEntries = Object.entries(candidateSpecialValues);
    if (specialValueEntries.length > GRADE_IMPORT_MAX_SPECIAL_VALUES) {
      return { ok: false, error: `عدد القيم الخاصة يتجاوز الحد المسموح في المصدر "${sourceId}"` };
    }
    const specialValues: NonNullable<GradeImportSourcePayload['special_values']> = {};
    for (const [rawMarker, action] of specialValueEntries) {
      const marker = normalizeText(rawMarker);
      if (!marker || marker.length > 100) return { ok: false, error: `علامة القيمة الخاصة غير صالحة في المصدر "${sourceId}"` };
      if (action !== 'not_applicable') return { ok: false, error: `تفسير القيمة الخاصة "${marker}" غير مدعوم` };
      specialValues[marker] = action;
    }
    const candidateZeroValues = candidate.zero_values ?? {};
    if (typeof candidateZeroValues !== 'object' || Array.isArray(candidateZeroValues)) {
      return { ok: false, error: `تفسير قيم الصفر غير صالح في المصدر "${sourceId}"` };
    }
    const zeroValueEntries = Object.entries(candidateZeroValues);
    if (zeroValueEntries.length > RAW_GRADE_FIELDS.length) {
      return { ok: false, error: `عدد تفسيرات الصفر غير صالح في المصدر "${sourceId}"` };
    }
    const zeroValues: NonNullable<GradeImportSourcePayload['zero_values']> = {};
    for (const [field, interpretation] of zeroValueEntries) {
      if (!RAW_GRADE_FIELDS.includes(field as RawGradeField)) return { ok: false, error: `حقل تفسير الصفر "${field}" غير صالح` };
      if (!['numeric', 'blank'].includes(String(interpretation))) return { ok: false, error: `تفسير الصفر للحقل "${field}" غير مدعوم` };
      zeroValues[field as RawGradeField] = interpretation as 'numeric' | 'blank';
    }
    gradeSources.push({
      source_id: sourceId,
      sheet_name: sheetName,
      region_id: normalizeText(candidate.region_id),
      row_start: rowStart,
      row_end: rowEnd,
      rows: candidate.rows,
      mapping: Object.fromEntries(Object.entries(candidate.mapping).filter(([, value]) => typeof value === 'string' && value)) as Record<string, string>,
      column_headers: candidate.column_headers && typeof candidate.column_headers === 'object' && !Array.isArray(candidate.column_headers)
        ? Object.fromEntries(Object.entries(candidate.column_headers).filter(([, value]) => typeof value === 'string')) as Record<string, string>
        : {},
      subject_source: subjectSource,
      subject_id: subjectId,
      subject_name: normalizeText(candidate.subject_name),
      metadata_subject_name: normalizeText(candidate.metadata_subject_name),
      class_id: classId,
      section_id: sectionId,
      special_values: specialValues,
      zero_values: zeroValues,
    });
  }
  if (totalRows > GRADE_IMPORT_MAX_ROWS) {
    return { ok: false, error: `إجمالي صفوف الدرجات يتجاوز الحد المسموح (${GRADE_IMPORT_MAX_ROWS})` };
  }

  return {
    ok: true,
    payload: {
      grade_sources: gradeSources,
      mode: body.mode || 'update_existing',
      assignment_mode: body.assignment_mode || 'strict_existing_assignments',
      clear_empty_fields: body.clear_empty_fields === true,
    },
  };
}

async function loadGradeImportContext(db: D1Database, schoolId: number): Promise<GradeImportContext> {
  const students = (await listStudentsWithEffectivePlacement(db, { schoolId }))
    .filter((student) => student.status !== 'archived');
  const [settingsResult, subjectsResult, assignmentsResult, gradesResult, classesResult, sectionsResult] = await db.batch<any>([
    db.prepare(`SELECT max_grade, passing_grade, exemption_grade, general_exemption_average_grade, general_exemption_min_subject_grade,
                       first_term_input_mode, second_term_input_mode, mid_year_exam_enabled, final_exam_enabled, completion_exam_enabled
                FROM grade_settings WHERE school_id = ?`).bind(schoolId),
    // Keep archived subject metadata in context so religious-conflict preflight
    // matches the D1 trigger; subject resolution still excludes archived rows.
    db.prepare(`SELECT id, school_id, name, class_id, section_id, status, religious_track FROM subjects WHERE school_id = ?`).bind(schoolId),
    db.prepare(`SELECT id, school_id, student_id, subject_id, class_id, section_id, is_active FROM student_subjects WHERE school_id = ?`).bind(schoolId),
    db.prepare(`SELECT id, school_id, student_subject_id, first_term_grade, first_month, second_month, second_term_grade, third_month, fourth_month, mid_year_exam, final_exam, completion_exam, notes FROM grades WHERE school_id = ?`).bind(schoolId),
    db.prepare(`SELECT id, school_id, name, status FROM classes WHERE school_id = ?`).bind(schoolId),
    db.prepare(`SELECT id, school_id, class_id, name, status FROM sections WHERE school_id = ?`).bind(schoolId),
  ]);
  const settings = withNormalizedGradeScheme(settingsResult.results?.[0] || {
    max_grade: 100,
    passing_grade: 50,
    exemption_grade: 90,
    general_exemption_average_grade: 85,
    general_exemption_min_subject_grade: 75,
  });
  return {
    schoolId,
    settings,
    students,
    subjects: subjectsResult.results || [],
    assignments: assignmentsResult.results || [],
    grades: gradesResult.results || [],
    classes: classesResult.results || [],
    sections: sectionsResult.results || [],
  };
}

function gradeImportPreviewData(plan: ReturnType<typeof buildGradeImportPlan>) {
  return {
    type: 'grades',
    mode: plan.mode,
    total_rows: plan.summary.total_source_rows,
    valid_rows: plan.summary.valid_grade_rows,
    error_rows: plan.summary.errors,
    duplicate_rows: plan.summary.duplicate_rows,
    skipped_rows: plan.summary.noop_rows,
    not_applicable_rows: plan.summary.not_applicable_rows,
    valid: plan.records,
    not_applicable: plan.not_applicable,
    errors: plan.errors,
    warnings: plan.warnings,
    duplicates: plan.duplicates,
    sources: plan.sources,
    sheets: plan.sources,
    summary: plan.summary,
    assignment_mode: plan.assignment_mode,
    clear_empty_fields: plan.clear_empty_fields,
  };
}

function gradeWritePayload(record: PlannedGradeImportRecord) {
  return {
    student_id: record.student_id,
    subject_id: record.subject_id,
    class_id: record.class_id,
    section_id: record.section_id,
    existing_grade_id: record.existing_grade_id,
    values: record.values,
    calculated: record.calculated,
  };
}

async function executeGradeImportPlan(
  db: D1Database,
  schoolId: number,
  userId: number,
  fileName: string,
  plan: ReturnType<typeof buildGradeImportPlan>,
): Promise<number> {
  const statements: D1PreparedStatement[] = [];
  const assignmentCreates = plan.records.filter(record => record.assignment_action === 'create').map(gradeWritePayload);
  const assignmentReactivations = plan.records
    .filter(record => record.assignment_action === 'reactivate' && record.assignment_id != null)
    .map(record => record.assignment_id as number);
  const gradeCreates = plan.records.filter(record => record.action === 'create').map(gradeWritePayload);
  const gradeUpdates = plan.records.filter(record => record.action === 'update').map(gradeWritePayload);
  const auditRows = plan.records.flatMap(record => record.existing_grade_id == null ? [] : record.changed_fields.map(field => ({
    grade_id: record.existing_grade_id,
    field_name: field,
    old_value: record.existing_values[field] == null ? null : String(record.existing_values[field]),
    new_value: record.values[field] == null ? null : String(record.values[field]),
  })));

  if (assignmentCreates.length) {
    statements.push(db.prepare(`
      INSERT INTO student_subjects (school_id, student_id, subject_id, class_id, section_id, is_active, assigned_by_user_id, assigned_at, notes, created_at, updated_at)
      SELECT ?,
             CAST(json_extract(value, '$.student_id') AS INTEGER),
             CAST(json_extract(value, '$.subject_id') AS INTEGER),
             CAST(json_extract(value, '$.class_id') AS INTEGER),
             CAST(json_extract(value, '$.section_id') AS INTEGER),
             1, ?, unixepoch(), 'استيراد درجات Excel', unixepoch(), unixepoch()
      FROM json_each(?)
    `).bind(schoolId, userId, JSON.stringify(assignmentCreates)));
  }
  if (assignmentReactivations.length) {
    statements.push(db.prepare(`
      UPDATE student_subjects
      SET is_active = 1, assigned_by_user_id = ?, assigned_at = unixepoch(), removed_at = NULL, updated_at = unixepoch()
      WHERE school_id = ? AND id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
    `).bind(userId, schoolId, JSON.stringify(assignmentReactivations)));
  }
  if (gradeCreates.length) {
    statements.push(db.prepare(`
      INSERT INTO grades (
        school_id, student_subject_id, first_term_grade, first_month, second_month, second_term_grade, third_month, fourth_month,
        mid_year_exam, final_exam, completion_exam, first_term_average, second_term_average,
        annual_effort, final_grade, grade_after_completion, effective_grade, result_status,
        exemption_status, notes, is_active, created_at, updated_at, updated_by_user_id
      )
      SELECT ?, ss.id,
        json_extract(p.value, '$.values.first_term_grade'),
        json_extract(p.value, '$.values.first_month'), json_extract(p.value, '$.values.second_month'),
        json_extract(p.value, '$.values.second_term_grade'),
        json_extract(p.value, '$.values.third_month'), json_extract(p.value, '$.values.fourth_month'),
        json_extract(p.value, '$.values.mid_year_exam'), json_extract(p.value, '$.values.final_exam'),
        json_extract(p.value, '$.values.completion_exam'), json_extract(p.value, '$.calculated.first_term_average'),
        json_extract(p.value, '$.calculated.second_term_average'), json_extract(p.value, '$.calculated.annual_effort'),
        json_extract(p.value, '$.calculated.final_grade'), json_extract(p.value, '$.calculated.grade_after_completion'),
        json_extract(p.value, '$.calculated.effective_grade'), json_extract(p.value, '$.calculated.result_status'),
        COALESCE(json_extract(p.value, '$.calculated.exemption_status'), 0), json_extract(p.value, '$.values.notes'),
        1, unixepoch(), unixepoch(), ?
      FROM json_each(?) AS p
      JOIN student_subjects AS ss
        ON ss.school_id = ?
       AND ss.student_id = CAST(json_extract(p.value, '$.student_id') AS INTEGER)
       AND ss.subject_id = CAST(json_extract(p.value, '$.subject_id') AS INTEGER)
       AND ss.is_active = 1
    `).bind(schoolId, userId, JSON.stringify(gradeCreates), schoolId));
  }
  if (gradeUpdates.length) {
    statements.push(db.prepare(`
      UPDATE grades AS g SET
        first_term_grade = json_extract(p.value, '$.values.first_term_grade'),
        first_month = json_extract(p.value, '$.values.first_month'),
        second_month = json_extract(p.value, '$.values.second_month'),
        second_term_grade = json_extract(p.value, '$.values.second_term_grade'),
        third_month = json_extract(p.value, '$.values.third_month'),
        fourth_month = json_extract(p.value, '$.values.fourth_month'),
        mid_year_exam = json_extract(p.value, '$.values.mid_year_exam'),
        final_exam = json_extract(p.value, '$.values.final_exam'),
        completion_exam = json_extract(p.value, '$.values.completion_exam'),
        first_term_average = json_extract(p.value, '$.calculated.first_term_average'),
        second_term_average = json_extract(p.value, '$.calculated.second_term_average'),
        annual_effort = json_extract(p.value, '$.calculated.annual_effort'),
        final_grade = json_extract(p.value, '$.calculated.final_grade'),
        grade_after_completion = json_extract(p.value, '$.calculated.grade_after_completion'),
        effective_grade = json_extract(p.value, '$.calculated.effective_grade'),
        result_status = json_extract(p.value, '$.calculated.result_status'),
        exemption_status = COALESCE(json_extract(p.value, '$.calculated.exemption_status'), 0),
        notes = json_extract(p.value, '$.values.notes'),
        is_active = 1, updated_at = unixepoch(), updated_by_user_id = ?
      FROM json_each(?) AS p
      WHERE g.school_id = ?
        AND g.id = CAST(json_extract(p.value, '$.existing_grade_id') AS INTEGER)
    `).bind(userId, JSON.stringify(gradeUpdates), schoolId));
  }
  if (auditRows.length) {
    statements.push(db.prepare(`
      INSERT INTO grade_change_logs (school_id, grade_id, field_name, old_value, new_value, changed_by_user_id, change_reason, created_at)
      SELECT ?, CAST(json_extract(value, '$.grade_id') AS INTEGER), json_extract(value, '$.field_name'),
             json_extract(value, '$.old_value'), json_extract(value, '$.new_value'), ?, 'استيراد درجات Excel', unixepoch()
      FROM json_each(?)
    `).bind(schoolId, userId, JSON.stringify(auditRows)));
  }

  const summary = gradeImportPreviewData(plan);
  statements.push(db.prepare(`
    INSERT INTO import_jobs (
      school_id, import_type, file_name, mode, status, total_rows, valid_rows, error_rows,
      imported_rows, skipped_rows, updated_rows, summary_json, created_by_user_id, created_at, completed_at
    ) VALUES (?, 'grades', ?, ?, 'completed', ?, ?, 0, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
  `).bind(
    schoolId,
    fileName,
    plan.mode,
    plan.summary.total_source_rows,
    plan.records.length,
    plan.summary.new_grade_rows,
    plan.summary.noop_rows + plan.summary.not_applicable_rows,
    plan.summary.update_rows,
    JSON.stringify(summary),
    userId,
  ));
  const results = await db.batch(statements);
  const jobId = Number(results[results.length - 1]?.meta?.last_row_id);
  if (!Number.isInteger(jobId) || jobId <= 0) throw new Error('تعذر تسجيل عملية استيراد الدرجات');
  return jobId;
}

// ===========================================
// POST /api/import-export/:type/preview
// ===========================================
app.post('/api/import-export/:type/preview', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId');
  const scope: 'all' | 'single' = c.get('scope');
  const type = c.req.param('type');

  if (!user || !canImportExport(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية الاستيراد والتصدير' }, 403);
  }

  if (!PHASE13A_TYPES.includes(type)) {
    return c.json({ error: 'نوع الاستيراد غير مدعوم في هذه المرحلة' }, 400);
  }

  if (type === 'employees' && !canImportEmployees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية استيراد الموظفين' }, 403);
  }
  if (type === 'grades' && !canImportGrades(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية استيراد الدرجات' }, 403);
  }
  if (type === 'student-subjects' && !canImportStudentSubjects(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية استيراد تسجيل الطلاب في المواد' }, 403);
  }

  try {
    const body = await c.req.json();
    let { school_id, rows, mode, mapping, assignment_mode, clear_empty_fields, selected_subject_id, selected_class_id, selected_section_id, selected_sheet, class_assignment_mode, section_assignment_mode } = body;
    const targetSchool = await resolveActiveWriteSchool(db, user, school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    school_id = targetSchool.schoolId;
    if (type === 'grades') {
      const parsed = parseGradeImportPayload(body);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      const context = await loadGradeImportContext(db, school_id);
      const plan = buildGradeImportPlan(parsed.payload, context);
      return c.json({ data: gradeImportPreviewData(plan) });
    }
    mode = mode || 'skip_existing';
    const assignmentMode = assignment_mode || 'strict_existing_assignments';
    const clearEmpty = clear_empty_fields === true;
    if (!Array.isArray(rows) || rows.length === 0) {
      return c.json({ error: 'لا يوجد بيانات للاستيراد' }, 400);
    }
    if (rows.length > 500) {
      return c.json({ error: 'عدد الصفوف كبير جداً، يرجى تقسيم الملف' }, 400);
    }

    const classAssignmentMode = class_assignment_mode || (selected_class_id ? 'override' : 'excel');
    const sectionAssignmentMode = section_assignment_mode || (selected_section_id ? 'override' : 'none');
    if (type === 'students') {
      if (!['excel', 'override'].includes(classAssignmentMode)) {
        return c.json({ error: 'طريقة تحديد الصف غير صالحة' }, 400);
      }
      if (!['excel', 'override', 'none'].includes(sectionAssignmentMode)) {
        return c.json({ error: 'طريقة تحديد الشعبة غير صالحة' }, 400);
      }
      if (classAssignmentMode === 'override' && !selected_class_id) {
        return c.json({ error: 'يجب تحديد الصف للاستيراد' }, 400);
      }
      if (sectionAssignmentMode === 'override' && !selected_section_id) {
        return c.json({ error: 'يجب تحديد الشعبة للاستيراد' }, 400);
      }
      if (classAssignmentMode === 'override' || sectionAssignmentMode === 'override') {
        const selectedPlacement = await validateStudentPlacement(
          db,
          school_id,
          selected_class_id ? Number(selected_class_id) : null,
          sectionAssignmentMode === 'override' ? Number(selected_section_id) : null,
        );
        if (!selectedPlacement.ok) return c.json({ error: selectedPlacement.error }, selectedPlacement.status);
      }
    }

    const validRows: any[] = [];
    const errors: any[] = [];
    const warnings: any[] = [];
    const duplicates: any[] = [];
    const existingClasses = await db.prepare(`SELECT id, name FROM classes WHERE school_id = ? AND status = 'active'`).bind(school_id).all<any>();
    const existingSections = await db.prepare(`SELECT id, name, class_id FROM sections WHERE school_id = ? AND status = 'active'`).bind(school_id).all<any>();
    const existingStudents = type === 'students' || type === 'student-subjects'
      ? {
          results: (await listStudentsWithEffectivePlacement(db, { schoolId: school_id }))
            .filter(student => student.status !== 'archived'),
        }
      : await db.prepare(`SELECT id, student_number, full_name, class_id, section_id FROM students WHERE school_id = ? AND status != 'archived'`).bind(school_id).all<any>();
    const activeStudentImportYear = type === 'students'
      ? await resolveActiveAcademicYear(db, school_id)
      : null;
    const existingSubjects = await db.prepare(`SELECT s.id, s.name, s.class_id, s.section_id, s.religious_track FROM subjects s JOIN classes c ON s.class_id = c.id WHERE c.school_id = ? AND s.status != 'archived'`).bind(school_id).all<any>();
    const existingEmployees = await db.prepare(`SELECT id, full_name, email, phone FROM employees WHERE school_id = ? AND status != 'archived'`).bind(school_id).all<any>();

    const classMap = new Map((existingClasses.results || []).map((c: any) => [c.name, c.id]));
    const normalizedClassMap = new Map((existingClasses.results || []).map((c: any) => [normalizeStudentIdentity(c.name), c.id]));
    const classIdMap = new Map((existingClasses.results || []).map((c: any) => [c.id, c.name]));
    const sectionMap = new Map((existingSections.results || []).map((s: any) => [`${s.class_id}:${s.name}`, s.id]));
    const normalizedSectionMap = new Map((existingSections.results || []).map((s: any) => [`${s.class_id}:${normalizeSectionName(s.name)}`, s.id]));
    const studentMap = new Map((existingStudents.results || []).map((s: any) => [s.student_number, s]));
    const subjectMap = new Map((existingSubjects.results || []).map((s: any) => [`${s.class_id}:${s.section_id || ''}:${s.name}`, s.id]));
    const employeeEmailMap = new Map((existingEmployees.results || []).map((e: any) => [e.email, e]));
    const employeePhoneMap = new Map((existingEmployees.results || []).map((e: any) => [e.phone, e]));

    const excelRowNumber = (rowIndex: number) => Number(rows[rowIndex]?._excel_row_number || rows[rowIndex]?.excel_row_number || rowIndex + 2);
    const rowError = (rowIndex: number, field: string, message: string) => {
      errors.push({ row: excelRowNumber(rowIndex), field, message, raw: rows[rowIndex] });
    };

    const rowWarn = (rowIndex: number, field: string, message: string) => {
      warnings.push({ row: excelRowNumber(rowIndex), field, message });
    };

    const seenStudentNumbers = new Set<string>();
    const seenStudentIdentities = new Set<string>();
    const plannedReligiousStudentSubjects = new Map<number, number>();
    let skippedRows = 0;

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i] || {};
      const hasRawData = Object.entries(raw).some(([key, value]) => !['_excel_row_number', 'excel_row_number'].includes(key) && normalizeText(value));
      if (!hasRawData) {
        skippedRows += 1;
        rowWarn(i, 'row', 'صف Excel فارغ وتم تجاهله');
        continue;
      }
      const mapped: Record<string, any> = {};
      if (mapping && typeof mapping === 'object') {
        for (const [systemField, excelColumn] of Object.entries(mapping)) {
          if (excelColumn && typeof excelColumn === 'string') {
            mapped[systemField] = raw[excelColumn] ?? null;
          }
        }
      } else {
        // No mapping provided: use raw keys directly where they match system fields
        Object.assign(mapped, raw);
      }

      const record: any = { row_index: i + 1 };
      let hasFatal = false;

      if (type === 'students') {
        const importedFields = new Set<string>(
          mapping && typeof mapping === 'object'
            ? Object.keys(mapping).filter(field => mapping[field])
            : Object.keys(mapped),
        );
        if (!mapping && STUDENT_RELIGION_HEADER_ALIASES.some(alias => (
          Object.prototype.hasOwnProperty.call(mapped, alias)
        ))) importedFields.add('religion');
        const studentNumber = normalizeText(mapped.student_number || mapped['رقم الطالب'] || mapped['الرقم'] || mapped['القيد'] || mapped['student no'] || mapped['student id']);
        const fullName = normalizeText(mapped.full_name || mapped['اسم الطالب'] || mapped['اسم الطالبة'] || mapped['الاسم'] || mapped['student name'] || mapped['name']);
        const fatherName = normalizeText(mapped.father_name || mapped['اسم الأب'] || mapped['father']);
        const motherName = normalizeText(mapped.mother_name || mapped['اسم الأم'] || mapped['mother']);
        const rawGender = normalizeText(mapped.gender || mapped['الجنس'] || mapped['النوع']);
        const gender = rawGender ? isValidGender(rawGender) : 'unknown';
        const religionValidation = importedFields.has('religion')
          ? normalizeExcelStudentReligion(mapped.religion ?? mapped['الديانة'] ?? mapped['الدين'] ?? mapped['faith'])
          : { ok: true as const, value: null };
        const birthDate = normalizeDate(mapped.birth_date || mapped['تاريخ الميلاد'] || mapped['birthdate']);
        const phone = normalizeText(mapped.phone || mapped['الهاتف'] || mapped['رقم الهاتف'] || mapped['mobile']);
        const guardianName = normalizeText(mapped.guardian_name || mapped['ولي الأمر'] || mapped['guardian']);
        const guardianPhone = normalizeText(mapped.guardian_phone || mapped['هاتف ولي الأمر']);
        const address = normalizeText(mapped.address || mapped['العنوان'] || mapped['السكن']);
        const excelClassName = normalizeText(mapped.class_name || mapped['الصف'] || mapped['المرحلة'] || mapped['class'] || mapped['grade']);
        const excelSectionName = normalizeText(mapped.section_name || mapped['الشعبة'] || mapped['القسم'] || mapped['section'] || mapped['group']);
        const notes = normalizeText(mapped.notes || mapped['ملاحظات'] || mapped['notes']);
        const status = isValidStatus(mapped.status || mapped['الحالة'] || mapped['status']) || 'active';
        if (classAssignmentMode === 'override') importedFields.add('class_name');
        if (sectionAssignmentMode === 'override') importedFields.add('section_name');
        const importsClassPlacement = classAssignmentMode === 'override'
          || importedFields.has('class_id')
          || importedFields.has('class_name');
        const importsSectionPlacement = sectionAssignmentMode === 'override'
          || importedFields.has('section_id')
          || importedFields.has('section_name');
        const importsPlacement = importsClassPlacement || importsSectionPlacement;

        if (!fullName) { rowError(i, 'full_name', 'اسم الطالب مطلوب'); hasFatal = true; }
        if (rawGender && !gender) { rowError(i, 'gender', 'قيمة الجنس غير صالحة'); hasFatal = true; }
        if (!religionValidation.ok) { rowError(i, 'religion', 'قيمة الديانة غير صالحة'); hasFatal = true; }
        if (!rawGender) rowWarn(i, 'gender', 'لم يُحدد الجنس؛ سيُحفظ بالقيمة الداخلية unknown');

        const className = classAssignmentMode === 'override'
          ? (classIdMap.get(Number(selected_class_id)) || null)
          : excelClassName;
        const classId = classAssignmentMode === 'override'
          ? Number(selected_class_id)
          : (className ? normalizedClassMap.get(normalizeStudentIdentity(className)) : null);
        if (!classId) {
          rowError(i, 'class_name', className ? `الصف "${className}" غير موجود في المدرسة` : 'الصف مطلوب'); hasFatal = true;
        }

        let sectionName: string | null = null;
        let sectionId: number | null = null;
        if (sectionAssignmentMode === 'override') {
          sectionId = Number(selected_section_id);
          sectionName = (existingSections.results || []).find((section: any) => section.id === sectionId)?.name || null;
        } else if (sectionAssignmentMode === 'excel') {
          sectionName = excelSectionName;
          const sectionKey = classId && sectionName ? `${classId}:${normalizeSectionName(sectionName)}` : null;
          sectionId = sectionKey ? (normalizedSectionMap.get(sectionKey) || null) : null;
          if (!sectionName) { rowError(i, 'section_name', 'الشعبة مطلوبة عند اختيار الاستيراد من Excel'); hasFatal = true; }
          else if (!sectionId) { rowError(i, 'section_name', `الشعبة "${sectionName}" غير موجودة في الصف "${className || ''}"`); hasFatal = true; }
        }

        if (classId) {
          const placement = await validateStudentPlacement(db, school_id, Number(classId), sectionId);
          if (!placement.ok) { rowError(i, 'class_section', placement.error); hasFatal = true; }
        }

        const duplicate = fullName ? findStudentDuplicate({ studentNumber, fullName, classId: classId || null, sectionId }, existingStudents.results || []) : { kind: 'none' as const };
        if (duplicate.kind === 'ambiguous') {
          rowError(i, 'full_name', 'يوجد أكثر من طالب مطابق؛ أضف رقم الطالب لحسم التكرار'); hasFatal = true;
        } else if (duplicate.kind === 'match') {
          const duplicateAction = studentDuplicateAction(mode, true);
          if (duplicateAction === 'error') {
            rowError(i, duplicate.matchedBy, 'الطالب موجود مسبقاً'); hasFatal = true;
          } else if (duplicateAction === 'skip') {
            duplicates.push({ row: excelRowNumber(i), student_number: duplicate.student.student_number, full_name: fullName, existing_id: duplicate.student.id });
            continue; // skip this row in preview
          }
        }

        const placementWouldChange = duplicate.kind === 'match'
          && (Number(classId) !== duplicate.student.class_id || sectionId !== duplicate.student.section_id);
        const needsActiveYear = duplicate.kind === 'none'
          || (duplicate.kind === 'match' && mode === 'update_existing' && importsPlacement && placementWouldChange);
        if (!hasFatal && !activeStudentImportYear && needsActiveYear) {
          rowError(i, 'academic_year', 'لا توجد سنة دراسية فعالة لإنشاء أو تحديث تسجيل الطالب');
          hasFatal = true;
        }

        const identity = fullName ? studentIdentityKey(fullName, classId || null, sectionId) : '';
        const duplicateInsideFile = studentNumber
          ? seenStudentNumbers.has(studentNumber)
          : Boolean(identity && seenStudentIdentities.has(identity));
        if (!hasFatal && duplicateInsideFile) {
          if (mode === 'skip_existing') {
            duplicates.push({ row: excelRowNumber(i), student_number: studentNumber, full_name: fullName, source: 'file' });
            continue;
          }
          rowError(i, studentNumber ? 'student_number' : 'full_name', studentNumber ? 'رقم القيد مكرر داخل الملف' : 'الطالب مكرر داخل الملف'); hasFatal = true;
        }
        if (!hasFatal) {
          if (studentNumber) seenStudentNumbers.add(studentNumber);
          else if (identity) seenStudentIdentities.add(identity);
        }

        const finalStudentNumber = studentNumber || (!hasFatal && fullName && classId ? await buildGeneratedStudentNumber(school_id, fullName, classId, sectionId) : null);
        if (!studentNumber && finalStudentNumber) rowWarn(i, 'student_number', `سيُنشأ رقم طالب داخلي: ${finalStudentNumber}`);
        record.row_index = excelRowNumber(i);
        record.data = {
          excel_row_number: excelRowNumber(i), student_number: finalStudentNumber, student_number_generated: !studentNumber,
          full_name: fullName, father_name: fatherName, mother_name: motherName, gender, birth_date: birthDate,
          religion: religionValidation.value, phone, guardian_name: guardianName, guardian_phone: guardianPhone, address, class_id: classId,
          section_id: sectionId, class_name: className, section_name: sectionName, notes, status,
          imported_fields: [...importedFields],
        };
      } else if (type === 'classes-sections') {
        const className = normalizeText(mapped.class_name || mapped['اسم الصف'] || mapped['الصف'] || mapped['class'] || mapped['name']);
        const stage = normalizeText(mapped.stage || mapped['المرحلة'] || mapped['stage'] || mapped['level']);
        const orderIndex = normalizeNumber(mapped.order_index || mapped['الترتيب'] || mapped['order']);
        const sectionName = normalizeText(mapped.section_name || mapped['الشعبة'] || mapped['section']);
        const capacity = normalizeNumber(mapped.capacity || mapped['السعة'] || mapped['capacity']);
        const status = isValidStatus(mapped.status || mapped['الحالة'] || mapped['status']) || 'active';

        if (!className) { rowError(i, 'class_name', 'اسم الصف مطلوب'); hasFatal = true; }
        if (!stage) { rowError(i, 'stage', 'المرحلة مطلوبة'); hasFatal = true; }

        record.data = { class_name: className, stage, order_index: orderIndex, section_name: sectionName, capacity, status };
      } else if (type === 'subjects') {
        const importedFields = new Set<string>(
          mapping && typeof mapping === 'object'
            ? Object.keys(mapping).filter(field => mapping[field])
            : Object.keys(mapped),
        );
        if (!mapping && RELIGIOUS_TRACK_HEADER_ALIASES.some((alias) => Object.prototype.hasOwnProperty.call(mapped, alias))) {
          importedFields.add('religious_track');
        }
        const subjectName = normalizeText(mapped.subject_name || mapped['المادة'] || mapped['اسم المادة'] || mapped['subject'] || mapped['name']);
        const className = normalizeText(mapped.class_name || mapped['الصف'] || mapped['class'] || mapped['grade']);
        const sectionName = normalizeText(mapped.section_name || mapped['الشعبة'] || mapped['section']);
        const subjectType = isValidSubjectType(mapped.subject_type || mapped['نوع المادة'] || mapped['type']);
        const rawReligiousTrack = mapped.religious_track
          ?? mapped['نوع مادة الديانة']
          ?? mapped['مسار الديانة']
          ?? mapped['religious track']
          ?? mapped['religious education track'];
        const religiousTrackValidation = importedFields.has('religious_track')
          ? normalizeExcelReligiousTrack(rawReligiousTrack)
          : { ok: true as const, value: null };
        const countsInAverage = normalizeBoolean(mapped.counts_in_average || mapped['تحسب في المعدل'] || mapped['counts']);
        const appearsInReportCard = normalizeBoolean(mapped.appears_in_report_card || mapped['تظهر في كشف العلامات'] || mapped['appears']);
        const passingGrade = normalizeNumber(mapped.passing_grade || mapped['درجة النجاح'] || mapped['passing']);
        const exemptionGrade = normalizeNumber(mapped.exemption_grade || mapped['درجة الإعفاء'] || mapped['exemption']);
        const orderIndex = normalizeNumber(mapped.order_index || mapped['الترتيب'] || mapped['order']);
        const status = isValidStatus(mapped.status || mapped['الحالة'] || mapped['status']) || 'active';

        if (!subjectName) { rowError(i, 'subject_name', 'اسم المادة مطلوب'); hasFatal = true; }
        if (!className) { rowError(i, 'class_name', 'الصف مطلوب'); hasFatal = true; }
        if (!religiousTrackValidation.ok) { rowError(i, 'religious_track', 'نوع مادة الديانة غير معروف'); hasFatal = true; }
        const classId = className ? classMap.get(className) : null;
        if (className && !classId) { rowError(i, 'class_name', `الصف "${className}" غير موجود`); hasFatal = true; }
        const sectionKey = classId && sectionName ? `${classId}:${sectionName}` : null;
        const sectionId = sectionKey ? sectionMap.get(sectionKey) : null;
        if (sectionName && classId && !sectionId) { rowError(i, 'section_name', `الشعبة "${sectionName}" غير موجودة في الصف "${className}"`); hasFatal = true; }

        const subjKey = `${classId}:${sectionId || ''}:${subjectName}`;
        if (classId && subjectMap.has(subjKey)) {
          if (mode === 'error_on_existing') {
            rowError(i, 'subject_name', 'المادة موجودة مسبقاً في هذا الصف والشعبة'); hasFatal = true;
          } else if (mode === 'skip_existing') {
            duplicates.push({ row: i + 1, subject_name: subjectName, class_name: className, section_name: sectionName });
            continue;
          }
        }

        record.data = { subject_name: subjectName, class_id: classId, class_name: className, section_id: sectionId, section_name: sectionName, subject_type: subjectType, religious_track: religiousTrackValidation.value, counts_in_average: countsInAverage, appears_in_report_card: appearsInReportCard, passing_grade: passingGrade, exemption_grade: exemptionGrade, order_index: orderIndex, status, imported_fields: [...importedFields] };
      } else if (type === 'employees') {
        const fullName = normalizeText(mapped.full_name || mapped['الاسم'] || mapped['اسم الموظف'] || mapped['name']);
        const gender = isValidGender(mapped.gender || mapped['الجنس']);
        const phone = isValidPhone(mapped.phone || mapped['الهاتف'] || mapped['رقم الهاتف'] || mapped['mobile']);
        const email = isValidEmail(mapped.email || mapped['البريد'] || mapped['email']);
        const address = normalizeText(mapped.address || mapped['العنوان'] || mapped['السكن']);
        const jobTitle = normalizeText(mapped.job_title || mapped['المسمى الوظيفي'] || mapped['job'] || mapped['position'] || mapped['الوظيفة']);
        const employeeType = isValidEmployeeType(mapped.employee_type || mapped['نوع الموظف'] || mapped['type']);
        const hireDate = normalizeDate(mapped.hire_date || mapped['تاريخ التعيين'] || mapped['hire']);
        const salaryAmount = normalizeNumber(mapped.salary_amount || mapped['الراتب'] || mapped['salary'] || mapped['الراتب الأساسي']);
        const salaryType = isValidSalaryType(mapped.salary_type || mapped['نوع الراتب']);
        const status = isValidStatus(mapped.status || mapped['الحالة'] || mapped['status']) || 'active';
        const notes = normalizeText(mapped.notes || mapped['ملاحظات'] || mapped['notes']);

        if (!fullName) { rowError(i, 'full_name', 'اسم الموظف مطلوب'); hasFatal = true; }
        if (email && !isValidEmail(email)) { rowError(i, 'email', 'البريد الإلكتروني غير صالح'); hasFatal = true; }
        if (phone && !isValidPhone(phone)) { rowError(i, 'phone', 'رقم الهاتف غير صالح'); hasFatal = true; }
        if (salaryAmount !== null && (salaryAmount < 0 || !Number.isInteger(salaryAmount))) { rowError(i, 'salary_amount', 'الراتب يجب أن يكون عدداً صحيحاً غير سالب'); hasFatal = true; }

        // Duplicate detection by email, phone, or full_name
        let dup = null;
        if (email && employeeEmailMap.has(email)) dup = employeeEmailMap.get(email);
        else if (phone && employeePhoneMap.has(phone)) dup = employeePhoneMap.get(phone);
        else if (fullName) {
          const nameMatch = (existingEmployees.results || []).find((e: any) => e.full_name === fullName);
          if (nameMatch) dup = nameMatch;
        }
        if (dup) {
          if (mode === 'error_on_existing') {
            rowError(i, 'full_name', 'موظف بنفس البيانات موجود مسبقاً'); hasFatal = true;
          } else if (mode === 'skip_existing') {
            duplicates.push({ row: i + 1, full_name: fullName, existing_id: dup.id });
            continue;
          }
        }

        record.data = { full_name: fullName, gender, phone, email, address, job_title: jobTitle, employee_type: employeeType, hire_date: hireDate, salary_amount: salaryAmount, salary_type: salaryType, status, notes };
      } else if (type === 'student-subjects') {
        const studentNumber = normalizeText(mapped.student_number || mapped['القيد'] || mapped['رقم الطالب'] || mapped['student_number']);
        const fullName = normalizeText(mapped.full_name || mapped['اسم الطالب'] || mapped['الاسم'] || mapped['student_name']);
        const className = normalizeText(mapped.class_name || mapped['الصف'] || mapped['class']);
        const sectionName = normalizeText(mapped.section_name || mapped['الشعبة'] || mapped['section']);
        const subjectName = normalizeText(mapped.subject_name || mapped['المادة'] || mapped['اسم المادة'] || mapped['subject']);
        const isActive = normalizeBoolean(mapped.is_active || mapped['الحالة'] || mapped['active']) !== false;
        const notes = normalizeText(mapped.notes || mapped['ملاحظات'] || mapped['notes']);

        // Resolve student
        let student = null;
        if (studentNumber) {
          student = findStudentByIdentifier(studentNumber, existingStudents.results || [], className, sectionName, classMap, sectionMap);
        } else if (fullName) {
          student = findStudentByIdentifier(fullName, existingStudents.results || [], className, sectionName, classMap, sectionMap);
        }
        if (!student) {
          rowError(i, 'student', 'الطالب غير موجود'); hasFatal = true;
        } else if (student && student._ambiguous) {
          rowError(i, 'student', 'يوجد أكثر من طالب بنفس الاسم، يرجى إضافة رقم الطالب'); hasFatal = true;
          student = null;
        }

        // Resolve class and section
        let classId = className ? classMap.get(className) : (student ? student.class_id : null);
        let sectionId = null;
        if (sectionName && classId) {
          const sKey = `${classId}:${sectionName}`;
          sectionId = sectionMap.get(sKey) || (student ? student.section_id : null);
        } else if (student) {
          sectionId = student.section_id;
        }
        if (className && !classId) { rowError(i, 'class_name', `الصف "${className}" غير موجود`); hasFatal = true; }
        if (sectionName && classId && !sectionId) { rowError(i, 'section_name', `الشعبة "${sectionName}" غير موجودة`); hasFatal = true; }

        // Resolve subject
        let subject = null;
        if (subjectName) {
          subject = matchSubjectByName(subjectName, existingSubjects.results || []);
        }
        if (!subject && !hasFatal) { rowError(i, 'subject', 'المادة غير موجودة'); hasFatal = true; }
        else if (subject && subject._ambiguous) { rowError(i, 'subject', 'يوجد أكثر من مادة مطابقة، يرجى اختيار المادة يدوياً'); hasFatal = true; subject = null; }

        if (student && subject && subject.religious_track != null && isActive && !hasFatal) {
          const plannedSubjectId = plannedReligiousStudentSubjects.get(Number(student.id));
          if (plannedSubjectId != null && plannedSubjectId !== Number(subject.id)) {
            rowError(i, 'subject', 'يحاول الملف تعيين أكثر من مادة ديانة فعالة للطالب نفسه');
            hasFatal = true;
          }
          const conflict = await findActiveReligiousAssignment(db, school_id, Number(student.id), {
            excludeSubjectId: Number(subject.id),
          });
          if (conflict) {
            rowError(i, 'subject', RELIGIOUS_SUBJECT_CONFLICT_ERROR);
            hasFatal = true;
          }
          if (!hasFatal) plannedReligiousStudentSubjects.set(Number(student.id), Number(subject.id));
        }

        // Check for existing assignment
        let existingAssignment = null;
        if (student && subject && !student._ambiguous && !subject._ambiguous) {
          const assignment = await db.prepare(`SELECT id, is_active, assigned_at FROM student_subjects WHERE school_id = ? AND student_id = ? AND subject_id = ?`).bind(school_id, student.id, subject.id).first<any>();
          if (assignment) existingAssignment = assignment;
        }

        if (existingAssignment && !hasFatal) {
          if (existingAssignment.is_active) {
            if (mode === 'error_on_existing') { rowError(i, 'assignment', 'التسجيل في المادة موجود مسبقاً'); hasFatal = true; }
            else if (mode === 'skip_existing') { duplicates.push({ row: i + 1, student_id: student.id, subject_id: subject.id, existing_assignment_id: existingAssignment.id }); continue; }
            // update_existing: reactivation not needed since already active, but we can update notes
          } else {
            // Inactive assignment
            if (mode === 'update_existing') {
              // Will reactivate
            } else if (mode === 'skip_existing') {
              duplicates.push({ row: i + 1, student_id: student.id, subject_id: subject.id, existing_assignment_id: existingAssignment.id }); continue;
            } else if (mode === 'error_on_existing') {
              rowError(i, 'assignment', 'التسجيل في المادة موجود مسبقاً (غير نشط)'); hasFatal = true;
            }
          }
        }

        if (!hasFatal && student && subject) {
          record.data = {
            student_id: student.id,
            subject_id: subject.id,
            class_id: classId || student.class_id || null,
            section_id: sectionId || student.section_id || null,
            is_active: isActive,
            notes: notes || null,
            existing_assignment_id: existingAssignment?.id || null,
            existing_assignment_is_active: existingAssignment?.is_active || false,
          };
          record._student_name = student.full_name;
          record._subject_name = subject.name;
        }
      }

      if (!hasFatal) {
        validRows.push(record);
      }
    }

    return c.json({
      data: {
        type,
        mode,
        total_rows: rows.length,
        valid_rows: validRows.length,
        error_rows: errors.length,
        duplicate_rows: duplicates.length,
        skipped_rows: skippedRows,
        valid: validRows,
        errors,
        warnings,
        duplicates,
      }
    });
  } catch (err: any) {
    return c.json({ error: 'فشل في معالجة المعاينة', detail: err.message }, 500);
  }
});

// ===========================================
// POST /api/import-export/:type/confirm
// ===========================================
app.post('/api/import-export/:type/confirm', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId');
  const scope: 'all' | 'single' = c.get('scope');
  const type = c.req.param('type');

  if (!user || !canImportExport(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية الاستيراد والتصدير' }, 403);
  }
  if (!PHASE13A_TYPES.includes(type)) {
    return c.json({ error: 'نوع الاستيراد غير مدعوم في هذه المرحلة' }, 400);
  }
  if (type === 'employees' && !canImportEmployees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية استيراد الموظفين' }, 403);
  }
  if (type === 'grades' && !canImportGrades(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية استيراد الدرجات' }, 403);
  }
  if (type === 'student-subjects' && !canImportStudentSubjects(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية استيراد تسجيل الطلاب في المواد' }, 403);
  }

  try {
    const body = await c.req.json();
    let { school_id, rows, mode, file_name, selected_class_id, selected_section_id, class_assignment_mode, section_assignment_mode } = body;
    const targetSchool = await resolveActiveWriteSchool(db, user, school_id);
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status);
    school_id = targetSchool.schoolId;
    if (type === 'grades') {
      const parsed = parseGradeImportPayload(body);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      const context = await loadGradeImportContext(db, school_id);
      const plan = buildGradeImportPlan(parsed.payload, context);
      if (plan.errors.length) {
        return c.json({ error: 'تعذر تأكيد الاستيراد لوجود أخطاء في الدرجات', data: gradeImportPreviewData(plan) }, 400);
      }
      const jobId = await executeGradeImportPlan(db, school_id, user.id, file_name || 'import.xlsx', plan);
      return c.json({
        data: {
          job_id: jobId,
          imported_count: plan.summary.new_grade_rows,
          skipped_count: plan.summary.noop_rows + plan.summary.not_applicable_rows,
          not_applicable_count: plan.summary.not_applicable_rows,
          updated_count: plan.summary.update_rows,
          error_count: 0,
          row_errors: [],
          sources: plan.sources,
          sheets: plan.sources,
          summary: plan.summary,
        },
      });
    }
    mode = mode || 'skip_existing';
    if (!Array.isArray(rows) || rows.length === 0) {
      return c.json({ error: 'لا يوجد بيانات للاستيراد' }, 400);
    }
    if (rows.length > 500) {
      return c.json({ error: 'عدد الصفوف كبير جداً، يرجى تقسيم الملف' }, 400);
    }

    const classAssignmentMode = class_assignment_mode || (selected_class_id ? 'override' : 'excel');
    const sectionAssignmentMode = section_assignment_mode || (selected_section_id ? 'override' : 'none');
    if (type === 'students') {
      if (!['excel', 'override'].includes(classAssignmentMode) || !['excel', 'override', 'none'].includes(sectionAssignmentMode)) {
        return c.json({ error: 'طريقة تحديد الصف أو الشعبة غير صالحة' }, 400);
      }
      if (classAssignmentMode === 'override' && !selected_class_id) return c.json({ error: 'يجب تحديد الصف للاستيراد' }, 400);
      if (sectionAssignmentMode === 'override' && !selected_section_id) return c.json({ error: 'يجب تحديد الشعبة للاستيراد' }, 400);
      if (classAssignmentMode === 'override' || sectionAssignmentMode === 'override') {
        const selectedPlacement = await validateStudentPlacement(
          db,
          school_id,
          selected_class_id ? Number(selected_class_id) : null,
          sectionAssignmentMode === 'override' ? Number(selected_section_id) : null,
        );
        if (!selectedPlacement.ok) return c.json({ error: selectedPlacement.error }, selectedPlacement.status);
      }
    }

    const fileName = file_name || 'import.xlsx';

    if (type === 'student-subjects') {
      const religiousPreflight = await preflightImportedReligiousAssignments(db, school_id, rows);
      if (!religiousPreflight.ok) {
        return c.json({ error: religiousPreflight.error, meta: religiousPreflight.meta }, religiousPreflight.status);
      }
      for (const row of religiousPreflight.religious_rows) {
        const studentId = row.student_id;
        const subjectId = row.subject_id;
        const assignmentValidation = await validateStudentSubjectAssignment(db, school_id, studentId, subjectId);
        if (!assignmentValidation.ok) return c.json({ error: assignmentValidation.error }, assignmentValidation.status);
      }
    }

    // Insert import job record
    const jobResult = await db.prepare(`
      INSERT INTO import_jobs (school_id, import_type, file_name, mode, status, total_rows, created_by_user_id, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, unixepoch())
    `).bind(school_id, type, fileName, mode, rows.length, user?.id || null).run();
    const jobId = jobResult.meta.last_row_id;

    const existingClasses = await db.prepare(`SELECT id, name FROM classes WHERE school_id = ? AND status = 'active'`).bind(school_id).all<any>();
    const existingSections = await db.prepare(`SELECT id, name, class_id FROM sections WHERE school_id = ? AND status = 'active'`).bind(school_id).all<any>();
    const existingStudents = type === 'students' || type === 'student-subjects'
      ? {
          results: (await listStudentsWithEffectivePlacement(db, { schoolId: school_id }))
            .filter(student => student.status !== 'archived'),
        }
      : await db.prepare(`SELECT id, student_number, full_name, father_name, mother_name, gender, birth_date, phone, guardian_name, guardian_phone, address, class_id, section_id, status, notes FROM students WHERE school_id = ? AND status != 'archived'`).bind(school_id).all<any>();
    const existingSubjects = await db.prepare(`SELECT s.id, s.name, s.class_id, s.section_id, s.religious_track FROM subjects s JOIN classes c ON s.class_id = c.id WHERE c.school_id = ? AND s.status != 'archived'`).bind(school_id).all<any>();
    const existingEmployees = await db.prepare(`SELECT id, full_name, email, phone FROM employees WHERE school_id = ? AND status != 'archived'`).bind(school_id).all<any>();

    const classMap = new Map((existingClasses.results || []).map((c: any) => [c.name, c.id]));
    const normalizedClassMap = new Map((existingClasses.results || []).map((c: any) => [normalizeStudentIdentity(c.name), c.id]));
    const sectionMap = new Map((existingSections.results || []).map((s: any) => [`${s.class_id}:${s.name}`, s.id]));
    const normalizedSectionMap = new Map((existingSections.results || []).map((s: any) => [`${s.class_id}:${normalizeSectionName(s.name)}`, s.id]));
    const studentMap = new Map((existingStudents.results || []).map((s: any) => [s.student_number, s]));
    const subjectMap = new Map((existingSubjects.results || []).map((s: any) => [`${s.class_id}:${s.section_id || ''}:${s.name}`, s.id]));
    const employeeEmailMap = new Map((existingEmployees.results || []).map((e: any) => [e.email, e]));
    const employeePhoneMap = new Map((existingEmployees.results || []).map((e: any) => [e.phone, e]));

    const employeeNameMap = new Map<string, any[]>();
    for (const e of (existingEmployees.results || [])) {
      const arr = employeeNameMap.get(e.full_name) || [];
      arr.push(e);
      employeeNameMap.set(e.full_name, arr);
    }

    let imported = 0;
    let skipped = 0;
    let updated = 0;
    let errorCount = 0;
    const rowErrors: any[] = [];
    const now = Math.floor(Date.now() / 1000);

    const confirmExcelRowNumber = (rowIndex: number) => Number(rows[rowIndex]?.excel_row_number || rows[rowIndex]?._excel_row_number || rows[rowIndex]?.data?.excel_row_number || rowIndex + 2);
    const rowError = (rowIndex: number, field: string, message: string) => {
      errorCount++;
      rowErrors.push({ row: confirmExcelRowNumber(rowIndex), field, message });
    };

    const confirmedStudentNumbers = new Set<string>();
    const confirmedStudentIdentities = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const d = row.data || row;
      try {
        if (type === 'students') {
          const fullName = normalizeText(d.full_name);
          if (!fullName) { rowError(i, 'full_name', 'اسم الطالب مطلوب'); continue; }
          const rawGender = normalizeText(d.gender);
          const gender = rawGender === 'unknown' ? 'unknown' : (isValidGender(rawGender) || (!rawGender ? 'unknown' : null));
          if (!gender) { rowError(i, 'gender', 'قيمة الجنس غير صالحة'); continue; }

          const importedFields = new Set<string>(Array.isArray(d.imported_fields) ? d.imported_fields : Object.keys(d));
          const religionValidation = importedFields.has('religion')
            ? validateStudentReligion(d.religion)
            : { ok: true as const, value: null };
          if (!religionValidation.ok) { rowError(i, 'religion', 'قيمة الديانة غير صالحة'); continue; }
          const importsClassPlacement = classAssignmentMode === 'override'
            || importedFields.has('class_id')
            || importedFields.has('class_name');
          const importsSectionPlacement = sectionAssignmentMode === 'override'
            || importedFields.has('section_id')
            || importedFields.has('section_name');

          const classId = classAssignmentMode === 'override'
            ? Number(selected_class_id)
            : (normalizeText(d.class_name) ? normalizedClassMap.get(normalizeStudentIdentity(d.class_name)) : Number(d.class_id || 0));
          if (!classId) { rowError(i, 'class_name', 'الصف مطلوب أو غير موجود في المدرسة'); continue; }

          let sectionId: number | null = null;
          if (sectionAssignmentMode === 'override') {
            sectionId = Number(selected_section_id);
          } else if (sectionAssignmentMode === 'excel') {
            const sectionName = normalizeText(d.section_name);
            const sectionKey = sectionName ? `${classId}:${normalizeSectionName(sectionName)}` : null;
            sectionId = sectionKey ? (normalizedSectionMap.get(sectionKey) || null) : Number(d.section_id || 0) || null;
            if (!sectionId) { rowError(i, 'section_name', 'الشعبة مطلوبة أو غير موجودة في الصف'); continue; }
          }
          const placement = await validateStudentPlacement(
            db,
            school_id,
            Number(classId),
            sectionId,
          );
          if (!placement.ok) {
            rowError(i, 'class_section', placement.error); continue;
          }

          const suppliedStudentNumber = d.student_number_generated ? null : normalizeText(d.student_number);
          const studentNumber = suppliedStudentNumber || await buildGeneratedStudentNumber(school_id, fullName, Number(classId), sectionId);
          const duplicate = findStudentDuplicate(
            { studentNumber: suppliedStudentNumber, fullName, classId: Number(classId), sectionId },
            existingStudents.results || [],
          );
          if (duplicate.kind === 'ambiguous') { rowError(i, 'full_name', 'يوجد أكثر من طالب مطابق؛ أضف رقم الطالب'); continue; }

          const identity = studentIdentityKey(fullName, Number(classId), sectionId);
          const duplicateInsideFile = suppliedStudentNumber
            ? confirmedStudentNumbers.has(studentNumber)
            : confirmedStudentIdentities.has(identity);
          if (duplicateInsideFile) {
            if (mode === 'skip_existing') { skipped++; continue; }
            rowError(i, suppliedStudentNumber ? 'student_number' : 'full_name', suppliedStudentNumber ? 'رقم القيد مكرر داخل الملف' : 'الطالب مكرر داخل الملف'); continue;
          }
          if (suppliedStudentNumber) confirmedStudentNumbers.add(studentNumber);
          else confirmedStudentIdentities.add(identity);

          const existing = duplicate.kind === 'match' ? duplicate.student : null;
          if (existing) {
            const duplicateAction = studentDuplicateAction(mode, true);
            if (duplicateAction === 'skip') { skipped++; continue; }
            if (duplicateAction === 'error') { rowError(i, duplicate.kind === 'match' ? duplicate.matchedBy : 'student', 'الطالب موجود مسبقاً'); continue; }
          }

          const keepOrImport = (field: string, fallback: any) => importedFields.has(field) ? (d[field] || null) : fallback;
          const studentValues: StudentWriteValues = {
            school_id,
            student_number: existing?.student_number || studentNumber,
            full_name: fullName,
            father_name: existing ? keepOrImport('father_name', existing.father_name) : (d.father_name || null),
            mother_name: existing ? keepOrImport('mother_name', existing.mother_name) : (d.mother_name || null),
            gender: existing && !importedFields.has('gender') ? existing.gender : gender,
            religion: existing && !importedFields.has('religion') ? existing.religion : religionValidation.value,
            birth_date: existing ? keepOrImport('birth_date', existing.birth_date) : (d.birth_date || null),
            phone: existing ? keepOrImport('phone', existing.phone) : (d.phone || null),
            guardian_name: existing ? keepOrImport('guardian_name', existing.guardian_name) : (d.guardian_name || null),
            guardian_phone: existing ? keepOrImport('guardian_phone', existing.guardian_phone) : (d.guardian_phone || null),
            address: existing ? keepOrImport('address', existing.address) : (d.address || null),
            class_id: Number(classId),
            section_id: sectionId,
            status: existing && !importedFields.has('status')
              ? (existing.status || 'active')
              : (isValidStatus(d.status) || 'active'),
            photo_url: existing?.photo_url || null,
            notes: existing ? keepOrImport('notes', existing.notes) : (d.notes || null),
          };
          const persistence = await persistStudentImportWithEnrollmentBridge(db, {
            existingStudent: existing,
            student: studentValues,
            placement: {
              hasClassId: Boolean(existing) && importsClassPlacement,
              hasSectionId: Boolean(existing) && (importsSectionPlacement || importsClassPlacement),
              class_id: Number(classId),
              section_id: sectionId,
            },
            userId: user.id,
          });
          if (!persistence.ok) {
            const message = persistence.code === 'active_year_required'
              ? 'لا توجد سنة دراسية فعالة لإنشاء أو تحديث تسجيل الطالب'
              : persistence.code === 'cannot_clear_enrollment'
                ? 'لا يمكن إزالة تسجيل الطالب من خلال استيراد Excel'
                : persistence.code === 'finalized_enrollment'
                  ? FINALIZED_ENROLLMENT_PLACEMENT_ERROR
                : 'لا يمكن تحديد الشعبة دون تحديد الصف';
            rowError(i, 'class_section', message);
            continue;
          }
          syncStudentImportState(existingStudents.results || [], studentMap, persistence.student);
          if (persistence.action === 'created') imported++;
          else updated++;
        } else if (type === 'classes-sections') {
          const className = normalizeText(d.class_name || d.name);
          const stage = normalizeText(d.stage);
          if (!className || !stage) { rowError(i, 'general', 'اسم الصف والمرحلة مطلوبان'); continue; }
          let existingClass = await db.prepare(`SELECT id FROM classes WHERE school_id = ? AND name = ? AND status != 'archived'`).bind(school_id, className).first<any>();
          if (existingClass) {
            if (mode === 'skip_existing') { skipped++; continue; }
            if (mode === 'error_on_existing') { rowError(i, 'class_name', 'الصف موجود مسبقاً'); continue; }
            // Update class
            await db.prepare(`UPDATE classes SET stage = ?, order_index = ?, status = ?, updated_at = unixepoch() WHERE id = ? AND school_id = ?`).bind(stage, d.order_index || 0, d.status || 'active', existingClass.id, school_id).run();
            updated++;
          } else {
            const clsRes = await db.prepare(`INSERT INTO classes (school_id, name, stage, order_index, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', unixepoch(), unixepoch())`).bind(school_id, className, stage, d.order_index || 0).run();
            existingClass = { id: clsRes.meta.last_row_id };
            imported++;
          }
          if (d.section_name) {
            const existingSection = await db.prepare(`SELECT id FROM sections WHERE school_id = ? AND class_id = ? AND name = ? AND status != 'archived'`).bind(school_id, existingClass.id, d.section_name).first<any>();
            if (existingSection) {
              if (mode === 'update_existing') {
                await db.prepare(`UPDATE sections SET capacity = ?, status = ?, updated_at = unixepoch() WHERE id = ? AND school_id = ?`).bind(d.capacity || null, d.status || 'active', existingSection.id, school_id).run();
              } else {
                skipped++; // section already exists
              }
            } else {
              await db.prepare(`INSERT INTO sections (school_id, class_id, name, capacity, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', unixepoch(), unixepoch())`).bind(school_id, existingClass.id, d.section_name, d.capacity || null).run();
              imported++;
            }
          }
        } else if (type === 'subjects') {
          const subjectName = normalizeText(d.subject_name || d.name);
          const classId = d.class_id || (d.class_name ? classMap.get(d.class_name) : null);
          if (!subjectName || !classId) { rowError(i, 'general', 'اسم المادة والصف مطلوبان'); continue; }
          const sectionKey = classId && d.section_name ? `${classId}:${d.section_name}` : null;
          const sectionId = sectionKey ? sectionMap.get(sectionKey) : (d.section_id || null);
          const placement = await validateStudentPlacement(
            db,
            school_id,
            Number(classId),
            sectionId ? Number(sectionId) : null,
          );
          if (!placement.ok) {
            rowError(i, 'class_section', placement.error); continue;
          }
          const importedFields = new Set<string>(Array.isArray(d.imported_fields) ? d.imported_fields : Object.keys(d));
          const religiousTrackValidation = importedFields.has('religious_track')
            ? validateReligiousTrack(d.religious_track)
            : { ok: true as const, value: null };
          if (!religiousTrackValidation.ok) { rowError(i, 'religious_track', 'نوع مادة الديانة غير صالح'); continue; }
          const existingSubj = await db.prepare(`SELECT id, religious_track FROM subjects WHERE school_id = ? AND class_id = ? AND (section_id IS ?) AND name = ? AND status != 'archived'`).bind(school_id, classId, sectionId || null, subjectName).first<any>();
          if (existingSubj) {
            if (mode === 'skip_existing') { skipped++; continue; }
            if (mode === 'error_on_existing') { rowError(i, 'subject_name', 'المادة موجودة مسبقاً'); continue; }
            const nextReligiousTrack = importedFields.has('religious_track')
              ? religiousTrackValidation.value
              : existingSubj.religious_track;
            if (nextReligiousTrack != null && nextReligiousTrack !== existingSubj.religious_track) {
              const conflicts = await countSubjectReligiousConversionConflicts(db, school_id, existingSubj.id);
              if (conflicts > 0) {
                rowError(i, 'religious_track', `يتعارض نوع مادة الديانة مع تعيينات ${conflicts} طالب/طلاب`);
                continue;
              }
            }
            await db.prepare(`
              UPDATE subjects SET subject_type = ?, religious_track = ?, counts_in_average = ?, appears_in_report_card = ?, passing_grade = ?, exemption_grade = ?, order_index = ?, status = ?, updated_at = unixepoch()
              WHERE id = ? AND school_id = ?
            `).bind(d.subject_type || 'core', nextReligiousTrack, d.counts_in_average ?? 1, d.appears_in_report_card ?? 1, d.passing_grade || null, d.exemption_grade || null, d.order_index || 0, d.status || 'active', existingSubj.id, school_id).run();
            updated++;
          } else {
            const subjType = isValidSubjectType(d.subject_type) || 'core';
            const countsAvg = d.counts_in_average != null ? (d.counts_in_average ? 1 : 0) : 1;
            const appearsRC = d.appears_in_report_card != null ? (d.appears_in_report_card ? 1 : 0) : 1;
            const passGrade = normalizeNumber(d.passing_grade) ?? 50;
            const exemptGrade = normalizeNumber(d.exemption_grade) ?? 25;
            const orderIdx = normalizeNumber(d.order_index) ?? 0;
            const subjStatus = isValidStatus(d.status) || 'active';
            await db.prepare(`
              INSERT INTO subjects (school_id, class_id, section_id, name, subject_type, religious_track, counts_in_average, appears_in_report_card, passing_grade, exemption_grade, order_index, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
            `).bind(school_id, classId, sectionId || null, subjectName, subjType, religiousTrackValidation.value, countsAvg, appearsRC, passGrade, exemptGrade, orderIdx, subjStatus).run();
            imported++;
          }
        } else if (type === 'employees') {
          const fullName = normalizeText(d.full_name);
          if (!fullName) { rowError(i, 'full_name', 'اسم الموظف مطلوب'); continue; }
          const email = isValidEmail(d.email);
          const phone = isValidPhone(d.phone);
          const gender = isValidGender(d.gender);
          const employeeType = isValidEmployeeType(d.employee_type) || 'other';
          const salaryType = isValidSalaryType(d.salary_type) || 'monthly';
          const salaryAmount = normalizeNumber(d.salary_amount) ?? 0;
          const hireDate = normalizeDate(d.hire_date);
          const empStatus = isValidStatus(d.status) || 'active';
          let dup = null;
          if (email && employeeEmailMap.has(email)) dup = employeeEmailMap.get(email);
          else if (phone && employeePhoneMap.has(phone)) dup = employeePhoneMap.get(phone);
          else if (fullName) {
            const arr = employeeNameMap.get(fullName) || [];
            if (arr.length > 0) dup = arr[0];
          }
          if (dup) {
            if (mode === 'skip_existing') { skipped++; continue; }
            if (mode === 'error_on_existing') { rowError(i, 'full_name', 'موظف بنفس البيانات موجود مسبقاً'); continue; }
            await db.prepare(`
              UPDATE employees SET full_name = ?, gender = ?, phone = ?, email = ?, address = ?, job_title = ?, employee_type = ?, salary_type = ?, salary_amount = ?, hire_date = ?, status = ?, notes = ?, updated_at = unixepoch()
              WHERE id = ? AND school_id = ?
            `).bind(fullName, gender || null, phone || null, email || null, d.address || null, d.job_title || null, employeeType, salaryType, salaryAmount, hireDate || null, empStatus, d.notes || null, dup.id, school_id).run();
            updated++;
          } else {
            await db.prepare(`
              INSERT INTO employees (school_id, full_name, employee_number, gender, phone, email, address, job_title, role, employee_type, salary_type, salary_amount, hire_date, status, notes, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'staff', ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
            `).bind(school_id, fullName, null, gender || null, phone || null, email || null, d.address || null, d.job_title || null, employeeType, salaryType, salaryAmount, hireDate || null, empStatus, d.notes || null).run();
            imported++;
          }
        } else if (type === 'student-subjects') {
          const studentId = d.student_id;
          const subjectId = d.subject_id;
          if (!studentId || !subjectId) { rowError(i, 'general', 'بيانات التسجيل غير كاملة'); continue; }

          const assignmentValidation = await validateStudentSubjectAssignment(
            db,
            school_id,
            Number(studentId),
            Number(subjectId),
          );
          if (!assignmentValidation.ok) {
            rowError(i, 'assignment', assignmentValidation.error); continue;
          }

          const subject = await db.prepare(`SELECT religious_track FROM subjects WHERE id = ? AND school_id = ?`)
            .bind(subjectId, school_id)
            .first<{ religious_track: ReligiousTrack | null }>();
          if (d.is_active !== false && subject?.religious_track != null) {
            const conflict = await findActiveReligiousAssignment(db, school_id, Number(studentId), { excludeSubjectId: Number(subjectId) });
            if (conflict) { rowError(i, 'assignment', RELIGIOUS_SUBJECT_CONFLICT_ERROR); continue; }
          }

          const existingAssignment = await db.prepare(`SELECT id, is_active FROM student_subjects WHERE school_id = ? AND student_id = ? AND subject_id = ?`).bind(school_id, studentId, subjectId).first<any>();

          if (existingAssignment) {
            if (existingAssignment.is_active) {
              if (mode === 'error_on_existing') { rowError(i, 'assignment', 'التسجيل في المادة موجود مسبقاً'); continue; }
              if (mode === 'skip_existing') { skipped++; continue; }
              // update_existing: update notes only
              await db.prepare(`UPDATE student_subjects SET notes = ?, updated_at = unixepoch() WHERE id = ? AND school_id = ?`).bind(d.notes || null, existingAssignment.id, school_id).run();
              updated++;
            } else {
              if (mode === 'error_on_existing') { rowError(i, 'assignment', 'التسجيل في المادة موجود مسبقاً (غير نشط)'); continue; }
              if (mode === 'skip_existing') { skipped++; continue; }
              // update_existing: reactivate
              await db.prepare(`
                UPDATE student_subjects SET is_active = 1, assigned_by_user_id = ?, assigned_at = unixepoch(), updated_at = unixepoch(), notes = ?
                WHERE id = ? AND school_id = ?
              `).bind(user?.id || null, d.notes || null, existingAssignment.id, school_id).run();
              updated++;
            }
          } else {
            await db.prepare(`
              INSERT INTO student_subjects (school_id, student_id, subject_id, class_id, section_id, is_active, assigned_by_user_id, assigned_at, notes, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), ?, unixepoch(), unixepoch())
            `).bind(school_id, studentId, subjectId, assignmentValidation.class_id, assignmentValidation.section_id, d.is_active !== false ? 1 : 0, user?.id || null, d.notes || null).run();
            imported++;
          }
        }
      } catch (err: any) {
        rowError(i, 'general', err.message || 'خطأ غير متوقع');
      }
    }

    const summary = {
      imported_count: imported,
      skipped_count: skipped,
      updated_count: updated,
      error_count: errorCount,
      row_errors: rowErrors,
    };

    await db.prepare(`
      UPDATE import_jobs SET status = ?, valid_rows = ?, imported_rows = ?, skipped_rows = ?, updated_rows = ?, error_rows = ?, summary_json = ?, completed_at = unixepoch()
      WHERE id = ? AND school_id = ?
    `).bind(errorCount > 0 ? 'completed' : 'completed', rows.length - errorCount, imported, skipped, updated, errorCount, JSON.stringify(summary), jobId, school_id).run();

    return c.json({ data: { job_id: jobId, ...summary } });
  } catch (err: any) {
    return c.json({ error: 'فشل في تأكيد الاستيراد', detail: err.message }, 500);
  }
});

// ===========================================
// GET /api/import-export/:type/export
// ===========================================
app.get('/api/import-export/:type/export', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId');
  const scope: 'all' | 'single' = c.get('scope');
  const type = c.req.param('type');

  if (!user || !canExport(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية التصدير' }, 403);
  }
  if (!PHASE13A_TYPES.includes(type)) {
    return c.json({ error: 'نوع التصدير غير مدعوم في هذه المرحلة' }, 400);
  }

  const schoolId = c.req.query('school_id') ? parseInt(c.req.query('school_id')!, 10) : (scope === 'single' ? resolvedSchoolId : null);
  if (!schoolId) {
    return c.json({ error: 'المدرسة مطلوبة للتصدير' }, 400);
  }

  try {
    let rows: any[] = [];
    if (type === 'students') {
      const res = await db.prepare(`
        SELECT s.student_number, s.full_name, s.father_name, s.mother_name, s.gender, s.religion, s.birth_date, s.phone, s.guardian_name, s.guardian_phone, s.address, s.notes, s.status, c.name as class_name, sec.name as section_name
        FROM students s
        LEFT JOIN classes c ON s.class_id = c.id
        LEFT JOIN sections sec ON s.section_id = sec.id
        WHERE s.school_id = ? AND s.status != 'archived'
        ORDER BY s.id
      `).bind(schoolId).all<any>();
      rows = res.results || [];
    } else if (type === 'classes-sections') {
      const res = await db.prepare(`
        SELECT c.name as class_name, c.stage, c.order_index, c.status, s.name as section_name, s.capacity as section_capacity
        FROM classes c
        LEFT JOIN sections s ON c.id = s.class_id AND s.status != 'archived'
        WHERE c.school_id = ? AND c.status != 'archived'
        ORDER BY c.order_index, c.id, s.name
      `).bind(schoolId).all<any>();
      rows = res.results || [];
    } else if (type === 'subjects') {
      const res = await db.prepare(`
        SELECT s.name as subject_name, c.name as class_name, sec.name as section_name, s.subject_type, s.religious_track, s.counts_in_average, s.appears_in_report_card, s.passing_grade, s.exemption_grade, s.order_index, s.status
        FROM subjects s
        JOIN classes c ON s.class_id = c.id
        LEFT JOIN sections sec ON s.section_id = sec.id
        WHERE c.school_id = ? AND s.status != 'archived'
        ORDER BY c.order_index, c.id, s.order_index, s.id
      `).bind(schoolId).all<any>();
      rows = res.results || [];
    } else if (type === 'employees') {
      const res = await db.prepare(`
        SELECT full_name, gender, phone, email, address, job_title, employee_type, salary_type, salary_amount, hire_date, status, notes
        FROM employees
        WHERE school_id = ? AND status != 'archived'
        ORDER BY id
      `).bind(schoolId).all<any>();
      rows = res.results || [];
    } else if (type === 'grades') {
      const res = await db.prepare(`
        SELECT st.student_number, st.full_name as student_name, c.name as class_name, sec.name as section_name, s.name as subject_name,
               g.first_term_grade, g.first_month, g.second_month, g.second_term_grade, g.third_month, g.fourth_month, g.mid_year_exam, g.final_exam, g.completion_exam,
               g.first_term_average, g.second_term_average, g.annual_effort, g.final_grade, g.grade_after_completion, g.effective_grade, g.result_status, g.exemption_status, g.notes
        FROM grades g
        JOIN student_subjects ss ON g.student_subject_id = ss.id
        JOIN students st ON ss.student_id = st.id
        JOIN subjects s ON ss.subject_id = s.id
        LEFT JOIN classes c ON st.class_id = c.id
        LEFT JOIN sections sec ON st.section_id = sec.id
        WHERE g.school_id = ? AND g.is_active = 1 AND st.status != 'archived'
        ORDER BY st.id, s.order_index, s.id
      `).bind(schoolId).all<any>();
      rows = res.results || [];
    } else if (type === 'student-subjects') {
      const res = await db.prepare(`
        SELECT st.student_number, st.full_name as student_name, c.name as class_name, sec.name as section_name, s.name as subject_name,
               ss.is_active, ss.assigned_at, ss.notes
        FROM student_subjects ss
        JOIN students st ON ss.student_id = st.id
        JOIN subjects s ON ss.subject_id = s.id
        LEFT JOIN classes c ON st.class_id = c.id
        LEFT JOIN sections sec ON st.section_id = sec.id
        WHERE ss.school_id = ? AND st.status != 'archived'
        ORDER BY st.id, s.order_index, s.id
      `).bind(schoolId).all<any>();
      rows = res.results || [];
    }
    return c.json({ data: { type, school_id: schoolId, rows } });
  } catch (err: any) {
    return c.json({ error: 'فشل في التصدير', detail: err.message }, 500);
  }
});

// ===========================================
// GET /api/import-export/jobs
// ===========================================
app.get('/api/import-export/jobs', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId');
  const scope: 'all' | 'single' = c.get('scope');

  if (!user || !canImportExport(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية الاستيراد والتصدير' }, 403);
  }

  try {
    let sql = `SELECT * FROM import_jobs WHERE 1=1`;
    const params: any[] = [];
    if (scope === 'single' && resolvedSchoolId) {
      sql += ` AND school_id = ?`;
      params.push(resolvedSchoolId);
    }
    sql += ` ORDER BY created_at DESC`;
    const res = await db.prepare(sql).bind(...params).all<any>();
    return c.json({ data: res.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب سجل الاستيراد', detail: err.message }, 500);
  }
});

// ===========================================
// GET /api/import-export/jobs/:id
// ===========================================
app.get('/api/import-export/jobs/:id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = c.req.param('id');

  if (!user || !canImportExport(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية الاستيراد والتصدير' }, 403);
  }

  try {
    const row = await db.prepare(`SELECT * FROM import_jobs WHERE id = ?`).bind(id).first<any>();
    if (!row) return c.json({ error: 'السجل غير موجود' }, 404);
    if (scope === 'single' && resolvedSchoolId && row.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح: السجل تابع لمدرسة أخرى' }, 403);
    }
    return c.json({ data: row });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب تفاصيل السجل', detail: err.message }, 500);
  }
});

export default app
