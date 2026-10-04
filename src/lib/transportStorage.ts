import { areaNameKey, isTransportMode, normalizeAreaName } from './transport.ts';
import type { ResidentialArea, TransportLine } from './transport.ts';
import {
  listStudentsWithEffectivePlacement,
  resolveActiveAcademicYear,
  type StudentEnrollmentDatabase,
  type StudentTransportWriteFields,
} from './studentEnrollments.ts';

type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

function optionalText(value: unknown, maximum: number): Validation<string | null> {
  if (value == null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || value.length > maximum) {
    return { ok: false, error: `يجب أن يكون النص بطول لا يتجاوز ${maximum} حرفاً` };
  }
  return { ok: true, value: value.trim() || null };
}

function nullableId(value: unknown): number | null | false {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : false;
}

export function validateTransportName(value: unknown): Validation<{ name: string; name_key: string }> {
  if (typeof value !== 'string') return { ok: false, error: 'الاسم مطلوب' };
  const name = normalizeAreaName(value);
  const name_key = areaNameKey(name);
  if (!name || !name_key || name.length > 120) {
    return { ok: false, error: 'أدخل اسماً صالحاً لا يتجاوز 120 حرفاً' };
  }
  return { ok: true, value: { name, name_key } };
}

export function validateTransportDriver(body: Record<string, unknown>): Validation<{
  driver_name: string | null; driver_phone: string | null;
}> {
  const name = optionalText(body.driver_name, 120);
  const phone = optionalText(body.driver_phone, 40);
  if (!name.ok) return name;
  if (!phone.ok) return phone;
  return { ok: true, value: { driver_name: name.value, driver_phone: phone.value } };
}

export async function validateStudentTransportInput(
  db: StudentEnrollmentDatabase,
  schoolId: number,
  body: Record<string, unknown>,
  existing: StudentTransportWriteFields = {},
  requireResidence = false,
): Promise<Validation<StudentTransportWriteFields>> {
  const value: StudentTransportWriteFields = {};
  const area = nullableId(body.residential_area_id === undefined ? existing.residential_area_id : body.residential_area_id);
  if (area === false || (requireResidence && area == null)) {
    return { ok: false, error: 'يجب تحديد منطقة سكن صالحة للطالب' };
  }
  if (area != null) {
    const record = await db.prepare('SELECT id FROM residential_areas WHERE id = ? AND school_id = ?')
      .bind(area, schoolId).first();
    if (!record) return { ok: false, error: 'منطقة السكن غير موجودة في هذه المدرسة' };
  }
  if (body.residential_area_id !== undefined || requireResidence) value.residential_area_id = area;

  const textFields = [
    ['pickup_landmark', 300], ['guardian_phone_secondary', 40],
    ['private_driver_name', 120], ['private_driver_phone', 40],
  ] as const;
  for (const [key, maximum] of textFields) {
    if (body[key] === undefined) continue;
    const text = optionalText(body[key], maximum);
    if (!text.ok) return text;
    value[key] = text.value;
  }

  for (const direction of ['to_school', 'from_school'] as const) {
    const modeKey = `transport_${direction}` as const;
    const lineKey = `transport_${direction}_line_id` as const;
    const mode = body[modeKey] === undefined ? (existing[modeKey] ?? 'unspecified') : body[modeKey];
    if (!isTransportMode(mode)) return { ok: false, error: 'طريقة النقل المحددة غير صالحة' };
    if (body[modeKey] !== undefined || requireResidence) value[modeKey] = mode;
    const rawLine = body[lineKey] === undefined ? existing[lineKey] : body[lineKey];
    const line = nullableId(rawLine);
    if (line === false) return { ok: false, error: 'خط النقل المحدد غير صالح' };
    if (mode !== 'school') {
      if (body[lineKey] != null && body[lineKey] !== '') {
        return { ok: false, error: 'لا يمكن ربط خط مدرسي بطريقة نقل أخرى' };
      }
      if (body[modeKey] !== undefined || body[lineKey] !== undefined) value[lineKey] = null;
      continue;
    }
    if (line != null) {
      const record = await db.prepare('SELECT id FROM transport_lines WHERE id = ? AND school_id = ?')
        .bind(line, schoolId).first();
      if (!record) return { ok: false, error: 'خط النقل غير موجود في هذه المدرسة' };
    }
    if (body[lineKey] !== undefined) value[lineKey] = line;
  }
  return { ok: true, value };
}

