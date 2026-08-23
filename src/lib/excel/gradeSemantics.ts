import { isExcelErrorValue, normalizeHeader, normalizeSubjectName } from './normalizers.ts';
import type {
  ColumnProfile,
  ExcelSubjectOption,
  FieldCandidate,
  FieldInference,
  GradeFieldInference,
  GradeSemanticField,
  MetadataCandidate,
  SubjectInference,
  WorksheetAnalysis,
} from './types.ts';
import { RAW_GRADE_FIELDS } from './types.ts';

type GradeFieldDefinition = {
  kind: GradeFieldInference['kind'];
  aliases: string[];
};

export const GRADE_FIELD_DEFINITIONS: Partial<Record<GradeSemanticField, GradeFieldDefinition>> = {
  subject_name: { kind: 'subject', aliases: ['المادة', 'اسم المادة', 'subject', 'subject name'] },
  first_term_grade: {
    kind: 'raw_grade',
    aliases: ['درجة الفصل الاول', 'الفصل الاول', 'first_term_grade', 'first term', 'first term grade', 'term 1'],
  },
  first_month: {
    kind: 'raw_grade',
    aliases: ['السعي الاول', 'الشهر الاول', 'الشهر 1', 'الشهر ١', 'first_month', 'first month', 'first effort'],
  },
  second_month: {
    kind: 'raw_grade',
    aliases: ['السعي الثاني', 'الشهر الثاني', 'second_month', 'second month', 'second effort'],
  },
  second_term_grade: {
    kind: 'raw_grade',
    aliases: ['درجة الفصل الثاني', 'الفصل الثاني', 'second_term_grade', 'second term', 'second term grade', 'term 2'],
  },
  third_month: {
    kind: 'raw_grade',
    aliases: ['السعي الثالث', 'الشهر الثالث', 'الشهر 3', 'الشهر ٣', 'third_month', 'third month', 'third effort'],
  },
  fourth_month: {
    kind: 'raw_grade',
    aliases: ['السعي الرابع', 'الشهر الرابع', 'fourth_month', 'fourth month', 'fourth effort'],
  },
  mid_year_exam: {
    kind: 'raw_grade',
    aliases: ['درجة نصف السنة', 'نصف السنة', 'امتحان نصف السنة', 'mid_year_exam', 'mid year exam', 'mid year', 'midyear'],
  },
  final_exam: {
    kind: 'raw_grade',
    aliases: ['درجة امتحان نهاية السنة', 'امتحان نهاية السنة', 'درجة نهاية السنة', 'final_exam', 'final exam', 'final'],
  },
  completion_exam: {
    kind: 'raw_grade',
    aliases: ['درجة الاكمال', 'الاكمال', 'امتحان الاكمال', 'completion_exam', 'completion exam'],
  },
  notes: { kind: 'notes', aliases: ['ملاحظات', 'ملاحظة', 'notes', 'remarks'] },
  first_term_average: { kind: 'ignored_calculated', aliases: ['معدل الفصل الاول', 'first_term_average'] },
  second_term_average: { kind: 'ignored_calculated', aliases: ['معدل الفصل الثاني', 'second_term_average'] },
  annual_effort: { kind: 'ignored_calculated', aliases: ['السعي السنوي', 'annual_effort'] },
  final_grade: { kind: 'ignored_calculated', aliases: ['الدرجة النهائية', 'المعدل', 'final_grade'] },
  grade_after_completion: { kind: 'ignored_calculated', aliases: ['الدرجة بعد الاكمال', 'grade_after_completion'] },
  effective_grade: { kind: 'ignored_calculated', aliases: ['الدرجة الفعلية', 'effective_grade'] },
  result_status: { kind: 'ignored_calculated', aliases: ['النتيجة', 'القرار', 'result_status'] },
  exemption_status: { kind: 'ignored_calculated', aliases: ['الاعفاء', 'حالة الاعفاء', 'exemption_status'] },
};

