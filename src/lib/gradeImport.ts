import { calculateGrades, type CalculatedGradeValues, type GradeCalculationSettings, type RawGradeValues } from './gradeCalculations.ts';
import { isExcelErrorValue, normalizeHeader, normalizeSectionName, normalizeSubjectName } from './excel/normalizers.ts';
import { CALCULATED_GRADE_FIELDS, RAW_GRADE_FIELDS, type RawGradeField } from './excel/types.ts';
import { isCalculatedGradeHeader } from './excel/gradeSemantics.ts';
import { normalizeStudentIdentity } from './studentImport.ts';

export type GradeImportMode = 'update_existing' | 'skip_existing' | 'error_on_existing';
export type GradeAssignmentMode = 'strict_existing_assignments' | 'auto_assign_missing_subjects';
export type GradeSubjectSourceMode = 'fixed' | 'column' | 'inferred';
export type GradeSpecialValueAction = 'not_applicable';

export interface DiscoveredGradeSpecialMarker {
  value: string;
  normalized_value: string;
  count: number;
  fields: RawGradeField[];
}

export interface GradeImportSourcePayload {
  source_id: string;
  sheet_name: string;
  region_id?: string | null;
  row_start?: number | null;
  row_end?: number | null;
  rows: Array<Record<string, unknown>>;
  mapping: Record<string, string>;
  column_headers?: Record<string, string>;
  subject_source?: GradeSubjectSourceMode;
  subject_id?: number | null;
  subject_name?: string | null;
  metadata_subject_name?: string | null;
  class_id?: number | null;
  section_id?: number | null;
  special_values?: Record<string, GradeSpecialValueAction>;
}

/** @deprecated Use GradeImportSourcePayload. Kept for request compatibility. */
export type GradeImportSheetPayload = GradeImportSourcePayload;

export interface GradeImportPayload {
  grade_sources?: GradeImportSourcePayload[];
  /** @deprecated Accepted for compatibility with the first Phase 2 preview payload. */
  grade_sheets?: GradeImportSourcePayload[];
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
  source_id: string;
  sheet: string;
  region: string | null;
  row: number | null;
  field: string;
  message: string;
  label: string;
}

