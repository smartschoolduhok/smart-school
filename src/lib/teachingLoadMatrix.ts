import {
  evaluateTimetableEntryPlacement,
  type TimetableDay, type TimetableSlot, type TimetableEntry, type TimetableTeachingLoad,
  type TimetableTeacherAvailabilityOverride, type TimetableTeacherConstraints,
} from './timetable.ts';

export const MAX_MATRIX_CHANGES = 500;
export const MAX_MATRIX_WEEKLY_PERIODS = 100;
export const STALE_MATRIX_CODE = 'stale_teaching_load_matrix';
export const STALE_MATRIX_MESSAGE = 'تغيرت بيانات الجدول أو الأنصبة بعد فتح المصفوفة. أعد تحميلها ثم حاول مرة أخرى.';
export const MATRIX_LEAVE_MESSAGE = 'لديك تغييرات غير محفوظة. هل تريد مغادرة الصفحة؟';
export interface MatrixClass { id: number; school_id: number; name: string; status: string; order_index: number }
export interface MatrixSection { id: number; school_id: number; class_id: number; name: string; status: string }
export interface MatrixSubject extends MatrixSection { section_id: number | null; order_index: number }
export interface MatrixTeacher { id: number; school_id: number; full_name: string; status: string; role: string }
export interface MatrixScope { school_id?: number; academic_year_id: number; class_id: number }
export type MatrixChange =
  | { subject_id: number; section_id: number | null; action: 'upsert'; weekly_periods: number; employee_id: number | null }
  | { subject_id: number; section_id: number | null; action: 'deactivate' };
export interface MatrixRequest extends MatrixScope { expected_revision: number; changes: MatrixChange[]; confirm_apply?: true }
export type MatrixCopyMode = 'periods_only' | 'periods_and_teachers';
export interface MatrixCopyRequest {
  school_id?: number; target_academic_year_id: number; source_academic_year_id: number; class_id: number; copy_mode: MatrixCopyMode;
}
export interface MatrixNotice { code: string; message: string }
export interface MatrixPlanItem {
  class_id: number; section_id: number | null; section_name: string | null;
  subject_id: number; subject_name: string | null; existing_load_id: number | null;
  action: 'create' | 'update' | 'deactivate' | 'unchanged' | 'blocked';
  old_weekly_periods: number | null; new_weekly_periods: number | null;
  old_employee_id: number | null; new_employee_id: number | null;
  old_employee_name: string | null; new_employee_name: string | null;
  locked_entry_count: number; warnings: MatrixNotice[]; blockers: MatrixNotice[];
}
export interface MatrixSummary {
  expected: number; configured: number; missing: number; without_teacher: number; invalid_teacher: number;
  weekly_periods: number; completion_percent: number; section_count: number; subject_count: number;
}
export interface TeachingLoadMatrixData {
  class: MatrixClass; sections: MatrixSection[]; subjects: MatrixSubject[]; teachers: MatrixTeacher[];
  loads: TimetableTeachingLoad[]; timetable_revision: number; summary: MatrixSummary;
}
export interface MatrixContext extends Omit<TeachingLoadMatrixData, 'summary'> {
  academic_year_id: number; days: TimetableDay[]; slots: TimetableSlot[]; entries: TimetableEntry[];
  availability: TimetableTeacherAvailabilityOverride[]; constraints: TimetableTeacherConstraints[];
}
export interface MatrixPlan {
  can_apply: boolean; revision: number; counts: Record<MatrixPlanItem['action'], number>;
  without_teacher_after: number; invalid_teacher_after: number; summary_after: MatrixSummary;
  total_weekly_periods_before: number; total_weekly_periods_after: number;
  items: MatrixPlanItem[];
}
export interface MatrixCopyPlan { changes: MatrixChange[]; plan: MatrixPlan; warnings: MatrixNotice[]; unavailable: Array<{ subject_id: number; section_id: number | null; code: string; message: string }> }