const IDENTITY_FIELDS = new Set<GradeSemanticField>(['student_number', 'full_name']);
const PLACEMENT_FIELDS = new Set<GradeSemanticField>(['class_name', 'section_name']);

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function headerCandidate(field: GradeSemanticField, definition: GradeFieldDefinition, profile: ColumnProfile): FieldCandidate {
  const header = normalizeHeader(profile.headerText);
  if (!header || isExcelErrorValue(profile.headerText)) {
    return { source: { type: 'column', columnIndex: profile.columnIndex, columnKey: profile.key }, confidence: 0, reasons: [] };
  }
  if (definition.kind === 'raw_grade' && isCalculatedGradeHeader(profile.headerText)) {
    return {
      source: { type: 'column', columnIndex: profile.columnIndex, columnKey: profile.key },
      confidence: 0,
      reasons: ['العمود محسوب ولا يمكن اقتراحه كدرجة خام'],
    };
  }
  const aliases = definition.aliases.map(normalizeHeader);
  const exact = aliases.some(alias => header === alias);
  const partial = !exact && header.length >= 3 && aliases.some(alias => alias.length >= 5 && (header.includes(alias) || alias.includes(header)));
  const numericEvidence = definition.kind === 'raw_grade' ? Math.min(0.025, profile.numericRatio * 0.025) : 0;
  const confidence = exact ? 0.965 + numericEvidence : partial ? 0.76 + numericEvidence : 0;
  return {
    source: { type: 'column', columnIndex: profile.columnIndex, columnKey: profile.key },
    confidence: clamp(confidence),
    reasons: confidence > 0
      ? [exact ? `عنوان العمود يطابق ${field}` : `عنوان العمود قريب من ${field}`]
      : [],
  };
}

export function inferGradeFields(
  profiles: ColumnProfile[],
  studentInferences: FieldInference[],
): GradeFieldInference[] {
  const inferred: GradeFieldInference[] = [];
  for (const field of ['student_number', 'full_name', 'class_name', 'section_name'] as GradeSemanticField[]) {
    const student = studentInferences.find(item => item.field === field);
    inferred.push({
      field,
      kind: IDENTITY_FIELDS.has(field) ? 'student_identity' : PLACEMENT_FIELDS.has(field) ? 'placement' : 'student_identity',
      source: student?.source || { type: 'ignore' },
      confidence: student?.confidence || 0,
      reasons: student?.reasons || ['لم يُعثر على مصدر مناسب'],
      alternatives: student?.alternatives || [],
    });
  }

  for (const [field, definition] of Object.entries(GRADE_FIELD_DEFINITIONS) as Array<[GradeSemanticField, GradeFieldDefinition]>) {
    const candidates = profiles
      .map(profile => headerCandidate(field, definition, profile))
      .filter(candidate => candidate.confidence > 0)
      .sort((left, right) => right.confidence - left.confidence);
    const best = candidates[0] || { source: { type: 'ignore' as const }, confidence: 0, reasons: ['لم يُعثر على عنوان دال'] };
    inferred.push({ field, kind: definition.kind, ...best, alternatives: candidates.slice(1, 5) });
  }

  return inferred;
}

export function isGradeHeader(value: unknown): boolean {
  const normalized = normalizeHeader(value);
  if (!normalized) return false;
  return Object.values(GRADE_FIELD_DEFINITIONS).some(definition => definition.aliases.some(alias => {
    const candidate = normalizeHeader(alias);
    return normalized === candidate || (candidate.length >= 5 && normalized.includes(candidate));
  }));
}

export function isCalculatedGradeHeader(value: unknown): boolean {
  const normalized = normalizeHeader(value);
  if (!normalized) return false;
  return (Object.values(GRADE_FIELD_DEFINITIONS) as GradeFieldDefinition[])
    .filter(definition => definition.kind === 'ignored_calculated')
    .some(definition => definition.aliases.some(alias => {
      const candidate = normalizeHeader(alias);
      return normalized === candidate || (normalized.length >= 3 && candidate.length >= 5 && normalized.includes(candidate));
    }));
}

