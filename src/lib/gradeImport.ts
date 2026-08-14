import { calculateGrades, type CalculatedGradeValues, type GradeCalculationSettings, type RawGradeValues } from './gradeCalculations.ts';
import { isExcelErrorValue, normalizeHeader, normalizeSectionName, normalizeSubjectName } from './excel/normalizers.ts';
import { CALCULATED_GRADE_FIELDS, RAW_GRADE_FIELDS, type RawGradeField } from './excel/types.ts';
import { isCalculatedGradeHeader } from './excel/gradeSemantics.ts';
import { normalizeStudentIdentity } from './studentImport.ts';

export type GradeImportMode = 'update_existing' | 'skip_existing' | 'error_on_existing';
export type GradeAssignmentMode = 'strict_existing_assignments' | 'auto_assign_missing_subjects';

export interface GradeImportSheetPayload {
  sheet_name: string;
  rows: Array<Record<string, unknown>>;
  mapping: Record<string, string>;
  column_headers?: Record<string, string>;
  subject_id?: number | null;
  subject_name?: string | null;
  class_id?: number | null;
  section_id?: number | null;
}

export interface GradeImportPayload {
  grade_sheets: GradeImportSheetPayload[];
  mode?: GradeImportMode;
  assignment_mode?: GradeAssignmentMode;
  clear_empty_fields?: boolean;
}

export interface GradeImportStudent {
  id: number;
  school_id: number;
  student_number: string | null;
  full_name: string;
  class_id: number | null;
  section_id: number | null;
}

export interface GradeImportSubject {
  id: number;
  school_id: number;
  name: string;
  class_id: number | null;
  section_id: number | null;
  status?: string;
}

export interface GradeImportAssignment {
  id: number;
  school_id: number;
  student_id: number;
  subject_id: number;
  class_id: number | null;
  section_id: number | null;
  is_active: number;
}

export interface ExistingGradeImportRecord {
  id: number;
  school_id: number;
  student_subject_id: number;
  first_month: number | null;
  second_month: number | null;
  third_month: number | null;
  fourth_month: number | null;
  mid_year_exam: number | null;
  final_exam: number | null;
  completion_exam: number | null;
  notes: string | null;
}

export interface GradeImportClass {
  id: number;
  school_id: number;
  name: string;
  status: string;
}

export interface GradeImportSection {
  id: number;
  school_id: number;
  class_id: number;
  name: string;
  status: string;
}

export interface GradeImportContext {
  schoolId: number;
  settings: GradeCalculationSettings;
  students: GradeImportStudent[];
  subjects: GradeImportSubject[];
  assignments: GradeImportAssignment[];
  grades: ExistingGradeImportRecord[];
  classes: GradeImportClass[];
  sections: GradeImportSection[];
}

export interface GradeImportIssue {
  sheet: string;
  row: number | null;
  field: string;
  message: string;
  label: string;
}

export interface PlannedGradeImportRecord {
  sheet_name: string;
  excel_row_number: number;
  student_id: number;
  student_number: string | null;
  student_name: string;
  class_id: number | null;
  class_name: string | null;
  section_id: number | null;
  section_name: string | null;
  subject_id: number;
  subject_name: string;
  assignment_id: number | null;
  assignment_action: 'none' | 'create' | 'reactivate';
  existing_grade_id: number | null;
  action: 'create' | 'update';
  values: RawGradeValues & { notes: string | null };
  calculated: CalculatedGradeValues;
  changed_fields: Array<RawGradeField | 'notes'>;
  existing_values: Partial<Record<RawGradeField | 'notes', number | string | null>>;
}

export interface GradeSheetPlanSummary {
  sheet_name: string;
  subject_name: string | null;
  source_rows: number;
  valid_rows: number;
  new_rows: number;
  update_rows: number;
  noop_rows: number;
  error_rows: number;
  warning_rows: number;
}