export const matrixKey = (subjectId: number, sectionId: number | null) => `${subjectId}:${sectionId ?? 'none'}`;
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
const invalid = (code = 'invalid_matrix_payload') => ({ ok: false as const, code, error: 'بيانات مصفوفة النصاب غير صالحة؛ تحقق من الحقول والمعرّفات وعدد الحصص.' });

export function parseMatrixRequest(input: unknown, apply = false) {
  if (!object(input) || !onlyKeys(input, ['school_id', 'academic_year_id', 'class_id', 'expected_revision', 'changes', ...(apply ? ['confirm_apply'] : [])])) return invalid();
  if ((input.school_id !== undefined && !isId(input.school_id)) || !isId(input.academic_year_id) || !isId(input.class_id)
    || typeof input.expected_revision !== 'number' || !Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0) return invalid();
  if (apply && input.confirm_apply !== true) return invalid('confirmation_required');
  if (!Array.isArray(input.changes) || input.changes.length === 0 || input.changes.length > MAX_MATRIX_CHANGES) return invalid('invalid_change_count');
  const keys = new Set<string>();
  for (const change of input.changes) {
    if (!object(change) || !isId(change.subject_id) || (change.section_id !== null && !isId(change.section_id))) return invalid();
    if (change.action === 'deactivate') {
      if (!onlyKeys(change, ['subject_id', 'section_id', 'action'])) return invalid();
    } else if (change.action === 'upsert') {
      if (!onlyKeys(change, ['subject_id', 'section_id', 'action', 'employee_id', 'weekly_periods'])
        || (change.employee_id !== null && !isId(change.employee_id))
        || !isId(change.weekly_periods) || change.weekly_periods > MAX_MATRIX_WEEKLY_PERIODS) return invalid();
    } else return invalid();
    const key = matrixKey(change.subject_id, change.section_id as number | null);
    if (keys.has(key)) return invalid('duplicate_matrix_cell');
    keys.add(key);
  }
  return { ok: true as const, value: input as unknown as MatrixRequest };
}

export function parseMatrixCopyRequest(input: unknown) {
  if (!object(input) || !onlyKeys(input, ['school_id', 'target_academic_year_id', 'source_academic_year_id', 'class_id', 'copy_mode'])
    || (input.school_id !== undefined && !isId(input.school_id))
    || !isId(input.target_academic_year_id) || !isId(input.source_academic_year_id) || !isId(input.class_id)
    || input.target_academic_year_id === input.source_academic_year_id
    || !['periods_only', 'periods_and_teachers'].includes(String(input.copy_mode))) return invalid('invalid_copy_payload');
  return { ok: true as const, value: input as unknown as MatrixCopyRequest };
}

export function matrixCells(classId: number, sections: MatrixSection[], subjects: MatrixSubject[]) {
  const activeSections = sections.filter(s => s.class_id === classId && s.status === 'active').sort((a, b) => a.id - b.id);
  const columns = activeSections.length ? activeSections.map(s => s.id) : [null];
  return subjects.filter(s => s.class_id === classId && s.status === 'active')
    .sort((a, b) => a.order_index - b.order_index || a.id - b.id)
    .flatMap(subject => columns.filter(section => subject.section_id == null || subject.section_id === section)
      .map(section_id => ({ subject_id: subject.id, section_id })));
}

export function isMatrixTeacherEligible(teacher: { school_id?: number | null; status?: string | null; role?: string | null } | undefined, schoolId: number) {
  return teacher?.school_id === schoolId && teacher.status === 'active' && teacher.role === 'teacher';
}

// Joined metadata is scoped to the load's school in BOTH list and matrix APIs.
// Missing metadata is invalid, never equivalent to deliberate NULL assignment.
export function matrixLoadTeacherState(load: TimetableTeachingLoad): 'valid' | 'without_teacher' | 'invalid_teacher' {
  if (load.employee_id == null) return 'without_teacher';
  return isMatrixTeacherEligible({ school_id: load.employee_school_id, status: load.employee_status, role: load.employee_role }, load.school_id)
    ? 'valid' : 'invalid_teacher';
}