export interface PlannedGradeImportRecord {
  source_id: string;
  sheet_name: string;
  region_id: string | null;
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

export interface PlannedNotApplicableGradeRecord {
  source_id: string;
  sheet_name: string;
  region_id: string | null;
  excel_row_number: number;
  student_id: number;
  student_number: string | null;
  student_name: string;
  subject_id: number;
  subject_name: string;
  markers: Array<{ field: RawGradeField; value: string }>;
}

export interface GradeSourcePlanSummary {
  source_id: string;
  sheet_name: string;
  region_id: string | null;
  row_start: number | null;
  row_end: number | null;
  subject_source: GradeSubjectSourceMode;
  subject_name: string | null;
  source_rows: number;
  valid_rows: number;
  new_rows: number;
  update_rows: number;
  noop_rows: number;
  not_applicable_rows: number;
  error_rows: number;
  warning_rows: number;
  discovered_markers: DiscoveredGradeSpecialMarker[];
}

export interface GradeImportPlan {
  mode: GradeImportMode;
  assignment_mode: GradeAssignmentMode;
  clear_empty_fields: boolean;
  records: PlannedGradeImportRecord[];
  not_applicable: PlannedNotApplicableGradeRecord[];
  errors: GradeImportIssue[];
  warnings: GradeImportIssue[];
  duplicates: GradeImportIssue[];
  sources: GradeSourcePlanSummary[];
  summary: {
    sheets_selected: number;
    sources_selected: number;
    total_source_rows: number;
    matched_students: number;
    valid_grade_rows: number;
    new_grade_rows: number;
    update_rows: number;
    noop_rows: number;
    not_applicable_rows: number;
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
const NUMERIC_GRADE_PATTERN = /^-?\d+(?:\.\d+)?$/u;

export function normalizeGradeSpecialMarker(value: unknown): string {
  return normalizeHeader(value);
}

export function discoverGradeSpecialMarkers(
  rows: Array<Record<string, unknown>>,
  mapping: Record<string, string>,
): DiscoveredGradeSpecialMarker[] {
  const discovered = new Map<string, { value: string; count: number; fields: Set<RawGradeField> }>();
  for (const row of rows) {
    for (const field of RAW_GRADE_FIELDS) {
      const sourceColumn = mapping[field];
      if (!sourceColumn) continue;
      const rawValue = row[sourceColumn];
      if (rawValue == null || isExcelErrorValue(rawValue)) continue;
      const value = String(rawValue).trim();
      if (EMPTY_MARKERS.has(value) || NUMERIC_GRADE_PATTERN.test(value)) continue;
      const normalized = normalizeGradeSpecialMarker(value);
      if (!normalized) continue;
      const existing = discovered.get(normalized) || { value, count: 0, fields: new Set<RawGradeField>() };
      existing.count += 1;
      existing.fields.add(field);
      discovered.set(normalized, existing);
    }
  }
  return [...discovered.entries()]
    .map(([normalized_value, marker]) => ({
      value: marker.value,
      normalized_value,
      count: marker.count,
      fields: [...marker.fields],
    }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function sourceDisplay(source: Pick<GradeImportSourcePayload, 'sheet_name' | 'region_id'>): string {
  return source.region_id ? `${source.sheet_name} — Region ${source.region_id}` : source.sheet_name;
}

function issue(source: GradeImportSourcePayload, row: number | null, field: string, message: string): GradeImportIssue {
  const display = sourceDisplay(source);
  return {
    source_id: source.source_id,
    sheet: source.sheet_name,
    region: source.region_id || null,
    row,
    field,
    message,
    label: row == null ? display : `${display} — Excel row ${row}`,
  };
}

function gradeSources(payload: GradeImportPayload): GradeImportSourcePayload[] {
  const provided = payload.grade_sources || payload.grade_sheets || [];
  return provided.map((source, index) => ({
    ...source,
    source_id: String(source.source_id || `${source.sheet_name}:region:${index + 1}`),
    region_id: source.region_id || null,
  }));
}

function subjectSourceMode(source: GradeImportSourcePayload): GradeSubjectSourceMode {
  if (source.subject_source) return source.subject_source;
  if (source.subject_id != null) return 'fixed';
  if (source.mapping.subject_name) return 'column';
  return 'inferred';
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

function hasMeaningfulRawGrade(grade: ExistingGradeImportRecord | null | undefined): boolean {
  return Boolean(grade && RAW_GRADE_FIELDS.some(field => typeof grade[field] === 'number' && Number.isFinite(grade[field])));
}

function validateManualPlacement(
  sheet: GradeImportSourcePayload,
  context: GradeImportContext,
): GradeImportIssue[] {
  const errors: GradeImportIssue[] = [];
  const targetClass = sheet.class_id == null ? null : context.classes.find(item => item.id === Number(sheet.class_id) && item.school_id === context.schoolId && item.status === 'active');
  const targetSection = sheet.section_id == null ? null : context.sections.find(item => item.id === Number(sheet.section_id) && item.school_id === context.schoolId && item.status === 'active');
  if (sheet.class_id != null && !targetClass) errors.push(issue(sheet, null, 'class_id', 'الصف اليدوي غير موجود أو غير نشط في المدرسة المستهدفة'));
  if (sheet.section_id != null && !targetSection) errors.push(issue(sheet, null, 'section_id', 'الشعبة اليدوية غير موجودة أو غير نشطة في المدرسة المستهدفة'));
  if (targetClass && targetSection && targetSection.class_id !== targetClass.id) errors.push(issue(sheet, null, 'section_id', 'الشعبة اليدوية لا تتبع الصف اليدوي المحدد'));
  return errors;
}

function resolveStudent(
  sheet: GradeImportSourcePayload,
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
  sheet: GradeImportSourcePayload,
  row: Record<string, unknown>,
  student: GradeImportStudent,
  context: GradeImportContext,
): { subject: GradeImportSubject | null; error?: string } {
  const subjects = context.subjects.filter(subject => subject.school_id === context.schoolId && subject.status !== 'archived');
  const mode = subjectSourceMode(sheet);
  if (mode === 'fixed') {
    if (sheet.subject_id == null) return { subject: null, error: 'يجب اختيار مادة ثابتة لهذا المصدر' };
    const subject = subjects.find(item => item.id === Number(sheet.subject_id));
    if (!subject) return { subject: null, error: 'المادة المحددة غير موجودة في المدرسة المستهدفة' };
    if (!compatibleSubject(subject, student)) return { subject: null, error: 'المادة المحددة لا تتوافق مع صف أو شعبة الطالب' };
    return { subject };
  }

  const sourceName = mode === 'column'
    ? textValue(mappedValue(row, sheet.mapping, 'subject_name'))
    : textValue(sheet.metadata_subject_name) || textValue(sheet.subject_name) || sheet.sheet_name;
  if (mode === 'column' && !sourceName) return { subject: null, error: 'اسم المادة مفقود في عمود المادة لهذا الصف' };
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

type ParsedGradeCell =
  | { kind: 'blank'; imported: boolean; value?: null }
  | { kind: 'numeric'; imported: true; value: number }
  | { kind: 'special_marker'; imported: false; action: GradeSpecialValueAction; marker: string }
  | { kind: 'invalid_text'; imported: false; error: string };

function normalizedSpecialValueActions(source: GradeImportSourcePayload): Map<string, GradeSpecialValueAction> {
  const actions = new Map<string, GradeSpecialValueAction>();
  for (const [marker, action] of Object.entries(source.special_values || {})) {
    const normalized = normalizeGradeSpecialMarker(marker);
    if (normalized && action === 'not_applicable') actions.set(normalized, action);
  }
  return actions;
}

function parseGradeCell(
  value: unknown,
  field: RawGradeField,
  settings: GradeCalculationSettings,
  clearEmptyFields: boolean,
  specialValueActions: ReadonlyMap<string, GradeSpecialValueAction>,
): ParsedGradeCell {
  if (isExcelErrorValue(value)) return { kind: 'invalid_text', imported: false, error: `قيمة Excel غير صالحة في ${field}` };
  const text = String(value ?? '').trim();
  if (value == null || EMPTY_MARKERS.has(text)) {
    return clearEmptyFields ? { kind: 'blank', imported: true, value: null } : { kind: 'blank', imported: false };
  }
  if (!NUMERIC_GRADE_PATTERN.test(text)) {
    const action = specialValueActions.get(normalizeGradeSpecialMarker(text));
    if (action) return { kind: 'special_marker', imported: false, action, marker: text };
    return { kind: 'invalid_text', imported: false, error: `القيمة "${text}" في ${field} ليست درجة رقمية ولم يتم تفسيرها كقيمة خاصة` };
  }
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > settings.max_grade) {
    return { kind: 'invalid_text', imported: false, error: `القيمة في ${field} يجب أن تكون بين ٠ و ${settings.max_grade}` };
  }
  return { kind: 'numeric', imported: true, value: numeric };
}

export function buildGradeImportPlan(payload: GradeImportPayload, context: GradeImportContext): GradeImportPlan {
  const mode = payload.mode || 'update_existing';
  const assignmentMode = payload.assignment_mode || 'strict_existing_assignments';
  const clearEmptyFields = payload.clear_empty_fields === true;
  const sources = gradeSources(payload);
  const errors: GradeImportIssue[] = [];
  const warnings: GradeImportIssue[] = [];
  const duplicates: GradeImportIssue[] = [];
  const records: PlannedGradeImportRecord[] = [];
  const notApplicable: PlannedNotApplicableGradeRecord[] = [];
  const matchedStudentIds = new Set<number>();
  const seenRecords = new Map<string, PlannedGradeImportRecord>();
  const notApplicableByIdentity = new Map<string, PlannedNotApplicableGradeRecord>();
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

  const sourceSummaries: GradeSourcePlanSummary[] = sources.map(source => {
    const sourceMode = subjectSourceMode(source);
    const fixedSubject = sourceMode === 'fixed'
      ? context.subjects.find(subject => subject.school_id === context.schoolId && subject.id === Number(source.subject_id))
      : null;
    return {
      source_id: source.source_id,
      sheet_name: source.sheet_name,
      region_id: source.region_id || null,
      row_start: source.row_start ?? null,
      row_end: source.row_end ?? null,
      subject_source: sourceMode,
      subject_name: sourceMode === 'column' ? null : fixedSubject?.name || source.subject_name || source.metadata_subject_name || null,
      source_rows: source.rows.length,
      valid_rows: 0,
      new_rows: 0,
      update_rows: 0,
      noop_rows: 0,
      not_applicable_rows: 0,
      error_rows: 0,
      warning_rows: 0,
      discovered_markers: discoverGradeSpecialMarkers(source.rows, source.mapping),
    };
  });
  const summaryBySource = new Map(sourceSummaries.map(summary => [summary.source_id, summary]));

  for (const sheet of sources) {
    const summary = summaryBySource.get(sheet.source_id)!;
    const specialValueActions = normalizedSpecialValueActions(sheet);
    const manualPlacementErrors = validateManualPlacement(sheet, context);
    errors.push(...manualPlacementErrors);
    summary.error_rows += manualPlacementErrors.length;

    const identityMapped = Boolean(sheet.mapping.student_number || sheet.mapping.full_name);
    if (!identityMapped) {
      errors.push(issue(sheet, null, 'student', 'يجب تعيين رقم الطالب/القيد أو اسم الطالب'));
      summary.error_rows += 1;
    }
    const rawMappings = RAW_GRADE_FIELDS.filter(field => Boolean(sheet.mapping[field]));
    if (!rawMappings.length) {
      errors.push(issue(sheet, null, 'grade_mapping', 'يجب تعيين حقل درجة خام واحد على الأقل'));
      summary.error_rows += 1;
    }
    const calculatedAsRaw = rawMappings.filter(field => {
      const source = sheet.mapping[field];
      return source && isCalculatedGradeHeader(sheet.column_headers?.[source]);
    });
    for (const field of calculatedAsRaw) {
      errors.push(issue(sheet, null, field, 'لا يمكن ربط عمود محسوب بحقل درجة خام؛ سيعيد Smart School حساب هذا العمود'));
      summary.error_rows += 1;
    }
    for (const calculated of CALCULATED_GRADE_FIELDS) {
      if (sheet.mapping[calculated]) {
        warnings.push(issue(sheet, null, calculated, 'سيتم تجاهل العمود المحسوب؛ سيعيد Smart School حسابه'));
        summary.warning_rows += 1;
      }
    }
    const sourceMode = subjectSourceMode(sheet);
    if (sourceMode === 'column' && !sheet.mapping.subject_name) {
      errors.push(issue(sheet, null, 'subject_name', 'يجب تعيين عمود المادة عند اختيار المادة من العمود'));
      summary.error_rows += 1;
    }
    if (sourceMode === 'fixed' && sheet.subject_id == null) {
      errors.push(issue(sheet, null, 'subject_id', 'يجب اختيار مادة ثابتة لهذا المصدر'));
      summary.error_rows += 1;
    }

    if (manualPlacementErrors.length || !identityMapped || !rawMappings.length || calculatedAsRaw.length
      || (sourceMode === 'column' && !sheet.mapping.subject_name)
      || (sourceMode === 'fixed' && sheet.subject_id == null)) continue;

    sheet.rows.forEach((row, rowIndex) => {
      const rowNumber = excelRowNumber(row, rowIndex);
      const mappedSources = Object.values(sheet.mapping).filter(Boolean);
      const hasMappedContent = mappedSources.some(source => textValue(row[source]) != null);
      if (!hasMappedContent) {
        warnings.push(issue(sheet, rowNumber, 'row', 'صف Excel فارغ وتم تجاهله'));
        summary.noop_rows += 1;
        summary.warning_rows += 1;
        return;
      }

      const parsedGrades: Partial<Record<RawGradeField, number | null>> = {};
      const importedFields = new Set<RawGradeField | 'notes'>();
      const specialMarkers: Array<{ field: RawGradeField; value: string }> = [];
      let rowFatal = false;
      for (const field of RAW_GRADE_FIELDS) {
        if (!sheet.mapping[field]) continue;
        const parsed = parseGradeCell(mappedValue(row, sheet.mapping, field), field, context.settings, clearEmptyFields, specialValueActions);
        if (parsed.kind === 'invalid_text') {
          errors.push(issue(sheet, rowNumber, field, parsed.error));
          rowFatal = true;
        } else if (parsed.kind === 'special_marker') {
          specialMarkers.push({ field, value: parsed.marker });
        } else if (parsed.imported) {
          parsedGrades[field] = parsed.value ?? null;
          importedFields.add(field);
        }
      }
      let importedNotes: string | null | undefined;
      if (sheet.mapping.notes) {
        const rawNotes = mappedValue(row, sheet.mapping, 'notes');
        if (isExcelErrorValue(rawNotes)) {
          errors.push(issue(sheet, rowNumber, 'notes', 'قيمة Excel غير صالحة في الملاحظات'));
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
      if (specialMarkers.length > 0 && hasNonNullRawGrade) {
        errors.push(issue(sheet, rowNumber, 'special_value_conflict', 'يحتوي الصف على قيمة غير منطبقة ودرجة رقمية معاً؛ راجع القيم قبل الاستيراد'));
        summary.error_rows += 1;
        return;
      }
      if (!hasRawGradeInstruction && specialMarkers.length === 0 && importedNotes === undefined) {
        warnings.push(issue(sheet, rowNumber, 'grade', 'لا توجد درجات خام في الصف؛ تم اعتباره بلا تغيير'));
        summary.noop_rows += 1;
        summary.warning_rows += 1;
        return;
      }

      const studentResolution = resolveStudent(sheet, row, context);
      if (!studentResolution.student) {
        errors.push(issue(sheet, rowNumber, 'student', studentResolution.error || 'تعذر تحديد الطالب'));
        summary.error_rows += 1;
        return;
      }
      const student = studentResolution.student;
      const placementError = validateResolvedStudentPlacement(student, context);
      if (placementError) {
        errors.push(issue(sheet, rowNumber, 'student_placement', placementError));
        summary.error_rows += 1;
        return;
      }
      const subjectResolution = resolveSubject(sheet, row, student, context);
      if (!subjectResolution.subject) {
        errors.push(issue(sheet, rowNumber, 'subject', subjectResolution.error || 'تعذر تحديد المادة'));
        summary.error_rows += 1;
        return;
      }
      const subject = subjectResolution.subject;
      matchedStudentIds.add(student.id);

      const key = assignmentKey(student.id, subject.id);
      const existingAssignments = assignmentsByIdentity.get(key) || [];
      const assignment = existingAssignments[0] || null;
      const existingGrade = assignment ? gradeByAssignment.get(assignment.id) || null : null;
      if (specialMarkers.length > 0) {
        const previousGrade = seenRecords.get(key);
        if (previousGrade) {
          errors.push(issue(sheet, rowNumber, 'special_value_conflict', `القيمة غير المنطبقة تتعارض مع درجات رقمية في ${previousGrade.sheet_name} — Excel row ${previousGrade.excel_row_number}`));
          summary.error_rows += 1;
          return;
        }
        const previousNotApplicable = notApplicableByIdentity.get(key);
        if (previousNotApplicable) {
          duplicates.push(issue(sheet, rowNumber, 'duplicate', `تكرار غير منطبق للسجل في ${previousNotApplicable.sheet_name} — Excel row ${previousNotApplicable.excel_row_number}`));
          summary.noop_rows += 1;
          return;
        }
        const conflictingStoredGrade = existingAssignments
          .map(existingAssignment => gradeByAssignment.get(existingAssignment.id))
          .find(hasMeaningfulRawGrade);
        if (conflictingStoredGrade) {
          errors.push(issue(sheet, rowNumber, 'special_value_conflict', 'توجد درجات رقمية محفوظة لهذا الطالب في هذه المادة وتتعارض مع علامة غير منطبق؛ لم تتغير البيانات ويتطلب الأمر مراجعة إدارية'));
          summary.error_rows += 1;
          return;
        }
        if (assignment) {
          const state = assignment.is_active ? 'نشطاً' : 'غير نشط';
          warnings.push(issue(sheet, rowNumber, 'existing_assignment', `يوجد تسجيل ${state} للطالب في المادة وسيبقى دون تغيير؛ علامة غير منطبق لا تزيل التسجيل وتتطلب مراجعة إدارية`));
          summary.warning_rows += 1;
        }
        const skipped: PlannedNotApplicableGradeRecord = {
          source_id: sheet.source_id,
          sheet_name: sheet.sheet_name,
          region_id: sheet.region_id || null,
          excel_row_number: rowNumber,
          student_id: student.id,
          student_number: student.student_number,
          student_name: student.full_name,
          subject_id: subject.id,
          subject_name: subject.name,
          markers: specialMarkers,
        };
        notApplicableByIdentity.set(key, skipped);
        notApplicable.push(skipped);
        summary.not_applicable_rows += 1;
        return;
      }

      const previousNotApplicable = notApplicableByIdentity.get(key);
      if (previousNotApplicable) {
        errors.push(issue(sheet, rowNumber, 'special_value_conflict', `الدرجات الرقمية تتعارض مع قيمة غير منطبقة في ${previousNotApplicable.sheet_name} — Excel row ${previousNotApplicable.excel_row_number}`));
        summary.error_rows += 1;
        return;
      }
      if (assignment && (assignment.class_id !== student.class_id || assignment.section_id !== student.section_id)) {
        errors.push(issue(sheet, rowNumber, 'assignment', 'تسجيل الطالب في المادة لا يطابق صفه أو شعبته الحالية'));
        summary.error_rows += 1;
        return;
      }
      if (existingGrade && mode === 'skip_existing') {
        duplicates.push(issue(sheet, rowNumber, 'grade', 'درجة موجودة مسبقاً وتم تخطيها حسب وضع الاستيراد'));
        summary.noop_rows += 1;
        return;
      }
      if (existingGrade && mode === 'error_on_existing') {
        errors.push(issue(sheet, rowNumber, 'grade', 'درجة موجودة مسبقاً لهذا الطالب في هذه المادة'));
        summary.error_rows += 1;
        return;
      }

      let assignmentAction: PlannedGradeImportRecord['assignment_action'] = 'none';
      if (!assignment || !assignment.is_active) {
        if (assignmentMode === 'strict_existing_assignments') {
          errors.push(issue(sheet, rowNumber, 'assignment', assignment ? 'التسجيل في المادة غير نشط' : 'الطالب غير مسجل في هذه المادة'));
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
        warnings.push(issue(sheet, rowNumber, 'grade', 'لا توجد درجة خام غير فارغة لإنشاء سجل جديد؛ تم التخطي'));
        summary.noop_rows += 1;
        summary.warning_rows += 1;
        return;
      }
      if (existingGrade && !changedFields.length) {
        warnings.push(issue(sheet, rowNumber, 'grade', 'القيم مطابقة للدرجات الموجودة؛ لا يوجد تغيير'));
        summary.noop_rows += 1;
        summary.warning_rows += 1;
        return;
      }

      const planned: PlannedGradeImportRecord = {
        source_id: sheet.source_id,
        sheet_name: sheet.sheet_name,
        region_id: sheet.region_id || null,
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
        const previousSource = previous.region_id ? `${previous.sheet_name} — Region ${previous.region_id}` : previous.sheet_name;
        if (samePlannedValues(previous, planned)) {
          duplicates.push(issue(sheet, rowNumber, 'duplicate', `تكرار مطابق للسجل في ${previousSource} — Excel row ${previous.excel_row_number}`));
          summary.noop_rows += 1;
        } else {
          errors.push(issue(sheet, rowNumber, 'conflict', `قيم متعارضة مع السجل في ${previousSource} — Excel row ${previous.excel_row_number}`));
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
    not_applicable: notApplicable,
    errors,
    warnings,
    duplicates,
    sources: sourceSummaries,
    summary: {
      sheets_selected: new Set(sources.map(source => source.sheet_name)).size,
      sources_selected: sources.length,
      total_source_rows: sourceSummaries.reduce((sum, source) => sum + source.source_rows, 0),
      matched_students: matchedStudentIds.size,
      valid_grade_rows: records.length,
      new_grade_rows: records.filter(record => record.action === 'create').length,
      update_rows: records.filter(record => record.action === 'update').length,
      noop_rows: sourceSummaries.reduce((sum, source) => sum + source.noop_rows, 0),
      not_applicable_rows: notApplicable.length,
      duplicate_rows: duplicates.length,
      assignment_creates: records.filter(record => record.assignment_action === 'create').length,
      assignment_reactivations: records.filter(record => record.assignment_action === 'reactivate').length,
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}