export interface GradeImportPlan {
  mode: GradeImportMode;
  assignment_mode: GradeAssignmentMode;
  clear_empty_fields: boolean;
  records: PlannedGradeImportRecord[];
  errors: GradeImportIssue[];
  warnings: GradeImportIssue[];
  duplicates: GradeImportIssue[];
  sheets: GradeSheetPlanSummary[];
  summary: {
    sheets_selected: number;
    total_source_rows: number;
    matched_students: number;
    valid_grade_rows: number;
    new_grade_rows: number;
    update_rows: number;
    noop_rows: number;
    duplicate_rows: number;
    assignment_creates: number;
    assignment_reactivations: number;
    errors: number;
    warnings: number;
  };
}

const NOTES_FIELD = 'notes' as const;
const IMPORTABLE_FIELDS = [...RAW_GRADE_FIELDS, NOTES_FIELD] as const;
const EMPTY_MARKERS = new Set(['', '-', '—', '–']);

function issue(sheet: string, row: number | null, field: string, message: string): GradeImportIssue {
  return {
    sheet,
    row,
    field,
    message,
    label: row == null ? sheet : `${sheet} — Excel row ${row}`,
  };
}

function excelRowNumber(row: Record<string, unknown>, index: number): number {
  const value = Number(row._excel_row_number ?? row.excel_row_number ?? index + 2);
  return Number.isInteger(value) && value > 0 ? value : index + 2;
}

function mappedValue(row: Record<string, unknown>, mapping: Record<string, string>, field: string): unknown {
  const source = mapping[field];
  return source ? row[source] : undefined;
}