export function matrixCellPresentation(load: TimetableTeachingLoad | undefined, employeeId: number | null, teachers: MatrixTeacher[], schoolId: number) {
  if (employeeId != null && !teachers.some(t => t.id === employeeId && isMatrixTeacherEligible(t, schoolId)))
    return { state: 'invalid_teacher', tone: 'bg-red-50', label: 'مدرس غير متاح — اختر بديلًا' } as const;
  if (!load) return { state: 'missing', tone: 'bg-gray-50', label: 'لا يوجد نصاب بعد' } as const;
  if (employeeId == null) return { state: 'without_teacher', tone: 'bg-amber-50', label: 'بدون مدرس' } as const;
  return { state: 'valid', tone: 'bg-emerald-50', label: 'مكتمل' } as const;
}

export function summarizeMatrix(classId: number, sections: MatrixSection[], subjects: MatrixSubject[], loads: TimetableTeachingLoad[]): MatrixSummary {
  const cells = matrixCells(classId, sections, subjects);
  const expected = new Set(cells.map(c => matrixKey(c.subject_id, c.section_id)));
  const configured = loads.filter(l => l.class_id === classId && l.status === 'active' && expected.has(matrixKey(l.subject_id, l.section_id)));
  return { expected: cells.length, configured: configured.length, missing: cells.length - configured.length,
    without_teacher: configured.filter(l => l.employee_id == null).length,
    invalid_teacher: configured.filter(l => matrixLoadTeacherState(l) === 'invalid_teacher').length,
    weekly_periods: configured.reduce((sum, l) => sum + l.weekly_periods, 0),
    completion_percent: cells.length ? Math.round(100 * configured.filter(l => matrixLoadTeacherState(l) === 'valid').length / cells.length) : 0,
    section_count: sections.filter(s => s.class_id === classId && s.status === 'active').length,
    subject_count: subjects.filter(s => s.class_id === classId && s.status === 'active').length };
}

export function matrixClassCards(classes: MatrixClass[], sections: MatrixSection[], subjects: MatrixSubject[], loads: TimetableTeachingLoad[]) {
  return classes.filter(c => c.status === 'active').sort((a, b) => a.order_index - b.order_index || a.id - b.id)
    .map(c => ({ ...c, summary: summarizeMatrix(c.id, sections, subjects, loads) }));
}

// Check the resulting destination teacher schedules, never isolated cell changes.
// Historical inactive periods remain preserved and do not consume active capacity.
export function teacherScheduleNotices(context: Pick<MatrixContext, 'days' | 'slots' | 'loads' | 'entries' | 'availability' | 'constraints'>, teacherIds: Set<number>) {
  const result = new Map<number, { blockers: MatrixNotice[]; warnings: MatrixNotice[] }>();
  const activeDays = new Set(context.days.filter(d => d.is_active === 1).map(d => d.day_of_week));
  const activeSlots = new Set(context.slots.filter(s => s.is_active === 1 && s.slot_type === 'lesson' && activeDays.has(s.day_of_week)).map(s => s.id));
  for (const teacherId of teacherIds) {
    const loadIds = new Set(context.loads.filter(l => l.employee_id === teacherId).map(l => l.id));
    const entries = context.entries.filter(e => loadIds.has(e.teaching_load_id));
    const blockers: MatrixNotice[] = []; const warnings: MatrixNotice[] = [];
    const seen = new Set<number>();
    for (const entry of entries) {
      if (seen.has(entry.slot_id)) blockers.push({ code: 'teacher_collision', message: 'المدرس مرتبط بحصة أخرى في الفترة نفسها' });
      seen.add(entry.slot_id);
      if (context.availability.some(a => a.employee_id === teacherId && a.slot_id === entry.slot_id && a.status === 'unavailable'))
        blockers.push({ code: 'teacher_unavailable', message: 'المدرس غير متاح في هذه الفترة' });
      if (!activeSlots.has(entry.slot_id)) continue;
      const evaluation = evaluateTimetableEntryPlacement({
        candidate: entry, ...context, teacherAvailability: context.availability, teacherConstraints: context.constraints,
      });
      blockers.push(...evaluation.hard_conflicts.filter(n => n.code.startsWith('teacher_')));
      warnings.push(...evaluation.warnings);
    }
    const constraint = context.constraints.find(c => c.employee_id === teacherId);
    const workingDays = new Set(entries.filter(e => activeSlots.has(e.slot_id)).map(e => context.slots.find(s => s.id === e.slot_id)!.day_of_week));
    if (constraint?.max_working_days != null && workingDays.size > constraint.max_working_days)
      blockers.push({ code: 'teacher_max_working_days', message: 'تجاوز المدرس الحد الأقصى لأيام العمل الأسبوعية' });
    const unique = (notices: MatrixNotice[]) => [...new Map(notices.map(n => [n.code, n])).values()];
    result.set(teacherId, { blockers: unique(blockers), warnings: unique(warnings) });
  }
  return result;
}