export async function listResidentialAreas(db: StudentEnrollmentDatabase, schoolId: number) {
  const result = await db.prepare('SELECT id, school_id, name FROM residential_areas WHERE school_id = ? ORDER BY name')
    .bind(schoolId).all<ResidentialArea>();
  return result.results ?? [];
}

export async function listTransportLines(db: StudentEnrollmentDatabase, schoolId: number) {
  const result = await db.prepare('SELECT id, school_id, name, driver_name, driver_phone FROM transport_lines WHERE school_id = ? ORDER BY name')
    .bind(schoolId).all<TransportLine>();
  return result.results ?? [];
}

export async function loadTransportRoster(db: StudentEnrollmentDatabase, schoolId: number) {
  const students = await listStudentsWithEffectivePlacement(db, { schoolId });
  const academicYear = await resolveActiveAcademicYear(db, schoolId);
  const school = await db.prepare('SELECT name FROM schools WHERE id = ?')
    .bind(schoolId).first<{ name: string }>();
  return {
    school_name: school?.name ?? 'المدرسة',
    students: students.filter(student => student.status === 'active'
      && (!academicYear || (student.current_academic_year_id === academicYear.id && student.current_enrollment_status === 'active'))),
    academic_year: academicYear ? { id: academicYear.id, name: academicYear.name } : null,
  };
}

export function validateTransportAssignment(body: Record<string, unknown>): Validation<{
  studentIds: number[]; lineId: number; direction: 'to_school' | 'from_school' | 'both';
}> {
  if (!Array.isArray(body.student_ids) || body.student_ids.length === 0 || body.student_ids.length > 100) {
    return { ok: false, error: 'حدد من طالب واحد إلى 100 طالب في العملية الواحدة' };
  }
  if (body.student_ids.some(id => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)) {
    return { ok: false, error: 'قائمة الطلاب غير صالحة' };
  }
  const lineId = nullableId(body.line_id);
  if (!lineId) return { ok: false, error: 'اختر خط نقل صالحاً' };
  const direction = body.direction;
  if (direction !== 'to_school' && direction !== 'from_school' && direction !== 'both') {
    return { ok: false, error: 'حدد اتجاه النقل: الذهاب أو العودة أو كلاهما' };
  }
  return { ok: true, value: { studentIds: [...new Set(body.student_ids)], lineId, direction } };
}

export async function assignTransportLineAtomically(
  db: StudentEnrollmentDatabase,
  schoolId: number,
  input: { studentIds: number[]; lineId: number; direction: 'to_school' | 'from_school' | 'both' },
): Promise<number> {
  const changes: string[] = [];
  const values: unknown[] = [JSON.stringify(input.studentIds), schoolId];
  if (input.direction === 'to_school' || input.direction === 'both') {
    changes.push("transport_to_school = 'school', transport_to_school_line_id = ?");
    values.push(input.lineId);
  }
  if (input.direction === 'from_school' || input.direction === 'both') {
    changes.push("transport_from_school = 'school', transport_from_school_line_id = ?");
    values.push(input.lineId);
  }
  values.push(input.studentIds.length, input.lineId, schoolId, schoolId);
  // One guarded statement validates the entire selection at write time. JSON keeps
  // the 100-student operation below D1's bound-parameter limit.
  const result = await db.prepare(`
    WITH selected AS (SELECT CAST(value AS INTEGER) AS id FROM json_each(?)),
    eligible AS (
      SELECT student.id FROM students AS student
      INNER JOIN selected ON selected.id = student.id
      LEFT JOIN academic_years AS active_year ON active_year.school_id = student.school_id AND active_year.is_active = 1
      WHERE student.school_id = ? AND student.status = 'active'
        AND (active_year.id IS NULL OR EXISTS (
          SELECT 1 FROM student_enrollments AS enrollment
          WHERE enrollment.student_id = student.id AND enrollment.school_id = student.school_id
            AND enrollment.academic_year_id = active_year.id AND enrollment.status = 'active'
        ))
    )
    UPDATE students SET ${changes.join(', ')}, updated_at = unixepoch()
    WHERE id IN (SELECT id FROM eligible)
      AND (SELECT COUNT(*) FROM eligible) = ?
      AND EXISTS (SELECT 1 FROM transport_lines WHERE id = ? AND school_id = ?)
      AND EXISTS (SELECT 1 FROM schools WHERE id = ? AND status = 'active')
  `).bind(...values).run();
  return Number(result.meta?.changes ?? 0);
}