function textValue(value: unknown): string | null {
  if (value == null || isExcelErrorValue(value)) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function assignmentKey(studentId: number, subjectId: number): string {
  return `${studentId}:${subjectId}`;
}

function compatibleSubject(subject: GradeImportSubject, student: GradeImportStudent): boolean {
  if (subject.class_id != null && subject.class_id !== student.class_id) return false;
  if (subject.section_id != null && subject.section_id !== student.section_id) return false;
  return true;
}

function equalValue(left: unknown, right: unknown): boolean {
  if (left == null && right == null) return true;
  return left === right;
}

function samePlannedValues(left: PlannedGradeImportRecord, right: PlannedGradeImportRecord): boolean {
  return IMPORTABLE_FIELDS.every(field => equalValue(left.values[field], right.values[field]));
}

function rawSheetSubjectKey(sheet: GradeImportSheetPayload): string | null {
  if (sheet.subject_id != null && Number.isInteger(Number(sheet.subject_id))) return `id:${Number(sheet.subject_id)}`;
  const normalized = normalizeSubjectName(sheet.subject_name || sheet.sheet_name);
  return normalized ? `name:${normalized}` : null;
}

function validateManualPlacement(
  sheet: GradeImportSheetPayload,
  context: GradeImportContext,
): GradeImportIssue[] {
  const errors: GradeImportIssue[] = [];
  const targetClass = sheet.class_id == null ? null : context.classes.find(item => item.id === Number(sheet.class_id) && item.school_id === context.schoolId && item.status === 'active');
  const targetSection = sheet.section_id == null ? null : context.sections.find(item => item.id === Number(sheet.section_id) && item.school_id === context.schoolId && item.status === 'active');
  if (sheet.class_id != null && !targetClass) errors.push(issue(sheet.sheet_name, null, 'class_id', 'الصف اليدوي غير موجود أو غير نشط في المدرسة المستهدفة'));
  if (sheet.section_id != null && !targetSection) errors.push(issue(sheet.sheet_name, null, 'section_id', 'الشعبة اليدوية غير موجودة أو غير نشطة في المدرسة المستهدفة'));
  if (targetClass && targetSection && targetSection.class_id !== targetClass.id) errors.push(issue(sheet.sheet_name, null, 'section_id', 'الشعبة اليدوية لا تتبع الصف اليدوي المحدد'));
  return errors;
}

function resolveStudent(
  sheet: GradeImportSheetPayload,
  row: Record<string, unknown>,
  context: GradeImportContext,
): { student: GradeImportStudent | null; error?: string } {
  const students = context.students.filter(student => student.school_id === context.schoolId);
  const studentNumber = textValue(mappedValue(row, sheet.mapping, 'student_number'));
  const fullName = textValue(mappedValue(row, sheet.mapping, 'full_name'));
  const rowClassName = textValue(mappedValue(row, sheet.mapping, 'class_name'));
  const rowSectionName = textValue(mappedValue(row, sheet.mapping, 'section_name'));

  let candidates: GradeImportStudent[];
  if (studentNumber) {
    candidates = students.filter(student => textValue(student.student_number) === studentNumber);
    if (!candidates.length) return { student: null, error: `رقم الطالب/القيد "${studentNumber}" غير موجود` };
    if (candidates.length > 1) return { student: null, error: `رقم الطالب/القيد "${studentNumber}" غير فريد` };
  } else if (fullName) {
    const normalizedName = normalizeStudentIdentity(fullName);
    candidates = students.filter(student => normalizeStudentIdentity(student.full_name) === normalizedName);
    if (!candidates.length) return { student: null, error: `الطالب "${fullName}" غير موجود` };
  } else {
    return { student: null, error: 'يجب توفير رقم الطالب/القيد أو اسم الطالب' };
  }

  const matchesPlacement = (student: GradeImportStudent) => {
    if (sheet.class_id != null && student.class_id !== Number(sheet.class_id)) return false;
    if (sheet.section_id != null && student.section_id !== Number(sheet.section_id)) return false;
    if (rowClassName) {
      const studentClass = context.classes.find(item => item.id === student.class_id && item.school_id === context.schoolId && item.status === 'active');
      if (!studentClass || normalizeHeader(studentClass.name) !== normalizeHeader(rowClassName)) return false;
    }
    if (rowSectionName) {
      const studentSection = context.sections.find(item => item.id === student.section_id && item.school_id === context.schoolId && item.status === 'active');
      if (!studentSection || normalizeSectionName(studentSection.name) !== normalizeSectionName(rowSectionName)) return false;
    }
    return true;
  };

  const placed = candidates.filter(matchesPlacement);
  if (studentNumber && !placed.length) return { student: null, error: 'الصف أو الشعبة المحددة لا تطابق قيد الطالب الموجود' };
  if (placed.length === 1) return { student: placed[0] };
  if (placed.length > 1) return { student: null, error: 'يوجد أكثر من طالب مطابق؛ أضف رقم الطالب/القيد أو سياق الصف والشعبة' };
  if (candidates.length === 1) return { student: null, error: 'الصف أو الشعبة المحددة لا تطابق الطالب الموجود' };
  return { student: null, error: 'يوجد أكثر من طالب بنفس الاسم؛ أضف رقم الطالب/القيد أو سياق الصف والشعبة' };
}

function resolveSubject(
  sheet: GradeImportSheetPayload,
  row: Record<string, unknown>,
  student: GradeImportStudent,
  context: GradeImportContext,
): { subject: GradeImportSubject | null; error?: string } {
  const subjects = context.subjects.filter(subject => subject.school_id === context.schoolId && subject.status !== 'archived');
  if (sheet.subject_id != null) {
    const subject = subjects.find(item => item.id === Number(sheet.subject_id));
    if (!subject) return { subject: null, error: 'المادة المحددة غير موجودة في المدرسة المستهدفة' };
    if (!compatibleSubject(subject, student)) return { subject: null, error: 'المادة المحددة لا تتوافق مع صف أو شعبة الطالب' };
    return { subject };
  }

  const sourceName = textValue(mappedValue(row, sheet.mapping, 'subject_name')) || textValue(sheet.subject_name) || sheet.sheet_name;
  const normalized = normalizeSubjectName(sourceName);
  if (!normalized) return { subject: null, error: 'تعذر تحديد المادة لهذه الورقة' };
  const named = subjects.filter(subject => normalizeSubjectName(subject.name) === normalized);
  if (!named.length) return { subject: null, error: `المادة "${sourceName}" غير موجودة في المدرسة المستهدفة` };
  const compatible = named.filter(subject => compatibleSubject(subject, student));
  if (!compatible.length) return { subject: null, error: `المادة "${sourceName}" لا تتوافق مع صف أو شعبة الطالب` };
  if (compatible.length > 1) return { subject: null, error: `توجد عدة مواد مطابقة لـ"${sourceName}"؛ اختر المادة يدوياً` };
  return { subject: compatible[0] };
}

function validateResolvedStudentPlacement(student: GradeImportStudent, context: GradeImportContext): string | null {
  const activeClass = context.classes.find(item => item.id === student.class_id && item.school_id === context.schoolId && item.status === 'active');
  if (!activeClass) return 'صف الطالب غير موجود أو غير نشط في المدرسة المستهدفة';
  if (student.section_id != null) {
    const activeSection = context.sections.find(item => item.id === student.section_id && item.school_id === context.schoolId && item.status === 'active');
    if (!activeSection) return 'شعبة الطالب غير موجودة أو غير نشطة في المدرسة المستهدفة';
    if (activeSection.class_id !== activeClass.id) return 'شعبة الطالب لا تتبع صفه الحالي';
  }
  return null;
}

function parseGradeCell(
  value: unknown,
  field: RawGradeField,
  settings: GradeCalculationSettings,
  clearEmptyFields: boolean,
): { imported: boolean; value?: number | null; error?: string } {
  if (isExcelErrorValue(value)) return { imported: false, error: `قيمة Excel غير صالحة في ${field}` };
  const text = String(value ?? '').trim();
  if (value == null || EMPTY_MARKERS.has(text)) return clearEmptyFields ? { imported: true, value: null } : { imported: false };
  if (!/^-?\d+(?:\.\d+)?$/u.test(text)) return { imported: false, error: `القيمة "${text}" في ${field} ليست درجة رقمية` };
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > settings.max_grade) {
    return { imported: false, error: `القيمة في ${field} يجب أن تكون بين ٠ و ${settings.max_grade}` };
  }
  return { imported: true, value: numeric };
}

