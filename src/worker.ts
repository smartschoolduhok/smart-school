Warning: truncated output (original token count: 164051)
Total output lines: 13495

// ===========================================
// Hono Backend - Phase 2.6 (Auth Hardening)
// Cloudflare Pages Worker with D1 Database
// JWT Bearer Token Authentication via Web Crypto
// ===========================================

import { Hono } from 'hono'
import { registerFinanceRoutes } from './lib/financeFeesDb'
import { parseWeekRequest, planWeekSetup, publicWeekSnapshot, WeekSetupError } from './lib/weekSetup'
import { loadWeekSetup, buildWeekApplyStatements, readWeekJson, weekDatabaseError } from './lib/weekSetupDb'
import { parseMatrixRequest, parseMatrixCopyRequest, planTeachingLoadMatrix, planTeachingLoadCopy, MAX_MATRIX_CHANGES } from './lib/teachingLoadMatrix'
import { loadTeachingLoadMatrix, publicTeachingLoadMatrix, loadMatrixCopySource, buildMatrixApplyStatements, MatrixError, matrixDatabaseError, staleMatrixError } from './lib/teachingLoadMatrixDb'
import { serveStatic } from 'hono/cloudflare-workers'
import type { RoleKey } from './types'
import {
  ACADEMIC_ACCESS_ROLES,
  ACADEMIC_MANAGEMENT_ROLES,
  ANALYTICS_ACCESS_ROLES,
  DASHBOARD_ACCESS_ROLES,
  EMPLOYEE_ACCESS_ROLES,
  EMPLOYEE_MANAGEMENT_ROLES,
  EMPLOYEE_SALARY_ROLES,
  FINANCE_ACCESS_ROLES,
  GRADE_MANAGEMENT_ROLES,
  OFFICIAL_BOOK_ACCESS_ROLES,
  OFFICIAL_BOOK_VIEW_ROLES,
  RESULT_CARD_MANAGEMENT_ROLES,
  RESULT_CARD_PRINT_ROLES,
  RESULT_CARD_VIEW_ROLES,
  SCHOOL_MANAGEMENT_ROLES,
  STUDENT_DIRECTORY_ROLES,
  STUDENT_RESOURCE_VIEW_ROLES,
  GRADE_VIEW_ROLES,
  SETTINGS_MANAGEMENT_ROLES,
  SETTINGS_VIEW_ROLES,
  USER_DIRECTORY_ROLES,
  hasRole,
} from './lib/rbac'
import {
  teacherAssignmentAccessSql,
  accessibleGradeIds,
  accessibleStudentIds,
  canAccessGradeResource,
  canAccessStudentResource,
} from './lib/resourceAccess'
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
import {
  academicStatusLabel,
  evaluateStudentAcademicPolicy,
  ministerialEligibilityLabel,
  validateAcademicGradePolicy,
  type AcademicGradePolicy,
  type StudentAcademicPolicyOutcome,
} from './lib/gradePolicy'
import {
  summarizePublishedAcademicOutcomes,
  type PublishedAcademicOutcomeRow,
  type PublishedTransitionRow,
} from './lib/publishedAcademicAnalytics'
import {
  calculatePolicyGradeRow,
  gradeCalculationSettingsForPolicy,
  loadAcademicPolicyOutcomes,
  loadCurrentAcademicGradePolicies,
  normalizeAcademicGradePolicyRow,
  resolveAcademicYearId,
} from './lib/gradePolicyDb'
import { RECALCULATE_SCHOOL_GRADES_SQL } from './lib/gradeRecalculationSql'
import {
  DEFAULT_GRADE_SCHEME_SETTINGS,
  disabledRawGradeFields,
  normalizeGradeSchemeSettings,
  RAW_GRADE_FIELD_LABELS,
  validateGradeSchemeSettings,
} from './lib/gradeScheme'
import {
  buildOfficialResultCardColumns,
  buildResultCardColumns,
  normalizeResultCardDecisionNote,
  normalizeResultCardDisplaySettings,
  omitUnusedResultCardDecisionColumns,
  parseResultCardDisplaySettings,
  resultCardHasDecisionPoints,
  validateResultCardCustomText,
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
import {
  executeOfficialStudentPromotion,
  listOfficialPromotionDecisions,
  previewOfficialStudentPromotion,
} from './lib/officialPromotion'
import {
  executeOfficialBulkStudentPromotion,
  previewOfficialBulkStudentPromotion,
} from './lib/officialBulkPromotion'
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

export type Bindings = {
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

export type Variables = {
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
      + 'r.key AS role_key, r.name AS role_name, s.name AS school_name '
      + 'FROM users u LEFT JOIN roles r ON u.role_id = r.id '
      + 'LEFT JOIN schools s ON s.id = u.school_id WHERE LOWER(u.email) = ?',
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
      school_name: string | null;
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
          school_name: row.school_name,
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
// API ROUTES: Resource access links
// ===========================================
app.get('/api/access-links', requireSameSchoolOrAdmin(), requireRoles(SCHOOL_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const schoolId: number | null = c.get('resolvedSchoolId')
  if (schoolId == null) return c.json({ error: 'يجب تحديد المدرسة المستهدفة' }, 400)

  try {
    const [parentLinks, teacherLinks, parents, students, teacherUsers, teacherEmployees] = await Promise.all([
      db.prepare(`
        SELECT link.id, link.parent_user_id, link.student_id, link.relationship,
               parent.full_name AS parent_name, student.full_name AS student_name,
               student.student_number
        FROM parent_student_links link
        JOIN users parent ON parent.id = link.parent_user_id
        JOIN students student ON student.id = link.student_id
        WHERE link.school_id = ? AND link.status = 'active'
        ORDER BY parent.full_name, student.full_name, link.id
      `).bind(schoolId).all(),
      db.prepare(`
        SELECT link.id, link.teacher_user_id, link.employee_id,
               teacher_user.full_name AS user_name, employee.full_name AS employee_name,
               employee.employee_number
        FROM teacher_employee_links link
        JOIN users teacher_user ON teacher_user.id = link.teacher_user_id
        JOIN employees employee ON employee.id = link.employee_id
        WHERE link.school_id = ? AND link.status = 'active'
        ORDER BY teacher_user.full_name, link.id
      `).bind(schoolId).all(),
      db.prepare(`
        SELECT user_record.id, user_record.full_name, user_record.email
        FROM users user_record
        JOIN roles role_record ON role_record.id = user_record.role_id
        WHERE user_record.school_id = ? AND user_record.status = 'active' AND role_record.key = 'parent'
        ORDER BY user_record.full_name, user_record.id
      `).bind(schoolId).all(),
      db.prepare(`
        SELECT id, full_name, student_number
        FROM students
        WHERE school_id = ? AND status = 'active'
        ORDER BY full_name, id
      `).bind(schoolId).all(),
      db.prepare(`
        SELECT user_record.id, user_record.full_name, user_record.email
        FROM users user_record
        JOIN roles role_record ON role_record.id = user_record.role_id
        WHERE user_record.school_id = ? AND user_record.status = 'active' AND role_record.key = 'teacher'
        ORDER BY user_record.full_name, user_record.id
      `).bind(schoolId).all(),
      db.prepare(`
        SELECT id, full_name, employee_number
        FROM employees
        WHERE school_id = ? AND status = 'active' AND role = 'teacher'
        ORDER BY full_name, id
      `).bind(schoolId).all(),
    ])

    return c.json({
      data: {
        parent_links: parentLinks.results || [],
        teacher_links: teacherLinks.results || [],
        parents: parents.results || [],
        students: students.results || [],
        teacher_users: teacherUsers.results || [],
        teacher_employees: teacherEmployees.results || [],
      },
    })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب روابط الوصول', detail: err.message }, 500)
  }
})

app.post('/api/access-links/parents', requireSameSchoolOrAdmin(), requireRoles(SCHOOL_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user = c.get('user') as UserContext
  try {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: 'بيانات الربط غير صالحة' }, 400)
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    const parentUserId = Number(body.parent_user_id)
    const studentId = Number(body.student_id)
    const relationship = typeof body.relationship === 'string' ? body.relationship.trim() : ''
    if (!Number.isInteger(parentUserId) || parentUserId <= 0 || !Number.isInteger(studentId) || studentId <= 0) {
      return c.json({ error: 'يجب اختيار حساب ولي الأمر والطالب' }, 400)
    }
    if (relationship.length > 100) return c.json({ error: 'صلة القرابة طويلة جدًا' }, 400)

    const link = await db.prepare(`
      INSERT INTO parent_student_links (
        school_id, parent_user_id, student_id, relationship, status, created_by_user_id
      ) VALUES (?, ?, ?, ?, 'active', ?)
      ON CONFLICT(school_id, parent_user_id, student_id) DO UPDATE SET
        relationship = excluded.relationship,
        status = 'active',
        updated_at = unixepoch()
      RETURNING id, school_id, parent_user_id, student_id, relationship, status
    `).bind(
      targetSchool.schoolId,
      parentUserId,
      studentId,
      relationship || null,
      user.id,
    ).first()
    return c.json({ data: link }, 201)
  } catch (err: any) {
    const message = String(err?.message || '')
    if (/parent access (user|student|creator) invalid/i.test(message)) {
      return c.json({ error: 'تعذر إنشاء الربط: تأكد من أن الحساب والطالب نشطان ويتبعان المدرسة نفسها' }, 400)
    }
    return c.json({ error: 'فشل في ربط ولي الأمر بالطالب', detail: message }, 500)
  }
})

app.delete('/api/access-links/parents/:id', requireSameSchoolOrAdmin(), requireRoles(SCHOOL_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const schoolId: number | null = c.get('resolvedSchoolId')
  const id = Number(c.req.param('id'))
  if (schoolId == null) return c.json({ error: 'يجب تحديد المدرسة المستهدفة' }, 400)
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'معرف الربط غير صالح' }, 400)
  try {
    const result = await db.prepare(`
      UPDATE parent_student_links
      SET status = 'inactive', updated_at = unixepoch()
      WHERE id = ? AND school_id = ? AND status = 'active'
    `).bind(id, schoolId).run()
    if (Number(result.meta?.changes || 0) !== 1) return c.json({ error: 'الربط غير موجود أو ملغى مسبقًا' }, 404)
    return c.json({ data: { id, status: 'inactive' } })
  } catch (err: any) {
    return c.json({ error: 'فشل في إلغاء ربط ولي الأمر', detail: err.message }, 500)
  }
})