export function planTeachingLoadMatrix(context: MatrixContext, changes: MatrixChange[]): MatrixPlan {
  const applicable = new Set(matrixCells(context.class.id, context.sections, context.subjects).map(c => matrixKey(c.subject_id, c.section_id)));
  const activeLoads = new Map(context.loads.filter(l => l.class_id === context.class.id && l.status === 'active').map(l => [matrixKey(l.subject_id, l.section_id), l]));
  const finalLoads = context.loads.map(l => ({ ...l }));
  const destinations = new Set<number>();
  const items = [...changes].sort((a, b) => a.subject_id - b.subject_id || (a.section_id ?? 0) - (b.section_id ?? 0)).map<MatrixPlanItem>(change => {
    const existing = activeLoads.get(matrixKey(change.subject_id, change.section_id));
    const subject = context.subjects.find(s => s.id === change.subject_id);
    const teacher = change.action === 'upsert' ? context.teachers.find(t => t.id === change.employee_id && isMatrixTeacherEligible(t, context.class.school_id)) : null;
    const item: MatrixPlanItem = {
      class_id: context.class.id, section_id: change.section_id,
      section_name: context.sections.find(s => s.id === change.section_id)?.name ?? null,
      subject_id: change.subject_id, subject_name: subject?.name ?? null, existing_load_id: existing?.id ?? null,
      action: 'unchanged', old_weekly_periods: existing?.weekly_periods ?? null,
      new_weekly_periods: change.action === 'upsert' ? change.weekly_periods : null,
      old_employee_id: existing?.employee_id ?? null, new_employee_id: change.action === 'upsert' ? change.employee_id : null,
      old_employee_name: existing?.employee_name ?? null, new_employee_name: teacher?.full_name ?? null,
      locked_entry_count: context.entries.filter(e => e.teaching_load_id === existing?.id && e.is_locked === 1).length,
      warnings: [], blockers: [],
    };
    const block = (code: string, message: string) => item.blockers.push({ code, message });
    if (!applicable.has(matrixKey(change.subject_id, change.section_id))) block('missing_or_not_in_scope', 'المادة أو الشعبة غير متاحة ضمن الصف المحدد.');
    if (change.action === 'upsert' && change.employee_id != null && !teacher) block('invalid_teacher', 'المدرس غير متاح ضمن المدرسة المحددة.');
    const scheduled = context.entries.filter(e => e.teaching_load_id === existing?.id).length;
    if (change.action === 'deactivate' && scheduled) block('load_has_scheduled_entries', 'لا يمكن تعطيل النصاب لأنه يحتوي على حصص مجدولة.');
    if (change.action === 'upsert' && change.weekly_periods < scheduled) block('weekly_periods_below_scheduled', 'عدد الحصص أقل من عدد الحصص المجدولة حاليًا.');
    if (item.blockers.length) { item.action = 'blocked'; return item; }
    if (change.action === 'deactivate') {
      item.action = existing ? 'deactivate' : 'unchanged';
      if (existing) finalLoads.find(l => l.id === existing.id)!.status = 'inactive';
    } else if (existing) {
      item.action = existing.employee_id === change.employee_id && existing.weekly_periods === change.weekly_periods ? 'unchanged' : 'update';
      Object.assign(finalLoads.find(l => l.id === existing.id)!, {
        employee_id: change.employee_id, weekly_periods: change.weekly_periods,
        employee_name: teacher?.full_name ?? null, employee_role: teacher?.role ?? null,
        employee_status: teacher?.status ?? null, employee_school_id: teacher?.school_id ?? null,
      });
      if (existing.employee_id !== change.employee_id && change.employee_id != null) destinations.add(change.employee_id);
    } else {
      item.action = 'create';
    }
    return item;
  });
  const safety = teacherScheduleNotices({ ...context, loads: finalLoads }, destinations);
  for (const item of items) {
    if (item.action !== 'update' || item.new_employee_id === item.old_employee_id) continue;
    const notices = item.new_employee_id == null ? undefined : safety.get(item.new_employee_id);
    item.blockers.push(...(notices?.blockers ?? [])); item.warnings.push(...(notices?.warnings ?? []));
    if (item.locked_entry_count) item.warnings.push({ code: 'locked_lessons_teacher_change', message: 'يتغير مدرس حصص مقفلة مع الحفاظ على مواقعها وأقفالها.' });
    if (item.blockers.length) item.action = 'blocked';
  }
  const counts: MatrixPlan['counts'] = { create: 0, update: 0, deactivate: 0, unchanged: 0, blocked: 0 };
  items.forEach(i => { counts[i.action]++; });
  const before = context.loads.filter(l => l.class_id === context.class.id && l.status === 'active');
  let periods = before.reduce((sum, l) => sum + l.weekly_periods, 0);
  let missingTeacher = before.filter(l => l.employee_id == null).length;
  for (const i of items) {
    if (!['create', 'update', 'deactivate'].includes(i.action)) continue;
    if (i.existing_load_id != null) { periods -= i.old_weekly_periods!; if (i.old_employee_id == null) missingTeacher--; }
    if (i.action !== 'deactivate') { periods += i.new_weekly_periods!; if (i.new_employee_id == null) missingTeacher++; }
  }
  // Project only accepted items. Invalid/blocked cells retain stored references;
  // summary/read paths never repair, clear, deactivate or hide academic demand.
  const projected = before.map(l => ({ ...l }));
  for (const i of items) {
    if (!['create', 'update', 'deactivate'].includes(i.action)) continue;
    const teacher = context.teachers.find(t => t.id === i.new_employee_id && isMatrixTeacherEligible(t, context.class.school_id));
    const values = { employee_id: i.new_employee_id, weekly_periods: i.new_weekly_periods!,
      employee_school_id: teacher?.school_id ?? null, employee_status: teacher?.status ?? null, employee_role: teacher?.role ?? null };
    if (i.action === 'create') projected.push({ ...values, id: -1 - projected.length, school_id: context.class.school_id,
      academic_year_id: context.academic_year_id, class_id: context.class.id, subject_id: i.subject_id, section_id: i.section_id,
      status: 'active', created_at: 0, updated_at: 0 });
    else {
      const load = projected.find(l => l.id === i.existing_load_id)!;
      if (i.action === 'deactivate') load.status = 'inactive';
      else Object.assign(load, values);
    }
  }
  const summaryAfter = summarizeMatrix(context.class.id, context.sections, context.subjects, projected);
  return { can_apply: counts.blocked === 0, revision: context.timetable_revision, counts,
    without_teacher_after: missingTeacher, invalid_teacher_after: projected.filter(l => l.status === 'active' && matrixLoadTeacherState(l) === 'invalid_teacher').length,
    summary_after: summaryAfter, total_weekly_periods_before: before.reduce((sum, l) => sum + l.weekly_periods, 0),
    total_weekly_periods_after: periods, items };
}