export function buildGradeImportPlan(payload: GradeImportPayload, context: GradeImportContext): GradeImportPlan {
  const mode = payload.mode || 'update_existing';
  const assignmentMode = payload.assignment_mode || 'strict_existing_assignments';
  const clearEmptyFields = payload.clear_empty_fields === true;
  const errors: GradeImportIssue[] = [];
  const warnings: GradeImportIssue[] = [];
  const duplicates: GradeImportIssue[] = [];
  const records: PlannedGradeImportRecord[] = [];
  const matchedStudentIds = new Set<number>();
  const seenSubjects = new Map<string, string>();
  const seenRecords = new Map<string, PlannedGradeImportRecord>();
  const gradeByAssignment = new Map(context.grades.filter(grade => grade.school_id === context.schoolId).map(grade => [grade.student_subject_id, grade]));
  const assignmentsByIdentity = new Map<string, GradeImportAssignment[]>();
  for (const assignment of context.assignments.filter(item => item.school_id === context.schoolId)) {
    const key = assignmentKey(assignment.student_id, assignment.subject_id);
    const values = assignmentsByIdentity.get(key) || [];
    values.push(assignment);
    assignmentsByIdentity.set(key, values);
  }
  for (const values of assignmentsByIdentity.values()) {
    values.sort((left, right) => Number(right.is_active) - Number(left.is_active) || Number(gradeByAssignment.has(right.id)) - Number(gradeByAssignment.has(left.id)) || right.id - left.id);
  }

  const sheetSummaries: GradeSheetPlanSummary[] = payload.grade_sheets.map(sheet => ({
    sheet_name: sheet.sheet_name,
    subject_name: sheet.subject_name || null,
    source_rows: sheet.rows.length,
    valid_rows: 0,
    new_rows: 0,
    update_rows: 0,
    noop_rows: 0,
    error_rows: 0,
    warning_rows: 0,
  }));
  const summaryBySheet = new Map(sheetSummaries.map(summary => [summary.sheet_name, summary]));

  for (const sheet of payload.grade_sheets) {
    const summary = summaryBySheet.get(sheet.sheet_name)!;
    const manualPlacementErrors = validateManualPlacement(sheet, context);
    errors.push(...manualPlacementErrors);
    summary.error_rows += manualPlacementErrors.length;

    const identityMapped = Boolean(sheet.mapping.student_number || sheet.mapping.full_name);
    if (!identityMapped) {
      errors.push(issue(sheet.sheet_name, null, 'student', 'يجب تعيين رقم الطالب/القيد أو اسم الطالب'));
      summary.error_rows += 1;
    }
    const rawMappings = RAW_GRADE_FIELDS.filter(field => Boolean(sheet.mapping[field]));
    if (!rawMappings.length) {
      errors.push(issue(sheet.sheet_name, null, 'grade_mapping', 'يجب تعيين حقل درجة خام واحد على الأقل'));
      summary.error_rows += 1;
    }
    const calculatedAsRaw = rawMappings.filter(field => {
      const source = sheet.mapping[field];
      return source && isCalculatedGradeHeader(sheet.column_headers?.[source]);
    });
    for (const field of calculatedAsRaw) {
      errors.push(issue(sheet.sheet_name, null, field, 'لا يمكن ربط عمود محسوب بحقل درجة خام؛ سيعيد Smart School حساب هذا العمود'));
      summary.error_rows += 1;
    }
    for (const calculated of CALCULATED_GRADE_FIELDS) {
      if (sheet.mapping[calculated]) {
        warnings.push(issue(sheet.sheet_name, null, calculated, 'سيتم تجاهل العمود المحسوب؛ سيعيد Smart School حسابه'));
        summary.warning_rows += 1;
      }
    }
    const subjectKey = rawSheetSubjectKey(sheet);
    if (subjectKey) {
      const firstSheet = seenSubjects.get(subjectKey);
      if (firstSheet && firstSheet !== sheet.sheet_name) {
        errors.push(issue(sheet.sheet_name, null, 'subject', `المادة نفسها محددة أيضاً في الورقة "${firstSheet}"`));
        summary.error_rows += 1;
      } else seenSubjects.set(subjectKey, sheet.sheet_name);
    }

    if (manualPlacementErrors.length || !identityMapped || !rawMappings.length || calculatedAsRaw.length) continue;

    sheet.rows.forEach((row, rowIndex) => {
      const rowNumber = excelRowNumber(row, rowIndex);
      const mappedSources = Object.values(sheet.mapping).filter(Boolean);
      const hasMappedContent = mappedSources.some(source => textValue(row[source]) != null);
      if (!hasMappedContent) {
        warnings.push(issue(sheet.sheet_name, rowNumber, 'row', 'صف Excel فارغ وتم تجاهله'));
        summary.noop_rows += 1;
        summary.warning_rows += 1;
        return;
      }

      const parsedGrades: Partial<Record<RawGradeField, number | null>> = {};
      const importedFields = new Set<RawGradeField | 'notes'>();
      let rowFatal = false;
      for (const field of RAW_GRADE_FIELDS) {
        if (!sheet.mapping[field]) continue;
        const parsed = parseGradeCell(mappedValue(row, sheet.mapping, field), field, context.settings, clearEmptyFields);
        if (parsed.error) {
          errors.push(issue(sheet.sheet_name, rowNumber, field, parsed.error));
          rowFatal = true;
        } else if (parsed.imported) {
          parsedGrades[field] = parsed.value ?? null;
          importedFields.add(field);
        }
      }
      let importedNotes: string | null | undefined;
      if (sheet.mapping.notes) {
        const rawNotes = mappedValue(row, sheet.mapping, 'notes');
        if (isExcelErrorValue(rawNotes)) {
          errors.push(issue(sheet.sheet_name, rowNumber, 'notes', 'قيمة Excel غير صالحة في الملاحظات'));
          rowFatal = true;
        } else {
          const notesText = String(rawNotes ?? '').trim();
          if (notesText) {
            importedNotes = notesText;
            importedFields.add('notes');
          } else if (clearEmptyFields) {
            importedNotes = null;
            importedFields.add('notes');
          }
        }
      }
      if (rowFatal) {
        summary.error_rows += 1;
        return;
      }

      const hasNonNullRawGrade = RAW_GRADE_FIELDS.some(field => parsedGrades[field] != null);
      const hasRawGradeInstruction = RAW_GRADE_FIELDS.some(field => importedFields.has(field));
      if (!hasRawGradeInstruction && importedNotes === undefined) {
        warnings.push(issue(sheet.sheet_name, rowNumber, 'grade', 'لا توجد درجات خام في الصف؛ تم اعتباره بلا تغيير'));
        summary.noop_rows += 1;
        summary.warning_rows += 1;
        return;
      }

      const studentResolution = resolveStudent(sheet, row, context);
      if (!studentResolution.student) {
        errors.push(issue(sheet.sheet_name, rowNumber, 'student', studentResolution.error || 'تعذر تحديد الطالب'));
        summary.error_rows += 1;
        return;
      }
      const student = studentResolution.student;
      const placementError = validateResolvedStudentPlacement(student, context);
      if (placementError) {
        errors.push(issue(sheet.sheet_name, rowNumber, 'student_placement', placementError));
        summary.error_rows += 1;
        return;
      }
      const subjectResolution = resolveSubject(sheet, row, student, context);
      if (!subjectResolution.subject) {
        errors.push(issue(sheet.sheet_name, rowNumber, 'subject', subjectResolution.error || 'تعذر تحديد المادة'));
        summary.error_rows += 1;
        return;
      }
      const subject = subjectResolution.subject;
      matchedStudentIds.add(student.id);

      const key = assignmentKey(student.id, subject.id);
      const assignment = assignmentsByIdentity.get(key)?.[0] || null;
      if (assignment && (assignment.class_id !== student.class_id || assignment.section_id !== student.section_id)) {
        errors.push(issue(sheet.sheet_name, rowNumber, 'assignment', 'تسجيل الطالب في المادة لا يطابق صفه أو شعبته الحالية'));
        summary.error_rows += 1;
        return;
      }
      const existingGrade = assignment ? gradeByAssignment.get(assignment.id) || null : null;
      if (existingGrade && mode === 'skip_existing') {
        duplicates.push(issue(sheet.sheet_name, rowNumber, 'grade', 'درجة موجودة مسبقاً وتم تخطيها حسب وضع الاستيراد'));
        summary.noop_rows += 1;
        return;
      }
      if (existingGrade && mode === 'error_on_existing') {
        errors.push(issue(sheet.sheet_name, rowNumber, 'grade', 'درجة موجودة مسبقاً لهذا الطالب في هذه المادة'));
        summary.error_rows += 1;
        return;
      }

      let assignmentAction: PlannedGradeImportRecord['assignment_action'] = 'none';
      if (!assignment || !assignment.is_active) {
        if (assignmentMode === 'strict_existing_assignments') {
          errors.push(issue(sheet.sheet_name, rowNumber, 'assignment', assignment ? 'التسجيل في المادة غير نشط' : 'الطالب غير مسجل في هذه المادة'));
          summary.error_rows += 1;
          return;
        }
        assignmentAction = assignment ? 'reactivate' : 'create';
      }

      const existingValues: Partial<Record<RawGradeField | 'notes', number | string | null>> = {};
      const values = {} as RawGradeValues & { notes: string | null };
      for (const field of RAW_GRADE_FIELDS) {
        const oldValue = existingGrade?.[field] ?? null;
        existingValues[field] = oldValue;
        values[field] = importedFields.has(field) ? (parsedGrades[field] ?? null) : oldValue;
      }
      const oldNotes = existingGrade?.notes ?? null;
      existingValues.notes = oldNotes;
      values.notes = importedNotes !== undefined ? importedNotes : oldNotes;
      const changedFields = IMPORTABLE_FIELDS.filter(field => !equalValue(existingValues[field], values[field]));

      if (!existingGrade && !hasNonNullRawGrade) {
        warnings.push(issue(sheet.sheet_name, rowNumber, 'grade', 'لا توجد درجة خام غير فارغة لإنشاء سجل جديد؛ تم التخطي'));
        summary.noop_rows += 1;
        summary.warning_rows += 1;
        return;
      }
      if (existingGrade && !changedFields.length) {
        warnings.push(issue(sheet.sheet_name, rowNumber, 'grade', 'القيم مطابقة للدرجات الموجودة؛ لا يوجد تغيير'));
        summary.noop_rows += 1;
        summary.warning_rows += 1;
        return;
      }

      const planned: PlannedGradeImportRecord = {
        sheet_name: sheet.sheet_name,
        excel_row_number: rowNumber,
        student_id: student.id,
        student_number: student.student_number,
        student_name: student.full_name,
        class_id: student.class_id,
        class_name: context.classes.find(item => item.id === student.class_id)?.name || null,
        section_id: student.section_id,
        section_name: context.sections.find(item => item.id === student.section_id)?.name || null,
        subject_id: subject.id,
        subject_name: subject.name,
        assignment_id: assignment?.id || null,
        assignment_action: assignmentAction,
        existing_grade_id: existingGrade?.id || null,
        action: existingGrade ? 'update' : 'create',
        values,
        calculated: calculateGrades(values, context.settings),
        changed_fields: changedFields,
        existing_values: existingValues,
      };

      const duplicateKey = assignmentKey(student.id, subject.id);
      const previous = seenRecords.get(duplicateKey);
      if (previous) {
        if (samePlannedValues(previous, planned)) {
          duplicates.push(issue(sheet.sheet_name, rowNumber, 'duplicate', `تكرار مطابق للسجل في ${previous.sheet_name} — Excel row ${previous.excel_row_number}`));
          summary.noop_rows += 1;
        } else {
          errors.push(issue(sheet.sheet_name, rowNumber, 'conflict', `قيم متعارضة مع السجل في ${previous.sheet_name} — Excel row ${previous.excel_row_number}`));
          summary.error_rows += 1;
        }
        return;
      }
      seenRecords.set(duplicateKey, planned);
      records.push(planned);
      summary.valid_rows += 1;
      if (planned.action === 'create') summary.new_rows += 1;
      else summary.update_rows += 1;
    });
  }

  return {
    mode,
    assignment_mode: assignmentMode,
    clear_empty_fields: clearEmptyFields,
    records,
    errors,
    warnings,
    duplicates,
    sheets: sheetSummaries,
    summary: {
      sheets_selected: payload.grade_sheets.length,
      total_source_rows: sheetSummaries.reduce((sum, sheet) => sum + sheet.source_rows, 0),
      matched_students: matchedStudentIds.size,
      valid_grade_rows: records.length,
      new_grade_rows: records.filter(record => record.action === 'create').length,
      update_rows: records.filter(record => record.action === 'update').length,
      noop_rows: sheetSummaries.reduce((sum, sheet) => sum + sheet.noop_rows, 0),
      duplicate_rows: duplicates.length,
      assignment_creates: records.filter(record => record.assignment_action === 'create').length,
      assignment_reactivations: records.filter(record => record.assignment_action === 'reactivate').length,
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}