export function gradeMappingFromAnalysis(
  analysis: Pick<WorksheetAnalysis, 'columns' | 'gradeFieldInferences'>,
  autoMapping: Record<string, string> = {},
): Record<string, string> {
  const mapping: Record<string, string> = { ...autoMapping };
  const semanticRawColumnKeys = new Set(analysis.gradeFieldInferences
    .filter(inference => inference.kind === 'raw_grade'
      && inference.source.type === 'column'
      && inference.confidence >= 0.7)
    .map(inference => inference.source.type === 'column' ? inference.source.columnKey : ''));
  const calculatedColumnKeys = new Set([
    ...analysis.gradeFieldInferences
      .filter(inference => inference.kind === 'ignored_calculated'
        && inference.source.type === 'column'
        && !semanticRawColumnKeys.has(inference.source.columnKey))
      .map(inference => inference.source.type === 'column' ? inference.source.columnKey : ''),
    ...analysis.columns.filter(column => isCalculatedGradeHeader(column.headerText)).map(column => column.key),
  ]);

  for (const inference of analysis.gradeFieldInferences) {
    if (inference.kind === 'ignored_calculated' || inference.source.type !== 'column') continue;
    const identityField = ['student_number', 'full_name', 'class_name', 'section_name', 'subject_name'].includes(inference.field);
    const minimum = identityField ? 0.48 : 0.7;
    if (inference.confidence < minimum) continue;
    if (inference.kind === 'raw_grade') {
      for (const otherField of RAW_GRADE_FIELDS) {
        if (otherField !== inference.field && mapping[otherField] === inference.source.columnKey) delete mapping[otherField];
      }
    }
    mapping[inference.field] = inference.source.columnKey;
  }

  const claimedRawColumns = new Set<string>();
  for (const field of RAW_GRADE_FIELDS) {
    const sourceColumn = mapping[field];
    if (!sourceColumn) continue;
    if (calculatedColumnKeys.has(sourceColumn) || claimedRawColumns.has(sourceColumn)) {
      delete mapping[field];
      continue;
    }
    claimedRawColumns.add(sourceColumn);
  }
  return mapping;
}

function subjectInferenceFromName(
  value: string,
  subjects: ExcelSubjectOption[],
  source: SubjectInference['source'],
  matchedConfidence: number,
  unmatchedConfidence: number,
): SubjectInference {
  const normalizedName = normalizeSubjectName(value);
  if (!normalizedName) {
    return {
      subjectId: null,
      subjectName: null,
      normalizedName: null,
      confidence: 0,
      source: { type: 'ignore' },
      reasons: ['المصدر لا يقدم دلالة مادة'],
      alternatives: [],
      requiresPlacementResolution: false,
    };
  }
  const matches = subjects.filter(subject => subject.status !== 'archived' && normalizeSubjectName(subject.name) === normalizedName);
  if (!matches.length) {
    return {
      subjectId: null,
      subjectName: value.trim() || null,
      normalizedName,
      confidence: unmatchedConfidence,
      source,
      reasons: ['اسم المصدر يشبه مادة لكنه لم يُطابق مادة موجودة بشكل قاطع'],
      alternatives: [],
      requiresPlacementResolution: false,
    };
  }
  return {
    subjectId: matches.length === 1 ? matches[0].id : null,
    subjectName: matches[0].name,
    normalizedName,
    confidence: matchedConfidence,
    source,
    reasons: ['اسم المصدر يطابق مادة موجودة بعد التطبيع المحافظ'],
    alternatives: matches.map(subject => ({ subjectId: subject.id, subjectName: subject.name, confidence: matchedConfidence })),
    requiresPlacementResolution: matches.length > 1,
  };
}

export function inferSubjectFromSheetName(
  sheetName: string,
  subjects: ExcelSubjectOption[] = [],
): SubjectInference {
  return subjectInferenceFromName(sheetName, subjects, { type: 'sheet-name', value: sheetName }, 0.98, 0.62);
}

export function inferSubjectFromWorkbookContext(
  sheetName: string,
  metadata: MetadataCandidate[],
  subjects: ExcelSubjectOption[] = [],
): SubjectInference {
  const sheetInference = inferSubjectFromSheetName(sheetName, subjects);
  const metadataCandidates = metadata
    .flatMap(candidate => candidate.field === 'subject_name' && candidate.source.type === 'metadata-cell'
      ? [subjectInferenceFromName(
          candidate.source.value,
          subjects,
          candidate.source,
          Math.min(0.97, Math.max(0.85, candidate.confidence)),
          Math.min(0.68, candidate.confidence),
        )]
      : [])
    .sort((left, right) => right.confidence - left.confidence);
  return metadataCandidates[0] && metadataCandidates[0].confidence > sheetInference.confidence
    ? metadataCandidates[0]
    : sheetInference;
}