app.post('/api/access-links/teachers', requireSameSchoolOrAdmin(), requireRoles(SCHOOL_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const user = c.get('user') as UserContext
  try {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: 'بيانات الربط غير صالحة' }, 400)
    const targetSchool = await resolveActiveWriteSchool(db, user, body.school_id)
    if (!targetSchool.ok) return c.json({ error: targetSchool.error }, targetSchool.status)
    const teacherUserId = Number(body.teacher_user_id)
    const employeeId = Number(body.employee_id)
    if (!Number.isInteger(teacherUserId) || teacherUserId <= 0 || !Number.isInteger(employeeId) || employeeId <= 0) {
      return c.json({ error: 'يجب اختيار حساب المدرس وسجل الموظف' }, 400)
    }

    const link = await db.prepare(`
      INSERT INTO teacher_employee_links (
        school_id, teacher_user_id, employee_id, status, created_by_user_id
      ) VALUES (?, ?, ?, 'active', ?)
      ON CONFLICT(school_id, teacher_user_id) DO UPDATE SET
        employee_id = excluded.employee_id,
        status = 'active',
        updated_at = unixepoch()
      RETURNING id, school_id, teacher_user_id, employee_id, status
    `).bind(targetSchool.schoolId, teacherUserId, employeeId, user.id).first()
    return c.json({ data: link }, 201)
  } catch (err: any) {
    const message = String(err?.message || '')
    if (/teacher access (user|employee|creator) invalid|UNIQUE constraint failed/i.test(message)) {
      return c.json({ error: 'تعذر إنشاء الربط: تأكد من الحساب وسجل المدرس ومن عدم ربطهما مسبقًا' }, 400)
    }
    return c.json({ error: 'فشل في ربط حساب المدرس', detail: message }, 500)
  }
})