export function planTeachingLoadCopy(context: MatrixContext, source: TimetableTeachingLoad[], mode: MatrixCopyMode): MatrixCopyPlan {
  const cells = new Set(matrixCells(context.class.id, context.sections, context.subjects).map(c => matrixKey(c.subject_id, c.section_id)));
  const changes: MatrixChange[] = []; const warnings: MatrixNotice[] = [];
  const unavailable: MatrixCopyPlan['unavailable'] = [];
  for (const load of source.filter(l => l.status === 'active' && l.class_id === context.class.id)) {
    if (!cells.has(matrixKey(load.subject_id, load.section_id))) {
      unavailable.push({ subject_id: load.subject_id, section_id: load.section_id, code: 'source_unavailable', message: 'المادة أو الشعبة لم تعد متاحة في الصف المستهدف.' });
      continue;
    }
    const target = context.loads.find(l => l.class_id === context.class.id && l.status === 'active' && l.subject_id === load.subject_id && l.section_id === load.section_id);
    let employeeId = mode === 'periods_only' ? target?.employee_id ?? null : load.employee_id;
    if (mode === 'periods_and_teachers' && employeeId != null && !context.teachers.some(t => t.id === employeeId && isMatrixTeacherEligible(t, context.class.school_id))) {
      employeeId = null;
      warnings.push({ code: 'source_teacher_removed', message: 'لم يعد المدرس متاحًا، وسيُحفظ النصاب بدون مدرس.' });
    }
    changes.push({ subject_id: load.subject_id, section_id: load.section_id, action: 'upsert', weekly_periods: load.weekly_periods, employee_id: employeeId });
  }
  return { changes, plan: planTeachingLoadMatrix(context, changes), warnings, unavailable };
}

