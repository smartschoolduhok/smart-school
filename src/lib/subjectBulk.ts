import { validateReligiousTrack, type ReligiousTrack } from './religiousSubjects';

export const MAX_BULK_SUBJECT_CLASSES = 50;

export type BulkSubjectType = 'أساسية' | 'اختيارية';

export interface BulkSubjectValues {
  school_id: unknown;
  class_ids: number[];
  name: string;
  normalized_name: string;
  subject_type: BulkSubjectType;
  religious_track: ReligiousTrack | null;
  counts_in_average: boolean;
  appears_in_report_card: boolean;
  passing_grade: number;
  exemption_grade: number;
  confirm_create: boolean;
}

export type BulkSubjectValidationCode =
  | 'not_object'
  | 'unknown_field'
  | 'invalid_classes'
  | 'too_many_classes'
  | 'duplicate_class'
  | 'invalid_name'
  | 'invalid_type'
  | 'invalid_religious_track'
  | 'invalid_boolean'
  | 'invalid_grade'
  | 'confirmation_required';

export type BulkSubjectValidation =
  | { ok: true; value: BulkSubjectValues }
  | { ok: false; code: BulkSubjectValidationCode };

export interface BulkSubjectClassRecord {
  id: number;
  school_id: number;
  name: string;
  status: string;
  order_index: number;
}

export interface BulkSubjectExistingRecord {
  id: number;
  class_id: number;
  name: string;
  status: string;
}

export type BulkSubjectInvalidReason = 'missing' | 'cross_school' | 'inactive';

export interface BulkSubjectPlanItem {
  class_id: number;
  class_name: string | null;
  status: 'create' | 'already_exists' | 'invalid';
  existing_subject_id?: number;
  reason?: BulkSubjectInvalidReason;
}

export interface BulkSubjectPlan {
  items: BulkSubjectPlanItem[];
  counts: {
    selected: number;
    create: number;
    already_exists: number;
    invalid: number;
  };
  can_create: boolean;
}

const ALLOWED_KEYS = new Set([
  'school_id',
  'class_ids',
  'name',
  'subject_type',
  'religious_track',
  'counts_in_average',
  'appears_in_report_card',
  'passing_grade',
  'exemption_grade',
  'confirm_create',
]);

export function normalizeBulkSubjectName(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

function readBoolean(value: unknown, fallback: boolean): boolean | null {
  if (value === undefined) return fallback;
  return typeof value === 'boolean' ? value : null;
}

function readGrade(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

export function validateBulkSubjectPayload(
  input: unknown,
  options: { requireConfirmation?: boolean } = {},
): BulkSubjectValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'not_object' };
  }
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !ALLOWED_KEYS.has(key))) {
    return { ok: false, code: 'unknown_field' };
  }

  if (!Array.isArray(body.class_ids) || body.class_ids.length === 0
    || !body.class_ids.every((id) => typeof id === 'number' && Number.isInteger(id) && id > 0)) {
    return { ok: false, code: 'invalid_classes' };
  }
  if (body.class_ids.length > MAX_BULK_SUBJECT_CLASSES) {
    return { ok: false, code: 'too_many_classes' };
  }
  if (new Set(body.class_ids).size !== body.class_ids.length) {
    return { ok: false, code: 'duplicate_class' };
  }

  if (typeof body.name !== 'string') return { ok: false, code: 'invalid_name' };
  const normalizedName = normalizeBulkSubjectName(body.name);
  if (!normalizedName || normalizedName.length > 200) return { ok: false, code: 'invalid_name' };

  const subjectType = body.subject_type ?? 'أساسية';
  if (subjectType !== 'أساسية' && subjectType !== 'اختيارية') {
    return { ok: false, code: 'invalid_type' };
  }
  const religiousTrack = validateReligiousTrack(body.religious_track);
  if (!religiousTrack.ok) return { ok: false, code: 'invalid_religious_track' };

  const countsInAverage = readBoolean(body.counts_in_average, true);
  const appearsInReportCard = readBoolean(body.appears_in_report_card, true);
  if (countsInAverage == null || appearsInReportCard == null) {
    return { ok: false, code: 'invalid_boolean' };
  }
  const passingGrade = readGrade(body.passing_grade, 50);
  const exemptionGrade = readGrade(body.exemption_grade, 25);
  if (passingGrade == null || exemptionGrade == null) {
    return { ok: false, code: 'invalid_grade' };
  }
  if (options.requireConfirmation && body.confirm_create !== true) {
    return { ok: false, code: 'confirmation_required' };
  }
  if (body.confirm_create !== undefined && typeof body.confirm_create !== 'boolean') {
    return { ok: false, code: 'confirmation_required' };
  }

  return {
    ok: true,
    value: {
      school_id: body.school_id,
      class_ids: body.class_ids,
      name: body.name.trim().replace(/\s+/gu, ' '),
      normalized_name: normalizedName,
      subject_type: subjectType,
      religious_track: religiousTrack.value,
      counts_in_average: countsInAverage,
      appears_in_report_card: appearsInReportCard,
      passing_grade: passingGrade,
      exemption_grade: exemptionGrade,
      confirm_create: body.confirm_create === true,
    },
  };
}

export function buildBulkSubjectPlan(
  classIds: number[],
  targetSchoolId: number,
  normalizedName: string,
  classes: BulkSubjectClassRecord[],
  existingSubjects: BulkSubjectExistingRecord[],
): BulkSubjectPlan {
  const classById = new Map(classes.map((record) => [record.id, record]));
  const existingByClass = new Map<number, BulkSubjectExistingRecord>();
  for (const subject of existingSubjects) {
    if (subject.status === 'active'
      && normalizeBulkSubjectName(subject.name) === normalizedName
      && !existingByClass.has(subject.class_id)) {
      existingByClass.set(subject.class_id, subject);
    }
  }

  const items = classIds.map<BulkSubjectPlanItem>((classId) => {
    const classRecord = classById.get(classId);
    if (!classRecord) {
      return { class_id: classId, class_name: null, status: 'invalid', reason: 'missing' };
    }
    if (classRecord.school_id !== targetSchoolId) {
      return { class_id: classId, class_name: null, status: 'invalid', reason: 'cross_school' };
    }
    if (classRecord.status !== 'active') {
      return {
        class_id: classId,
        class_name: classRecord.name,
        status: 'invalid',
        reason: 'inactive',
      };
    }
    const existing = existingByClass.get(classId);
    if (existing) {
      return {
        class_id: classId,
        class_name: classRecord.name,
        status: 'already_exists',
        existing_subject_id: existing.id,
      };
    }
    return { class_id: classId, class_name: classRecord.name, status: 'create' };
  });

  const counts = {
    selected: items.length,
    create: items.filter((item) => item.status === 'create').length,
    already_exists: items.filter((item) => item.status === 'already_exists').length,
    invalid: items.filter((item) => item.status === 'invalid').length,
  };
  return { items, counts, can_create: counts.invalid === 0 };
}
