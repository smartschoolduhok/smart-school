export interface AcademicYearRecord {
  id: number;
  school_id: number;
  name: string;
  starts_at: string;
  ends_at: string;
  is_active: 0 | 1;
  created_at: number;
}

export interface AcademicYearInput {
  name?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
}

export interface ValidatedAcademicYearInput {
  name: string;
  starts_at: string;
  ends_at: string;
}

export type AcademicYearValidation =
  | { ok: true; value: ValidatedAcademicYearInput }
  | { ok: false; error: string };

interface AcademicYearPreparedStatement {
  bind(...values: unknown[]): AcademicYearPreparedStatement;
  first<T = unknown>(): Promise<T | null>;
}

export interface AcademicYearDatabase {
  prepare(query: string): AcademicYearPreparedStatement;
  batch(statements: AcademicYearPreparedStatement[]): Promise<unknown[]>;
}

export type AcademicYearActivationResult =
  | { ok: true; year: AcademicYearRecord }
  | { ok: false; code: 'not_found' | 'wrong_school' };

const ISO_DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateAcademicYearInput(input: AcademicYearInput): AcademicYearValidation {
  const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
  const startsAt = typeof input.starts_at === 'string' ? input.starts_at.trim() : '';
  const endsAt = typeof input.ends_at === 'string' ? input.ends_at.trim() : '';

  if (!name) return { ok: false, error: 'اسم السنة الدراسية مطلوب' };
  if (name.length > 100 || CONTROL_CHARACTER_PATTERN.test(name)) {
    return { ok: false, error: 'اسم السنة الدراسية غير صالح' };
  }
  if (!isValidIsoDate(startsAt) || !isValidIsoDate(endsAt)) {
    return { ok: false, error: 'يجب إدخال تاريخ بداية ونهاية صالحين' };
  }
  if (startsAt >= endsAt) {
    return { ok: false, error: 'يجب أن يكون تاريخ البداية قبل تاريخ النهاية' };
  }

  return { ok: true, value: { name, starts_at: startsAt, ends_at: endsAt } };
}

export function isDuplicateAcademicYearError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('duplicate academic year name')
    || message.includes('UNIQUE constraint failed: academic_years.school_id, academic_years.name');
}

export async function createInactiveAcademicYear(
  db: AcademicYearDatabase,
  schoolId: number,
  input: ValidatedAcademicYearInput,
): Promise<AcademicYearRecord> {
  const inserted = await db.prepare(`
    INSERT INTO academic_years (school_id, name, starts_at, ends_at, is_active)
    VALUES (?, ?, ?, ?, 0)
    RETURNING id, school_id, name, starts_at, ends_at, is_active, created_at
  `).bind(schoolId, input.name, input.starts_at, input.ends_at).first<AcademicYearRecord>();
  if (!inserted) throw new Error('Academic year creation did not persist');
  return inserted;
}

export async function updateAcademicYearDetails(
  db: AcademicYearDatabase,
  yearId: number,
  schoolId: number,
  input: ValidatedAcademicYearInput,
): Promise<AcademicYearRecord | null> {
  return db.prepare(`
    UPDATE academic_years
    SET name = ?, starts_at = ?, ends_at = ?
    WHERE id = ? AND school_id = ?
    RETURNING id, school_id, name, starts_at, ends_at, is_active, created_at
  `).bind(input.name, input.starts_at, input.ends_at, yearId, schoolId).first<AcademicYearRecord>();
}

export async function activateAcademicYearAtomically(
  db: AcademicYearDatabase,
  yearId: number,
  schoolId: number,
): Promise<AcademicYearActivationResult> {
  const existing = await db.prepare(`
    SELECT id, school_id, name, starts_at, ends_at, is_active, created_at
    FROM academic_years
    WHERE id = ?
  `).bind(yearId).first<AcademicYearRecord>();

  if (!existing) return { ok: false, code: 'not_found' };
  if (existing.school_id !== schoolId) return { ok: false, code: 'wrong_school' };

  await db.batch([
    db.prepare(`
      UPDATE academic_years
      SET is_active = 0
      WHERE school_id = ? AND id <> ? AND is_active = 1
    `).bind(schoolId, yearId),
    db.prepare(`
      UPDATE academic_years
      SET is_active = 1
      WHERE id = ? AND school_id = ?
    `).bind(yearId, schoolId),
  ]);

  const activated = await db.prepare(`
    SELECT id, school_id, name, starts_at, ends_at, is_active, created_at
    FROM academic_years
    WHERE id = ? AND school_id = ?
  `).bind(yearId, schoolId).first<AcademicYearRecord>();

  if (!activated || activated.is_active !== 1) {
    throw new Error('Academic year activation did not persist');
  }
  return { ok: true, year: activated };
}