export type MatrixDraft = Record<string, { periods?: string; employeeId?: number | null; deactivate?: boolean }>;
export function matrixDraftChanges(data: TeachingLoadMatrixData, draft: MatrixDraft): MatrixChange[] {
  return matrixCells(data.class.id, data.sections, data.subjects).flatMap<MatrixChange>(cell => {
    const edit = draft[matrixKey(cell.subject_id, cell.section_id)]; if (!edit) return [];
    const existing = data.loads.find(l => l.status === 'active' && l.subject_id === cell.subject_id && l.section_id === cell.section_id);
    if (edit.deactivate) return existing ? [{ ...cell, action: 'deactivate' }] : [];
    const periods = edit.periods?.trim() ? Number(edit.periods) : existing?.weekly_periods;
    if (periods == null) return [];
    const employeeId = edit.employeeId === undefined ? existing?.employee_id ?? null : edit.employeeId;
    if (existing && existing.weekly_periods === periods && existing.employee_id === employeeId) return [];
    return [{ ...cell, action: 'upsert', weekly_periods: periods, employee_id: employeeId }];
  });
}

export function applyMatrixRow(data: TeachingLoadMatrixData, draft: MatrixDraft, subjectId: number, edit: MatrixDraft[string]): MatrixDraft {
  const next = { ...draft };
  for (const c of matrixCells(data.class.id, data.sections, data.subjects).filter(c => c.subject_id === subjectId)) {
    const key = matrixKey(c.subject_id, c.section_id);
    next[key] = { ...next[key], ...edit, deactivate: false };
  }
  return next;
}

// Monotonic generations prevent both ordinary stale responses and A -> B -> A.
export function createMatrixRequestGuard() {
  let generation = 0;
  return { invalidate: () => { generation++; }, capture: () => { const current = generation; return () => current === generation; } };
}
