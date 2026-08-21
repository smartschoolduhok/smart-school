export type ExcelCell = string | number | boolean | null | undefined;
export type WorksheetRows = ExcelCell[][];
export type WorksheetCategory = 'students' | 'grade_sheet' | 'summary' | 'unknown';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type StudentSemanticField =
  | 'full_name'
  | 'student_number'
  | 'section_name'
  | 'class_name'
  | 'gender'
  | 'phone';

export const RAW_GRADE_FIELDS = [
  'first_month',
  'second_month',
  'third_month',
  'fourth_month',
  'mid_year_exam',
  'final_exam',
  'completion_exam',
] as const;

export type RawGradeField = typeof RAW_GRADE_FIELDS[number];

export const CALCULATED_GRADE_FIELDS = [
  'first_term_average',
  'second_term_average',
  'annual_effort',
  'final_grade',
  'grade_after_completion',
  'effective_grade',
  'result_status',
  'exemption_status',
] as const;

export type CalculatedGradeField = typeof CALCULATED_GRADE_FIELDS[number];

export type GradeSemanticField =
  | 'student_number'
  | 'full_name'
  | 'class_name'
  | 'section_name'
  | 'subject_name'
  | RawGradeField
  | 'notes'
  | CalculatedGradeField;

export interface DataRegion {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  dataStartRow: number;
  rowCount: number;
  confidence: number;
}

export interface HeaderDetection {
  headerRowIndex: number | null;
  headerRowNumber: number | null;
  columnNames: string[];
  score: number;
  confidence: ConfidenceLevel;
}

export interface ColumnProfile {
  key: string;
  columnIndex: number;
  columnLetter: string;
  displayName: string;
  headerText: string | null;
  sampleValues: ExcelCell[];
  nonEmptyCount: number;
  uniqueCount: number;
  numericRatio: number;
  textRatio: number;
  integerRatio: number;
  sequentialIntegerRatio: number;
  structuredIdRatio: number;
  sectionValueRatio: number;
  genderValueRatio: number;
  phoneValueRatio: number;
  classValueRatio: number;
  arabicTextRatio: number;
  averageWordCount: number;
  shortCategoryRatio: number;
}

export type FieldSource =
  | { type: 'column'; columnIndex: number; columnKey: string }
  | { type: 'metadata-cell'; row: number; column: number; value: string }
  | { type: 'sheet-name'; value: string }
  | { type: 'file-name'; value: string }
  | { type: 'constant'; value: string }
  | { type: 'system-selection'; id: number | null }
  | { type: 'ignore' };

export interface FieldCandidate {
  source: FieldSource;
  confidence: number;
  reasons: string[];
}

export interface FieldInference extends FieldCandidate {
  field: StudentSemanticField;
  alternatives: FieldCandidate[];
}

export interface GradeFieldInference extends FieldCandidate {
  field: GradeSemanticField;
  kind: 'student_identity' | 'placement' | 'subject' | 'raw_grade' | 'notes' | 'ignored_calculated';
  alternatives: FieldCandidate[];
}

export interface ExcelSubjectOption {
  id: number;
  name: string;
  class_id?: number | null;
  section_id?: number | null;
  status?: string;
}

export interface SubjectInference {
  subjectId: number | null;
  subjectName: string | null;
  normalizedName: string | null;
  confidence: number;
  source: Extract<FieldSource, { type: 'sheet-name' | 'metadata-cell' }> | { type: 'ignore' };
  reasons: string[];
  alternatives: Array<{ subjectId: number; subjectName: string; confidence: number }>;
  requiresPlacementResolution: boolean;
}

export interface MetadataCandidate {
  field: 'class_name' | 'section_name' | 'subject_name' | 'school_year';
  source: Extract<FieldSource, { type: 'metadata-cell' | 'sheet-name' | 'file-name' }>;
  confidence: number;
  reasons: string[];
  originalText: string;
}

export interface TableAnalysis extends HeaderDetection {
  region: DataRegion;
  columns: ColumnProfile[];
  fieldInferences: FieldInference[];
  gradeFieldInferences: GradeFieldInference[];
  category: WorksheetCategory;
  categoryConfidence: number;
}

export interface WorksheetAnalysis extends HeaderDetection {
  name: string;
  category: WorksheetCategory;
  categoryConfidence: number;
  rowCount: number;
  regions: DataRegion[];
  tables: TableAnalysis[];
  metadata: MetadataCandidate[];
  columns: ColumnProfile[];
  gradeFieldInferences: GradeFieldInference[];
  subjectInference: SubjectInference;
}

export interface AnalyzeWorksheetOptions {
  fileName?: string;
  headerRowIndex?: number | null;
  subjects?: ExcelSubjectOption[];
}

export interface SheetRecord extends Record<string, unknown> {
  _excel_row_number: number;
}