app.delete('/api/access-links/teachers/:id', requireSameSchoolOrAdmin(), requireRoles(SCHOOL_MANAGEMENT_ROLES), async (c) => {
  const db = c.env.DB
  const schoolId: number | null = c.get('resolvedSchoolId')
  const id = Number(c.req.param('id'))
  if (schoolId == null) return c.json({ error: 'يجب تحديد المدرسة المستهدفة' }, 400)
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'معرف الربط غير صالح' }, 400)
  try {
    const result = await db.prepare(`
      UPDATE teacher_employee_links
      SET status = 'inactive', updated_at = unixepoch()
      WHERE id = ? AND school_id = ? AND status = 'active'
    `).bind(id, schoolId).run()
    if (Number(result.meta?.changes || 0) !== 1) return c.json({ error: 'الربط غير موجود أو ملغى مسبقًا' }, 404)
    return c.json({ data: { id, status: 'inactive' } })
  } catch (err: any) {
    return c.json({ error: 'فشل في إلغاء ربط المدرس', detail: err.message }, 500)
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
app.get('/api/timetable/week-setup', requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
  try {
    const query = c.req.queries()
    if (Object.entries(query).some(([key, values]) => !['school_id', 'academic_year_id'].includes(key) || values.length !== 1 || !/^[1-9]\d*$/.test(values[0]) || !Number.isSafeInteger(Number(values[0]))))
      throw new WeekSetupError('invalid_week_scope', 'حدد المدرسة والسنة بمعرّفات صحيحة.')
    const year = Number(c.req.query('academic_year_id'))
    if (!Number.isSafeInteger(year) || year <= 0) throw new WeekSetupError('invalid_week_scope', 'السنة الدراسية مطلوبة.')
    const target = await resolveActiveWriteSchool(c.env.DB, c.get('user') as UserContext, c.req.query('school_id'))
    if (!target.ok) return c.json({error: target.error}, target.status)
    return c.json({data: publicWeekSnapshot(await loadWeekSetup(c.env.DB, target.schoolId, year))})
  } catch (error) {
    const known = weekDatabaseError(error)
    if (!known) console.error('[timetable/week-setup] read failed', error)
    return c.json({error: known?.message ?? 'تعذر تحميل إعداد الأسبوع.', code: known?.code ?? 'week_load_failed'}, known?.status ?? 500)
  }
})
for (const operation of ['preview', 'apply'] as const) {
  app.post(`/api/timetable/week-setup/${operation}`, requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES), async (c) => {
    try {
      const input = parseWeekRequest(await readWeekJson(c.req.raw), operation === 'apply')
      const target = await resolveActiveWriteSchool(c.env.DB, c.get('user') as UserContext, input.school_id)
      if (!target.ok) return c.json({error: target.error}, target.status)
      const context = await loadWeekSetup(c.env.DB, target.schoolId, input.academic_year_id)
      const plan = await planWeekSetup(context, {...input, school_id: target.schoolId})
      if (operation === 'preview') return c.json({data: plan})
      if (plan.preview_digest !== input.preview_digest) throw new WeekSetupError('week_preview_mismatch', 'تغيرت المسودة أو المعاينة. اطلب معاينة جديدة.', 409)
      if (!plan.can_…114051 tokens truncated…ب الرسمية' }, 403);
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

    // Shared print history must not bypass the private finance gate. Leave
    // non-financial document access unchanged; no admin-wide receipt listing.
    if (!hasRole(user.role_key, FINANCE_ACCESS_ROLES) || scope !== 'single' || !resolvedSchoolId) {
      sql += ` AND pr.print_type IS NOT 'receipt' AND coalesce(pr.source_type,'') != 'fee_receipts'`;
    }

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
  const academicYearId = await resolveAcademicYearId(db, schoolId, null);
  const policies = academicYearId
    ? await loadCurrentAcademicGradePolicies(db, schoolId, academicYearId)
    : [];
  const settingsByClass = Object.fromEntries(policies.map(policy => [
    Number(policy.class_id),
    gradeCalculationSettingsForPolicy(settings, policy),
  ]));
  return {
    schoolId,
    settings,
    settingsByClass,
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
