import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { IMPORT_EXPORT_ROLES, hasRole } from '../../lib/rbac';
import { previewImport, confirmImport, getExportData, getImportJobs, getClasses, getSections, getSubjects } from '../../lib/api';
import {
  analysisRowsToRecords,
  analyzeWorksheet,
  fieldSourceIdentity,
  gradeMappingFromAnalysis,
  isCalculatedGradeHeader,
  normalizeHeader,
  RAW_GRADE_FIELDS,
  type ColumnProfile,
  type FieldSource,
  type StudentSemanticField,
  type WorksheetAnalysis,
  type WorksheetCategory,
  type WorksheetRows,
} from '../../lib/excelImport';
import { discoverGradeSpecialMarkers, type GradeSpecialValueAction } from '../../lib/gradeImport';
import { Upload, Download, FileSpreadsheet, Table, AlertTriangle, CheckCircle, XCircle, FileText, History, ChevronRight, ArrowLeft, ArrowRight, Loader2, BookOpen, Layers, GraduationCap, Users } from 'lucide-react';

// ===========================================
// Phase 13A: Excel Import/Export Page
// ===========================================

type ImportType = 'students' | 'classes-sections' | 'subjects' | 'employees' | 'grades' | 'student-subjects';
type ImportMode = 'skip_existing' | 'update_existing' | 'error_on_existing';
type AssignmentMode = 'strict_existing_assignments' | 'auto_assign_missing_subjects';
type GradeSubjectSource = 'fixed' | 'column' | 'inferred';

interface SheetInfo {
  name: string;
  type: WorksheetCategory;
  columnNames: string[];
  headerRowIndex: number | null;
  headerScore: number;
  headerConfidence: 'high' | 'medium' | 'low';
  rowCount: number;
  rows: WorksheetRows;
  analysis: WorksheetAnalysis;
}

interface ColumnMap {
  [systemField: string]: string; // systemField -> excelColumnName
}

interface PreviewRow {
  row_index: number;
  data: Record<string, any>;
}

interface PreviewResult {
  type: ImportType;
  mode: ImportMode;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  duplicate_rows: number;
  skipped_rows?: number;
  valid: any[];
  errors: any[];
  warnings: any[];
  duplicates: any[];
  not_applicable?: any[];
  not_applicable_rows?: number;
  sources?: any[];
  sheets?: any[];
  summary?: Record<string, number>;
}

interface GradeSheetConfig {
  sourceId: string;
  sheetName: string;
  regionId: string | null;
  rowStart: number | null;
  rowEnd: number | null;
  selected: boolean;
  mapping: ColumnMap;
  subjectSource: GradeSubjectSource;
  subjectId: number | null;
  subjectName: string | null;
  classId: number | null;
  sectionId: number | null;
  specialValues: Record<string, GradeSpecialValueAction>;
  acknowledged: boolean;
}

const TABS = [
  { key: 'import', label: 'استيراد البيانات', icon: <Upload size={18} /> },
  { key: 'export', label: 'تصدير البيانات', icon: <Download size={18} /> },
  { key: 'templates', label: 'قوالب Excel', icon: <FileSpreadsheet size={18} /> },
  { key: 'jobs', label: 'سجل عمليات الاستيراد', icon: <History size={18} /> },
] as const;

const TYPE_OPTIONS: { value: ImportType; label: string; icon: React.ReactNode }[] = [
  { value: 'students', label: 'الطلاب', icon: <GraduationCap size={18} /> },
  { value: 'classes-sections', label: 'الصفوف والشعب', icon: <Layers size={18} /> },
  { value: 'subjects', label: 'المواد', icon: <BookOpen size={18} /> },
  { value: 'employees', label: 'الموظفون', icon: <Users size={18} /> },
  { value: 'grades', label: 'الدرجات', icon: <FileText size={18} /> },
  { value: 'student-subjects', label: 'تسجيل الطلاب في المواد', icon: <BookOpen size={18} /> },
];

const MODE_OPTIONS: { value: ImportMode; label: string; description: string }[] = [
  { value: 'skip_existing', label: 'تخطي المكرر', description: 'تخطي الصفوف الموجودة مسبقاً' },
  { value: 'update_existing', label: 'تحديث المكرر', description: 'تحديث الصفوف الموجودة بالبيانات الجديدة' },
  { value: 'error_on_existing', label: 'خطأ عند المكرر', description: 'إظهار خطأ إذا كان الصف موجوداً' },
];

const SYSTEM_FIELDS: Record<ImportType, { key: string; label: string; required?: boolean; hint?: string }[]> = {
  students: [
    { key: 'student_number', label: 'رقم الطالب', hint: 'اختياري؛ ينشئ النظام رقماً داخلياً ثابتاً عند تجاهله' },
    { key: 'full_name', label: 'اسم الطالب', required: true },
    { key: 'father_name', label: 'اسم الأب' },
    { key: 'mother_name', label: 'اسم الأم' },
    { key: 'gender', label: 'الجنس' },
    { key: 'birth_date', label: 'تاريخ الميلاد' },
    { key: 'phone', label: 'الهاتف' },
    { key: 'guardian_name', label: 'ولي الأمر' },
    { key: 'guardian_phone', label: 'هاتف ولي الأمر' },
    { key: 'address', label: 'العنوان' },
    { key: 'class_name', label: 'الصف' },
    { key: 'section_name', label: 'الشعبة' },
    { key: 'notes', label: 'ملاحظات' },
    { key: 'status', label: 'الحالة' },
  ],
  'classes-sections': [
    { key: 'class_name', label: 'اسم الصف', required: true },
    { key: 'stage', label: 'المرحلة', required: true },
    { key: 'order_index', label: 'الترتيب' },
    { key: 'section_name', label: 'الشعبة' },
    { key: 'capacity', label: 'السعة' },
    { key: 'status', label: 'الحالة' },
  ],
  subjects: [
    { key: 'subject_name', label: 'اسم المادة', required: true },
    { key: 'class_name', label: 'الصف', required: true },
    { key: 'section_name', label: 'الشعبة' },
    { key: 'subject_type', label: 'نوع المادة' },
    { key: 'counts_in_average', label: 'تحسب في المعدل' },
    { key: 'appears_in_report_card', label: 'تظهر في كشف العلامات' },
    { key: 'passing_grade', label: 'درجة النجاح' },
    { key: 'exemption_grade', label: 'درجة الإعفاء' },
    { key: 'order_index', label: 'الترتيب' },
    { key: 'status', label: 'الحالة' },
  ],
  employees: [
    { key: 'full_name', label: 'اسم الموظف', required: true },
    { key: 'gender', label: 'الجنس' },
    { key: 'phone', label: 'الهاتف' },
    { key: 'email', label: 'البريد الإلكتروني' },
    { key: 'address', label: 'العنوان' },
    { key: 'job_title', label: 'المسمى الوظيفي' },
    { key: 'employee_type', label: 'نوع الموظف' },
    { key: 'hire_date', label: 'تاريخ التعيين' },
    { key: 'salary_amount', label: 'الراتب' },
    { key: 'salary_type', label: 'نوع الراتب' },
    { key: 'status', label: 'الحالة' },
    { key: 'notes', label: 'ملاحظات' },
  ],
  grades: [
    { key: 'student_number', label: 'رقم الطالب / القيد' },
    { key: 'full_name', label: 'اسم الطالب' },
    { key: 'class_name', label: 'الصف' },
    { key: 'section_name', label: 'الشعبة' },
    { key: 'subject_name', label: 'المادة' },
    { key: 'first_month', label: 'درجة الفصل الأول / السعي الأول' },
    { key: 'second_month', label: 'السعي الثاني' },
    { key: 'mid_year_exam', label: 'درجة نصف السنة' },
    { key: 'third_month', label: 'درجة الفصل الثاني / السعي الثالث' },
    { key: 'fourth_month', label: 'السعي الرابع' },
    { key: 'final_exam', label: 'امتحان نهاية السنة' },
    { key: 'completion_exam', label: 'درجة الإكمال' },
    { key: 'notes', label: 'ملاحظات' },
  ],
  'student-subjects': [
    { key: 'student_number', label: 'رقم الطالب / القيد', required: true },
    { key: 'full_name', label: 'اسم الطالب', required: true },
    { key: 'class_name', label: 'الصف' },
    { key: 'section_name', label: 'الشعبة' },
    { key: 'subject_name', label: 'المادة', required: true },
    { key: 'is_active', label: 'الحالة (نشط/غير نشط)' },
    { key: 'notes', label: 'ملاحظات' },
  ],
};

const AUTO_MAP_RULES: Record<string, string[]> = {
  student_number: ['رقم الطالب', 'الرقم', 'القيد', 'student_number', 'student no', 'student id', 'no'],
  full_name: ['اسم الطالب', 'اسم الطالبة', 'الاسم', 'full_name', 'student name', 'name', 'اسم الموظف'],
  father_name: ['اسم الأب', 'father_name', 'father'],
  mother_name: ['اسم الأم', 'mother_name', 'mother'],
  gender: ['الجنس', 'النوع', 'gender', 'sex'],
  birth_date: ['تاريخ الميلاد', 'birth_date', 'birthdate', 'dob', 'تاريخ الميلاد'],
  phone: ['الهاتف', 'رقم الهاتف', 'phone', 'mobile', 'tel'],
  guardian_name: ['ولي الأمر', 'guardian_name', 'guardian'],
  guardian_phone: ['هاتف ولي الأمر', 'guardian_phone', 'guardian phone'],
  address: ['العنوان', 'السكن', 'address', 'الموقع'],
  class_name: ['الصف', 'المرحلة', 'class', 'grade', 'class_name', 'اسم الصف'],
  section_name: ['الشعبة', 'القسم', 'section', 'group', 'section_name'],
  notes: ['ملاحظات', 'notes', 'remarks', 'تعليقات'],
  status: ['الحالة', 'status', 'state'],
  stage: ['المرحلة', 'stage', 'level', 'grade'],
  order_index: ['الترتيب', 'order_index', 'order', 'sequence', 'priority'],
  capacity: ['السعة', 'capacity', 'max', 'limit'],
  subject_name: ['المادة', 'اسم المادة', 'subject', 'subject_name', 'name'],
  subject_type: ['نوع المادة', 'subject_type', 'type'],
  counts_in_average: ['تحسب في المعدل', 'counts_in_average', 'counts'],
  appears_in_report_card: ['تظهر في كشف العلامات', 'appears_in_report_card', 'appears'],
  passing_grade: ['درجة النجاح', 'passing_grade', 'passing', 'pass'],
  exemption_grade: ['درجة الإعفاء', 'exemption_grade', 'exemption'],
  email: ['البريد', 'البريد الإلكتروني', 'email', 'e-mail', 'mail'],
  job_title: ['المسمى الوظيفي', 'job_title', 'job', 'position', 'الوظيفة', 'title'],
  employee_type: ['نوع الموظف', 'employee_type', 'type'],
  hire_date: ['تاريخ التعيين', 'hire_date', 'hire'],
  salary_amount: ['الراتب', 'salary_amount', 'salary', 'الراتب الأساسي', 'basic salary'],
  salary_type: ['نوع الراتب', 'salary_type'],
  first_month: ['درجة الفصل الاول', 'الفصل الاول', 'first_month', 'first term', 'السعي الاول'],
  second_month: ['السعي الثاني', 'الشهر الثاني', 'second_month', 'second month', 'second effort'],
  third_month: ['درجة الفصل الثاني', 'الفصل الثاني', 'third_month', 'second term', 'third term', 'السعي الثالث'],
  fourth_month: ['السعي الرابع', 'fourth_month', 'fourth term'],
  mid_year_exam: ['نصف السنة', 'درجة نصف السنة', 'mid_year_exam', 'mid_year', 'mid year exam', 'mid'],
  final_exam: ['امتحان نهاية السنة', 'درجة نهاية السنة', 'final_exam', 'final exam', 'final', 'نهاية السنة'],
  completion_exam: ['الاكمال', 'درجة الاكمال', 'completion_exam', 'completion', 'complementary', 'الإكمال'],
};

function gradeConfigNeedsAcknowledgement(config: GradeSheetConfig, info?: SheetInfo): boolean {
  if (!info) return true;
  if (config.subjectSource === 'fixed' && !config.subjectId) return true;
  if (config.subjectSource === 'column' && !config.mapping.subject_name) return true;
  if (config.subjectSource === 'inferred' && (info.analysis.subjectInference.confidence < 0.85
    || info.analysis.subjectInference.requiresPlacementResolution
    || !config.subjectName)) return true;
  return info.analysis.gradeFieldInferences.some(inference =>
    inference.source.type === 'column'
    && config.mapping[inference.field] === inference.source.columnKey
    && inference.confidence < 0.7,
  );
}

function suggestedGradeMapping(analysis: WorksheetAnalysis): ColumnMap {
  return gradeMappingFromAnalysis(analysis, autoMapColumns(analysis.columns, 'grades'));
}

const STUDENT_SEMANTIC_FIELDS: StudentSemanticField[] = ['full_name', 'student_number', 'section_name', 'class_name', 'gender', 'phone'];

const STUDENT_SEMANTIC_LABELS: Record<StudentSemanticField, string> = {
  full_name: 'اسم الطالب',
  student_number: 'رقم الطالب / القيد',
  section_name: 'الشعبة',
  class_name: 'الصف',
  gender: 'الجنس',
  phone: 'الهاتف',
};

function autoMapColumns(excelColumns: ColumnProfile[], importType: ImportType): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<string>();
  const fields = SYSTEM_FIELDS[importType];
  for (const field of fields) {
    const candidates = AUTO_MAP_RULES[field.key] || [];
    for (const col of excelColumns) {
      const colLower = normalizeHeader(col.headerText || col.displayName);
      if (used.has(col.key)) continue;
      if (candidates.some(c => {
        const candidate = normalizeHeader(c);
        return colLower === candidate || (candidate.length > 2 && colLower.includes(candidate));
      })) {
        map[field.key] = col.key;
        used.add(col.key);
        break;
      }
    }
  }
  return map;
}

function sourcesFromAnalysis(analysis: WorksheetAnalysis): Partial<Record<StudentSemanticField, FieldSource>> {
  const sources: Partial<Record<StudentSemanticField, FieldSource>> = {};
  for (const inference of analysis.tables[0]?.fieldInferences || []) {
    const minimum = inference.field === 'full_name' ? 0.35 : 0.48;
    if (inference.confidence >= minimum) sources[inference.field] = inference.source;
    else if (inference.field === 'class_name') sources[inference.field] = { type: 'system-selection', id: null };
    else sources[inference.field] = { type: 'ignore' };
  }
  if (!sources.full_name && analysis.columns[0]) {
    sources.full_name = { type: 'column', columnIndex: analysis.columns[0].columnIndex, columnKey: analysis.columns[0].key };
  }
  return sources;
}

function columnMappingFromSources(sources: Partial<Record<StudentSemanticField, FieldSource>>): ColumnMap {
  const mapping: ColumnMap = {};
  for (const field of STUDENT_SEMANTIC_FIELDS) {
    const source = sources[field];
    if (source?.type === 'column') mapping[field] = source.columnKey;
  }
  return mapping;
}

function sourceValue(source: FieldSource): string {
  if (source.type === 'metadata-cell' || source.type === 'sheet-name' || source.type === 'file-name' || source.type === 'constant') return source.value;
  return '';
}

function detectIgnoredColumns(
  columns: ColumnProfile[],
  mapping: ColumnMap,
  sources: Partial<Record<StudentSemanticField, FieldSource>>,
): string[] {
  const used = new Set(Object.values(mapping).filter(Boolean));
  for (const source of Object.values(sources)) if (source?.type === 'column') used.add(source.columnKey);
  return columns.filter(column => !used.has(column.key)).map(column => column.displayName);
}

export default function ImportExportPage() {
  const { user } = useAuth();
  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [activeTab, setActiveTab] = useState<'import' | 'export' | 'templates' | 'jobs'>('import');
  const [selectedType, setSelectedType] = useState<ImportType>('students');
  const [importTypeConfirmed, setImportTypeConfirmed] = useState(true);
  const [mode, setMode] = useState<ImportMode>('skip_existing');
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [mapping, setMapping] = useState<ColumnMap>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [confirmResult, setConfirmResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'upload' | 'sheets' | 'mapping' | 'preview' | 'confirm'>('upload');
  const [importJobs, setImportJobs] = useState<any[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [xlsxModule, setXlsxModule] = useState<any>(null);
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>('strict_existing_assignments');
  const [clearEmptyFields, setClearEmptyFields] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null);
  const [classes, setClasses] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [gradeSheetConfigs, setGradeSheetConfigs] = useState<GradeSheetConfig[]>([]);
  const [gradeConfirmPayload, setGradeConfirmPayload] = useState<Record<string, unknown> | null>(null);
  const [studentSources, setStudentSources] = useState<Partial<Record<StudentSemanticField, FieldSource>>>({});
  const [analysisAcknowledged, setAnalysisAcknowledged] = useState(false);

  const canAccessEmployees = hasRole(user?.role_key, IMPORT_EXPORT_ROLES);
  const canAccessGrades = hasRole(user?.role_key, IMPORT_EXPORT_ROLES);
  const canAccessStudentSubjects = hasRole(user?.role_key, IMPORT_EXPORT_ROLES);
  const canImportExport = hasRole(user?.role_key, IMPORT_EXPORT_ROLES);

  const availableTypes = TYPE_OPTIONS.filter(t => {
    if (t.value === 'employees') return canAccessEmployees;
    if (t.value === 'grades') return canAccessGrades;
    if (t.value === 'student-subjects') return canAccessStudentSubjects;
    return true;
  });

  const selectedSheetInfo = sheets.find(sheet => sheet.name === selectedSheet);
  const selectedTable = selectedSheetInfo?.analysis.tables[0];
  const lowConfidenceInferences = selectedType === 'students'
    ? (selectedTable?.fieldInferences || []).filter(inference => {
        const selectedSource = studentSources[inference.field];
        return selectedSource?.type !== 'ignore'
          && fieldSourceIdentity(selectedSource) === fieldSourceIdentity(inference.source)
          && inference.confidence < 0.7;
      })
    : [];

  useEffect(() => {
    if (activeTab === 'jobs') loadJobs();
  }, [activeTab]);

  useEffect(() => {
    let cancelled = false;
    setSelectedClassId(null);
    setSelectedSectionId(null);
    setSelectedSubjectId(null);
    setClasses([]);
    setSections([]);
    setSubjects([]);
    setGradeSheetConfigs([]);
    setGradeConfirmPayload(null);
    setPreview(null);
    setConfirmResult(null);
    setAnalysisAcknowledged(false);
    setStudentSources(previous => Object.fromEntries(Object.entries(previous).map(([field, source]) => [
      field,
      source?.type === 'system-selection' ? { ...source, id: null } : source,
    ])) as Partial<Record<StudentSemanticField, FieldSource>>);
    setStep(current => current === 'preview' || current === 'confirm' ? 'mapping' : current);
    if (!schoolId) return () => { cancelled = true; };
    Promise.all([getClasses(schoolId), getSections(schoolId), getSubjects(schoolId)]).then(([classResult, sectionResult, subjectResult]) => {
      if (cancelled) return;
      setClasses(classResult.data || []);
      setSections(sectionResult.data || []);
      setSubjects(subjectResult.data || []);
    });
    return () => { cancelled = true; };
  }, [schoolId]);

  const loadXlsx = useCallback(async () => {
    if (xlsxModule) return xlsxModule;
    const mod = await import('xlsx');
    setXlsxModule(mod);
    return mod;
  }, [xlsxModule]);

  const loadJobs = async () => {
    setLoading(true);
    const res = await getImportJobs();
    if (res.data) setImportJobs(res.data);
    setLoading(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      alert('حجم الملف كبير جداً');
      return;
    }
    setFile(f);
    setLoading(true);
    try {
      const XLSX = await loadXlsx();
      const data = await f.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetInfos: SheetInfo[] = workbook.SheetNames.map((name: string) => {
        const ws = workbook.Sheets[name];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true }) as WorksheetRows;
        const analysis = analyzeWorksheet(name, rows, { fileName: f.name, subjects });
        return {
          name,
          type: analysis.category,
          columnNames: analysis.columnNames,
          headerRowIndex: analysis.headerRowIndex,
          headerScore: analysis.score,
          headerConfidence: analysis.confidence,
          rowCount: analysis.rowCount,
          rows,
          analysis,
        };
      });
      setSheets(sheetInfos);
      setGradeSheetConfigs(sheetInfos.map((info, index) => {
        const suggestedMapping = suggestedGradeMapping(info.analysis);
        const region = info.analysis.regions[0] || null;
        return {
          sourceId: `${info.name}:region:${index + 1}`,
          sheetName: info.name,
          regionId: region ? '1' : null,
          rowStart: region ? region.startRow + 1 : null,
          rowEnd: region ? region.endRow + 1 : null,
          selected: info.type === 'grade_sheet',
          mapping: suggestedMapping,
          subjectSource: suggestedMapping.subject_name ? 'column' : 'inferred',
          subjectId: info.analysis.subjectInference.subjectId,
          subjectName: info.analysis.subjectInference.subjectName,
          classId: null,
          sectionId: null,
          specialValues: {},
          acknowledged: false,
        };
      }));
      setGradeConfirmPayload(null);
      setStep('sheets');
    } catch (err: any) {
      alert('فشل في قراءة الملف: ' + (err.message || 'خطأ غير معروف'));
    }
    setLoading(false);
  };

  const selectSheet = (sheetName: string) => {
    const info = sheets.find(s => s.name === sheetName);
    if (!info) return;
    setSelectedSheet(sheetName);
    if (info.type === 'students' || info.type === 'grade_sheet') {
      const suggestedType: ImportType = info.type === 'grade_sheet' ? 'grades' : 'students';
      setSelectedType(suggestedType);
      if (suggestedType === 'students') {
        const sources = sourcesFromAnalysis(info.analysis);
        setStudentSources(sources);
        setMapping({ ...autoMapColumns(info.analysis.columns, suggestedType), ...columnMappingFromSources(sources) });
      } else {
        setStudentSources({});
        const gradeMapping = suggestedGradeMapping(info.analysis);
        setMapping(gradeMapping);
        setMode('update_existing');
        setGradeSheetConfigs(previous => previous.map(config => config.sheetName === info.name
          ? { ...config, selected: true, mapping: gradeMapping }
          : config));
      }
      setImportTypeConfirmed(true);
    } else {
      setMapping({});
      setImportTypeConfirmed(false);
    }
    setAnalysisAcknowledged(false);
    setStep('mapping');
  };

  const changeHeaderRow = (oneBasedRow: number | null) => {
    const info = sheets.find(s => s.name === selectedSheet);
    if (!info) return;
    const analysis = analyzeWorksheet(info.name, info.rows, {
      fileName: file?.name,
      headerRowIndex: oneBasedRow == null ? null : Math.max(0, oneBasedRow - 1),
      subjects,
    });
    setSheets(previous => previous.map(sheet => sheet.name === info.name ? {
      ...sheet,
      columnNames: analysis.columnNames,
      type: analysis.category,
      headerRowIndex: analysis.headerRowIndex,
      headerScore: analysis.score,
      headerConfidence: analysis.confidence,
      rowCount: analysis.rowCount,
      analysis,
    } : sheet));
    if (selectedType === 'students') {
      const sources = sourcesFromAnalysis(analysis);
      setStudentSources(sources);
      setMapping({ ...autoMapColumns(analysis.columns, selectedType), ...columnMappingFromSources(sources) });
    } else {
      const nextMapping = selectedType === 'grades' ? suggestedGradeMapping(analysis) : autoMapColumns(analysis.columns, selectedType);
      setMapping(nextMapping);
      if (selectedType === 'grades') {
        setGradeSheetConfigs(previous => previous.map(config => config.sheetName === info.name ? {
          ...config,
          mapping: nextMapping,
          subjectSource: nextMapping.subject_name ? 'column' : 'inferred',
          subjectId: analysis.subjectInference.subjectId,
          subjectName: analysis.subjectInference.subjectName,
          rowStart: analysis.regions[0] ? analysis.regions[0].startRow + 1 : null,
          rowEnd: analysis.regions[0] ? analysis.regions[0].endRow + 1 : null,
          acknowledged: false,
        } : config));
      }
    }
    setAnalysisAcknowledged(false);
    setPreview(null);
  };

  const handleMappingChange = (field: string, col: string) => {
    setMapping(prev => ({ ...prev, [field]: col }));
  };

  const openGradeWorkbookMapping = () => {
    const selected = gradeSheetConfigs.filter(config => config.selected);
    if (!selected.length) {
      alert('اختر ورقة درجات واحدة على الأقل');
      return;
    }
    setSelectedType('grades');
    setImportTypeConfirmed(true);
    setMode('update_existing');
    setSelectedSheet(selected[0].sheetName);
    setMapping(selected[0].mapping);
    setStep('mapping');
  };

  const updateGradeSheetConfig = (sourceId: string, update: Partial<GradeSheetConfig>) => {
    setGradeSheetConfigs(previous => previous.map(config => config.sourceId === sourceId ? { ...config, ...update } : config));
    setPreview(null);
    setGradeConfirmPayload(null);
  };

  const changeGradeSheetMapping = (sourceId: string, field: string, columnKey: string) => {
    setGradeSheetConfigs(previous => previous.map(config => {
      if (config.sourceId !== sourceId) return config;
      const nextMapping = { ...config.mapping };
      if (columnKey) nextMapping[field] = columnKey;
      else delete nextMapping[field];
      return { ...config, mapping: nextMapping, acknowledged: false };
    }));
    setPreview(null);
    setGradeConfirmPayload(null);
  };

  const changeGradeSpecialValue = (sourceId: string, marker: string, action: GradeSpecialValueAction | '') => {
    const config = gradeSheetConfigs.find(item => item.sourceId === sourceId);
    if (!config) return;
    const specialValues = { ...config.specialValues };
    if (action) specialValues[marker] = action;
    else delete specialValues[marker];
    updateGradeSheetConfig(sourceId, { specialValues });
  };

  const applyGradeMappingToCompatibleSheets = (sourceId: string) => {
    const sourceConfig = gradeSheetConfigs.find(config => config.sourceId === sourceId);
    const sourceInfo = sheets.find(sheet => sheet.name === sourceConfig?.sheetName);
    if (!sourceConfig || !sourceInfo) return;
    const signature = sourceInfo.analysis.columns.map(column => normalizeHeader(column.headerText || column.displayName)).join('|');
    setGradeSheetConfigs(previous => previous.map(config => {
      const info = sheets.find(sheet => sheet.name === config.sheetName);
      const compatible = info?.analysis.columns.map(column => normalizeHeader(column.headerText || column.displayName)).join('|') === signature;
      return config.selected && compatible ? { ...config, mapping: { ...sourceConfig.mapping }, acknowledged: false } : config;
    }));
    setPreview(null);
    setGradeConfirmPayload(null);
  };

  const changeImportType = (info: SheetInfo, type: ImportType) => {
    setSelectedType(type);
    setImportTypeConfirmed(true);
    if (type === 'students') {
      const sources = sourcesFromAnalysis(info.analysis);
      setStudentSources(sources);
      setMapping({ ...autoMapColumns(info.analysis.columns, type), ...columnMappingFromSources(sources) });
    } else {
      setStudentSources({});
      const nextMapping = type === 'grades' ? suggestedGradeMapping(info.analysis) : autoMapColumns(info.analysis.columns, type);
      setMapping(nextMapping);
      if (type === 'grades') {
        setMode('update_existing');
        setGradeSheetConfigs(previous => previous.map(config => config.sheetName === info.name
          ? { ...config, selected: true, mapping: nextMapping }
          : config));
      }
    }
    setAnalysisAcknowledged(false);
  };

  const changeStudentSource = (field: StudentSemanticField, token: string) => {
    const info = sheets.find(sheet => sheet.name === selectedSheet);
    if (!info) return;
    let source: FieldSource;
    if (token.startsWith('column:')) {
      const columnIndex = Number(token.split(':')[1]);
      source = { type: 'column', columnIndex, columnKey: token };
    } else if (token.startsWith('metadata:')) {
      const [, rowText, columnText] = token.split(':');
      const candidate = info.analysis.metadata.find(item => item.field === field && item.source.type === 'metadata-cell' && item.source.row === Number(rowText) && item.source.column === Number(columnText));
      source = candidate?.source || { type: 'ignore' };
    } else if (token === 'sheet-name' || token === 'file-name') {
      const candidate = info.analysis.metadata.find(item => item.field === field && item.source.type === token);
      source = candidate?.source || { type: token, value: token === 'sheet-name' ? info.name : (file?.name || '').replace(/\.[^.]+$/u, '') };
    } else if (token === 'system-selection') {
      source = { type: 'system-selection', id: field === 'class_name' ? selectedClassId : selectedSectionId };
    } else if (token === 'constant') {
      source = { type: 'constant', value: '' };
    } else {
      source = { type: 'ignore' };
    }
    setStudentSources(previous => ({ ...previous, [field]: source }));
    setMapping(previous => {
      const next = { ...previous };
      if (source.type === 'column') next[field] = source.columnKey;
      else delete next[field];
      return next;
    });
    setAnalysisAcknowledged(false);
  };

  const changeConstantSource = (field: 'class_name' | 'section_name', value: string) => {
    setStudentSources(previous => ({ ...previous, [field]: { type: 'constant', value } }));
    setAnalysisAcknowledged(false);
  };

  const parseSheetAndPreview = async () => {
    if (!selectedSheet || !file) return;
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    try {
      const info = sheets.find(s => s.name === selectedSheet);
      if (!info) throw new Error('تعذر العثور على ورقة العمل المحددة');
      if (!schoolId) throw new Error('يجب اختيار المدرسة المستهدفة قبل المعاينة');
      if (!importTypeConfirmed) throw new Error('اختر نوع الاستيراد لهذه الورقة أولاً');
      if (selectedType === 'grades') {
        const selectedConfigs = gradeSheetConfigs.filter(config => config.selected);
        if (!selectedConfigs.length) throw new Error('اختر ورقة درجات واحدة على الأقل');
        const gradeSources = selectedConfigs.map(config => {
          const sheetInfo = sheets.find(sheet => sheet.name === config.sheetName);
          if (!sheetInfo) throw new Error(`تعذر العثور على الورقة "${config.sheetName}"`);
          if (config.subjectSource === 'fixed' && !config.subjectId) throw new Error(`اختر المادة الثابتة للمصدر "${config.sheetName}"`);
          if (config.subjectSource === 'column' && !config.mapping.subject_name) throw new Error(`حدد عمود المادة للمصدر "${config.sheetName}"`);
          if (config.subjectSource === 'inferred' && !config.subjectName) throw new Error(`تعذر استنتاج المادة للمصدر "${config.sheetName}"؛ اختر مادة ثابتة أو عمود مادة`);
          if (!config.mapping.student_number && !config.mapping.full_name) throw new Error(`حدد رقم الطالب/القيد أو اسم الطالب في الورقة "${config.sheetName}"`);
          if (!RAW_GRADE_FIELDS.some(field => Boolean(config.mapping[field]))) throw new Error(`حدد عمود درجة خام واحداً على الأقل في الورقة "${config.sheetName}"`);
          if (gradeConfigNeedsAcknowledgement(config, sheetInfo) && !config.acknowledged) {
            throw new Error(`راجع الاستدلالات غير المؤكدة وأكدها في الورقة "${config.sheetName}"`);
          }
          return {
            source_id: config.sourceId,
            sheet_name: config.sheetName,
            region_id: config.regionId,
            row_start: config.rowStart,
            row_end: config.rowEnd,
            rows: analysisRowsToRecords(sheetInfo.rows, sheetInfo.analysis),
            mapping: config.mapping,
            column_headers: Object.fromEntries(sheetInfo.analysis.columns.map(column => [column.key, column.headerText || column.displayName])),
            subject_source: config.subjectSource,
            subject_id: config.subjectSource === 'fixed' ? config.subjectId : null,
            subject_name: config.subjectSource === 'inferred' ? config.subjectName : null,
            metadata_subject_name: config.subjectSource === 'inferred' && sheetInfo.analysis.subjectInference.source.type === 'metadata-cell'
              ? config.subjectName
              : null,
            class_id: config.classId,
            section_id: config.sectionId,
            special_values: config.specialValues,
          };
        });
        const payload = {
          school_id: schoolId,
          grade_sources: gradeSources,
          mode,
          assignment_mode: assignmentMode,
          clear_empty_fields: clearEmptyFields,
          file_name: file.name,
        };
        const res = await previewImport('grades', payload);
        if (!isCurrent()) return;
        if (res.data) {
          setGradeConfirmPayload(payload);
          setPreview(res.data as PreviewResult);
          setStep('preview');
        } else if (res.error) alert(res.error);
        if (isCurrent()) setLoading(false);
        return;
      }
      const rows = analysisRowsToRecords(info.rows, info.analysis);
      let rowsForPreview: Array<Record<string, unknown>> = rows;
      let effectiveMapping = { ...mapping };
      let effectiveClassMode: 'excel' | 'override' = 'excel';
      let effectiveSectionMode: 'excel' | 'override' | 'none' = 'none';
      let effectiveClassId = selectedClassId;
      let effectiveSectionId = selectedSectionId;
      if (selectedType === 'students') {
        const fullNameSource = studentSources.full_name;
        const classSource = studentSources.class_name;
        const sectionSource = studentSources.section_name;
        if (fullNameSource?.type !== 'column') throw new Error('يجب اختيار عمود لاسم الطالب');
        if (!classSource || classSource.type === 'ignore') throw new Error('يجب تحديد مصدر الصف');
        if (classSource.type === 'system-selection' && !selectedClassId) throw new Error('يجب اختيار صف موجود من النظام');
        if (sectionSource?.type === 'system-selection' && !selectedSectionId) throw new Error('يجب اختيار شعبة موجودة من النظام');
        if (lowConfidenceInferences.length > 0 && !analysisAcknowledged) throw new Error('راجع الاستدلالات منخفضة الثقة وأكد مراجعتها قبل المعاينة');

        effectiveMapping = Object.fromEntries(Object.entries(mapping).filter(([field]) => !STUDENT_SEMANTIC_FIELDS.includes(field as StudentSemanticField)));
        const sourceValues: Partial<Record<StudentSemanticField, string>> = {};
        for (const field of STUDENT_SEMANTIC_FIELDS) {
          const source = studentSources[field];
          if (!source || source.type === 'ignore' || source.type === 'system-selection') continue;
          if (source.type === 'column') {
            effectiveMapping[field] = source.columnKey;
          } else {
            const virtualKey = `__source_${field}`;
            effectiveMapping[field] = virtualKey;
            sourceValues[field] = sourceValue(source);
          }
        }
        rowsForPreview = rows.map(row => {
          const prepared = { ...row };
          for (const [field, value] of Object.entries(sourceValues)) prepared[`__source_${field}`] = value;
          return prepared;
        });
        effectiveClassMode = classSource.type === 'system-selection' ? 'override' : 'excel';
        effectiveSectionMode = !sectionSource || sectionSource.type === 'ignore'
          ? 'none'
          : sectionSource.type === 'system-selection' ? 'override' : 'excel';
        if (effectiveClassMode === 'override') effectiveClassId = selectedClassId;
        else if (effectiveSectionMode === 'override') {
          effectiveClassId = sections.find(section => section.id === selectedSectionId)?.class_id || null;
        } else effectiveClassId = null;
      }
      const payload: any = { school_id: schoolId, rows: rowsForPreview, mode, mapping: effectiveMapping };
      if (selectedType === 'students') {
        payload.class_assignment_mode = effectiveClassMode;
        payload.section_assignment_mode = effectiveSectionMode;
        payload.selected_class_id = effectiveClassId;
        payload.selected_section_id = effectiveSectionId;
      }
      if (selectedType === 'student-subjects') {
        payload.selected_class_id = selectedClassId;
        payload.selected_section_id = selectedSectionId;
      }
      const res = await previewImport(selectedType, payload);
      if (!isCurrent()) return;
      if (res.data) {
        setPreview(res.data as PreviewResult);
        setStep('preview');
      } else if (res.error) {
        alert(res.error);
      }
    } catch (err: any) {
      if (!isCurrent()) return;
      alert('فشل في المعاينة: ' + (err.message || 'خطأ غير معروف'));
    }
    if (isCurrent()) setLoading(false);
  };

  const handleConfirm = async () => {
    if (!preview) return;
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    try {
      if (!schoolId) throw new Error('يجب اختيار المدرسة المستهدفة قبل تأكيد الاستيراد');
      if (selectedType === 'grades') {
        if (!gradeConfirmPayload) throw new Error('أعد معاينة أوراق الدرجات قبل التأكيد');
        const res = await confirmImport('grades', {
          ...gradeConfirmPayload,
          school_id: schoolId,
          file_name: file?.name || 'import.xlsx',
        });
        if (!isCurrent()) return;
        if (res.data) {
          setConfirmResult(res.data);
          setStep('confirm');
        } else if (res.error) alert(res.error);
        if (isCurrent()) setLoading(false);
        return;
      }
      const rowsToSend = preview.valid.map((r: PreviewRow) => r.data);
      const payload: any = { school_id: schoolId, rows: rowsToSend, mode, file_name: file?.name || 'import.xlsx' };
      if (selectedType === 'students') {
        const classSource = studentSources.class_name;
        const sectionSource = studentSources.section_name;
        const classMode = classSource?.type === 'system-selection' ? 'override' : 'excel';
        const sectionMode = !sectionSource || sectionSource.type === 'ignore'
          ? 'none'
          : sectionSource.type === 'system-selection' ? 'override' : 'excel';
        payload.class_assignment_mode = classMode;
        payload.section_assignment_mode = sectionMode;
        payload.selected_class_id = classMode === 'override'
          ? selectedClassId
          : sectionMode === 'override' ? (sections.find(section => section.id === selectedSectionId)?.class_id || null) : null;
        payload.selected_section_id = selectedSectionId;
      }
      const res = await confirmImport(selectedType, payload);
      if (!isCurrent()) return;
      if (res.data) {
        setConfirmResult(res.data);
        setStep('confirm');
      } else if (res.error) {
        alert(res.error);
      }
    } catch (err: any) {
      if (!isCurrent()) return;
      alert('فشل في تأكيد الاستيراد: ' + (err.message || 'خطأ غير معروف'));
    }
    if (isCurrent()) setLoading(false);
  };

  const handleExport = async (type: ImportType) => {
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    try {
      if (!schoolId) throw new Error('يجب اختيار المدرسة المستهدفة قبل التصدير');
      const res = await getExportData(type, schoolId);
      if (!isCurrent()) return;
      if (res.data?.rows) {
        const XLSX = await loadXlsx();
        if (!isCurrent()) return;
        const headers = SYSTEM_FIELDS[type].map(f => f.label);
        const keys = SYSTEM_FIELDS[type].map(f => f.key);
        const dataRows = res.data.rows.map((r: any) => keys.map(k => r[k] ?? ''));
        const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
        const wb = XLSX.utils.book_new();
        const sheetLabel = type === 'classes-sections' ? 'الصفوف والشعب' : type === 'students' ? 'الطلاب' : type === 'subjects' ? 'المواد' : type === 'grades' ? 'الدرجات' : type === 'student-subjects' ? 'تسجيل الطلاب' : 'الموظفون';
        XLSX.utils.book_append_sheet(wb, ws, sheetLabel);
        const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${type}-${schoolId}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      } else if (res.error) {
        alert(res.error);
      }
    } catch (err: any) {
      if (!isCurrent()) return;
      alert('فشل في التصدير: ' + (err.message || 'خطأ غير معروف'));
    }
    if (isCurrent()) setLoading(false);
  };

  const handleTemplateDownload = async (type: ImportType) => {
    setLoading(true);
    try {
      const XLSX = await loadXlsx();
      const headers = SYSTEM_FIELDS[type].map(f => f.label);
      const ws = XLSX.utils.aoa_to_sheet([headers, []]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Template');
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `template-${type}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('فشل في إنشاء القالب');
    }
    setLoading(false);
  };

  const ignoredCols = selectedSheetInfo
    ? detectIgnoredColumns(selectedSheetInfo.analysis.columns, mapping, studentSources)
    : [];
  const previewFields = SYSTEM_FIELDS[selectedType].filter(field => {
    if (selectedType !== 'students') return Boolean(mapping[field.key]);
    if (STUDENT_SEMANTIC_FIELDS.includes(field.key as StudentSemanticField)) {
      return studentSources[field.key as StudentSemanticField]?.type !== 'ignore';
    }
    return Boolean(mapping[field.key]) || ['student_number', 'full_name', 'class_name', 'section_name'].includes(field.key);
  });

  if (!canImportExport) {
    return (
      <div className="p-6 text-center">
        <div className="bg-red-50 border border-red-200 rounded-xl p-8">
          <AlertTriangle className="mx-auto mb-4 text-red-500" size={40} />
          <h2 className="text-lg font-bold text-red-700 mb-2">غير مسموح</h2>
          <p className="text-red-600">لا تملك صلاحية الاستيراد والتصدير</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6" dir="rtl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
        <FileSpreadsheet className="text-primary-600" />
        استيراد وتصدير Excel
      </h1>

      <div className="mb-6">
        <SystemAdminSchoolSelector {...schoolScope} />
      </div>

      {preview?.warnings && preview.warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
          <h3 className="text-sm font-bold text-amber-800 mb-2">تحذيرات</h3>
          <ul className="text-sm text-amber-700 space-y-1">
            {preview.warnings.slice(0, 20).map((w, i) => (
              <li key={i}>صف {w.row}: {w.message}</li>
            ))}
            {preview.warnings.length > 20 && <li>... و {preview.warnings.length - 20} تحذيرات أخرى</li>}
          </ul>
        </div>
      )}

      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${activeTab === t.key ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Import Tab ── */}
      {activeTab === 'import' && (
        <div className="space-y-4">
          {step === 'upload' && (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Upload className="text-blue-600" size={28} />
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">رفع ملف Excel</h2>
              <p className="text-sm text-gray-500 mb-4">اسحب الملف هنا أو انقر لتحديده. الحد الأقصى ٥٠٠ صف و ٥ ميجابايت.</p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileUpload} />
              <button
                onClick={() => fileRef.current?.click()}
                className="bg-primary-600 hover:bg-primary-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                اختيار ملف
              </button>
              {loading && (
                <div className="mt-4 flex justify-center">
                  <Loader2 className="animate-spin text-primary-600" size={24} />
                </div>
              )}
            </div>
          )}

          {step === 'sheets' && (
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">تحليل المصنف — أوراق العمل</h2>
              <div className="grid gap-3">
                {sheets.map(s => (
                  <div key={s.name} className={`flex items-center gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${s.name === selectedSheet ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:bg-gray-50'}`} onClick={() => selectSheet(s.name)}>
                    {s.type === 'grade_sheet' && (
                      <input
                        type="checkbox"
                        aria-label={`اختيار ورقة الدرجات ${s.name}`}
                        checked={gradeSheetConfigs.find(config => config.sheetName === s.name)?.selected || false}
                        onClick={event => event.stopPropagation()}
                        onChange={event => {
                          const source = gradeSheetConfigs.find(config => config.sheetName === s.name);
                          if (source) updateGradeSheetConfig(source.sourceId, { selected: event.target.checked });
                        }}
                        className="h-5 w-5 rounded border-gray-300 text-primary-600"
                      />
                    )}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white ${s.type === 'students' ? 'bg-green-500' : s.type === 'grade_sheet' ? 'bg-blue-500' : s.type === 'summary' ? 'bg-amber-500' : 'bg-gray-400'}`}>
                      {s.type === 'students' ? <Users size={18} /> : s.type === 'grade_sheet' ? <BookOpen size={18} /> : s.type === 'summary' ? <FileText size={18} /> : <Table size={18} />}
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-gray-900">{s.name}</p>
                      <p className="text-xs text-gray-500">
                        {s.type === 'students' ? 'قائمة طلاب' : s.type === 'grade_sheet' ? 'ورقة مادة/درجات' : s.type === 'summary' ? 'ملخص/تقرير' : 'غير معروف'}
                        {' — '}صف العناوين {s.headerRowIndex == null ? 'غير موثوق' : s.headerRowIndex + 1} — {s.columnNames.length} أعمدة — {s.rowCount} صفوف بيانات
                        {' — '}ثقة النوع {Math.round(s.analysis.categoryConfidence * 100)}%
                      </p>
                    </div>
                    <ChevronRight size={18} className="text-gray-400" />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={() => setStep('upload')} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">رجوع</button>
                {gradeSheetConfigs.some(config => config.selected) && (
                  <button onClick={openGradeWorkbookMapping} className="rounded-lg bg-primary-600 px-5 py-2 text-sm font-medium text-white hover:bg-primary-700">
                    إعداد {gradeSheetConfigs.filter(config => config.selected).length} أوراق درجات معاً
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 'mapping' && selectedSheet && (
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-2">ربط الأعمدة</h2>
              <p className="text-sm text-gray-500 mb-4">اختر الأعمدة المناسبة من ملف Excel لكل حقل من حقول النظام. يمكن ترك الحقول غير المستخدمة فارغة.</p>

              <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
                <label htmlFor="header-row" className="block text-sm font-bold text-blue-900 mb-2">صف العناوين في Excel</label>
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    id="header-row"
                    value={selectedSheetInfo?.headerRowIndex == null ? 'none' : String(selectedSheetInfo.headerRowIndex + 1)}
                    onChange={event => changeHeaderRow(event.target.value === 'none' ? null : Number(event.target.value))}
                    className="w-28 rounded-md border border-blue-300 px-3 py-2 text-sm"
                  >
                    <option value="none">بلا عنوان موثوق</option>
                    {Array.from({ length: Math.min(selectedSheetInfo?.rows.length || 0, 30) }, (_, index) => (
                      <option key={index + 1} value={index + 1}>{index + 1}</option>
                    ))}
                  </select>
                  <span className="text-xs text-blue-700">
                    اكتشاف تلقائي ضمن أول 20 صفاً غير فارغ. غيّر الرقم لإعادة حساب الأعمدة والربط.
                  </span>
                </div>
              </div>

              <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                {availableTypes.map(t => (
                  <button key={t.value} onClick={() => selectedSheetInfo && changeImportType(selectedSheetInfo, t.value)} className={`flex items-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors ${importTypeConfirmed && selectedType === t.value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 hover:bg-gray-50'}`}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>

              {!importTypeConfirmed && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  لم تُصنّف هذه الورقة كقائمة طلاب أو ورقة درجات. اختر نوع الاستيراد صراحةً قبل المتابعة.
                </div>
              )}

              <div className="mb-4 grid grid-cols-3 gap-3">
                {MODE_OPTIONS.map(m => (
                  <button key={m.value} onClick={() => setMode(m.value)} className={`p-3 rounded-lg border text-sm text-center transition-colors ${mode === m.value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <p className="font-bold">{m.label}</p>
                    <p className="text-xs text-gray-500 mt-1">{m.description}</p>
                  </button>
                ))}
              </div>

              {selectedType === 'grades' && (
                <div className="mb-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setAssignmentMode('strict_existing_assignments')} className={`p-3 rounded-lg border text-sm text-center transition-colors ${assignmentMode === 'strict_existing_assignments' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <p className="font-bold">التسجيلات الحالية فقط</p>
                      <p className="text-xs text-gray-500 mt-1">خطأ إذا لم يكن الطالب مسجلاً في المادة</p>
                    </button>
                    <button onClick={() => setAssignmentMode('auto_assign_missing_subjects')} className={`p-3 rounded-lg border text-sm text-center transition-colors ${assignmentMode === 'auto_assign_missing_subjects' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <p className="font-bold">تسجيل تلقائي</p>
                      <p className="text-xs text-gray-500 mt-1">تسجيل الطالب تلقائياً في المادة المفقودة</p>
                    </button>
                  </div>
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <input id="clear_empty" type="checkbox" checked={clearEmptyFields} onChange={e => setClearEmptyFields(e.target.checked)} className="w-4 h-4 text-amber-600 border-gray-300 rounded focus:ring-amber-500" />
                    <label htmlFor="clear_empty" className="text-sm text-amber-800 font-bold cursor-pointer">مسح الحقول الفارغة (تحذير: سيتم مسح الدرجات الموجودة في الحقول الفارغة)</label>
                  </div>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                    الوضع الافتراضي هو تحديث الدرجات الموجودة. الأعمدة المحسوبة مثل السعي السنوي والنتيجة تُعرض للمراجعة فقط ويعيد النظام حسابها من الدرجات الخام.
                  </div>
                </div>
              )}

              {selectedType === 'grades' && (
                <div className="mb-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div>
                      <h3 className="font-bold text-gray-900">مصادر الدرجات المحددة</h3>
                      <p className="text-xs text-gray-600">يمكن تصحيح مصدر المادة والصف والشعبة وربط الأعمدة لكل مصدر بصورة مستقلة.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setGradeSheetConfigs(previous => previous.map(config => ({ ...config, selected: sheets.find(sheet => sheet.name === config.sheetName)?.type === 'grade_sheet' })))} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium">اختيار المقترحة</button>
                      <button onClick={() => setGradeSheetConfigs(previous => previous.map(config => ({ ...config, selected: false })))} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium">إلغاء الكل</button>
                    </div>
                  </div>

                  {gradeSheetConfigs.filter(config => config.selected).map(config => {
                    const info = sheets.find(sheet => sheet.name === config.sheetName);
                    if (!info) return null;
                    const calculatedColumns = info.analysis.columns
                      .filter(column => isCalculatedGradeHeader(column.headerText))
                      .map(column => column.displayName);
                    const calculatedColumnKeys = new Set(info.analysis.columns
                      .filter(column => isCalculatedGradeHeader(column.headerText))
                      .map(column => column.key));
                    const discoveredMarkers = discoverGradeSpecialMarkers(
                      analysisRowsToRecords(info.rows, info.analysis),
                      config.mapping,
                    );
                    const needsAcknowledgement = gradeConfigNeedsAcknowledgement(config, info);
                    const filteredSections = sections.filter(section => section.status === 'active' && (!config.classId || section.class_id === config.classId));
                    const filteredSubjects = subjects.filter(subject => subject.status !== 'archived'
                      && (!config.classId || subject.class_id == null || subject.class_id === config.classId)
                      && (!config.sectionId || subject.section_id == null || subject.section_id === config.sectionId));
                    return (
                      <details key={config.sourceId} open className="rounded-xl border border-gray-200 bg-white p-4">
                        <summary className="cursor-pointer list-none">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <h4 className="font-bold text-gray-900">{config.sheetName}{config.regionId ? ` — Region ${config.regionId}` : ''}</h4>
                              <p className="text-xs text-gray-500">{info.rowCount} صفاً — نطاق {config.rowStart || '—'}–{config.rowEnd || '—'} — ثقة التصنيف {Math.round(info.analysis.categoryConfidence * 100)}% — ثقة المادة {Math.round(info.analysis.subjectInference.confidence * 100)}%</p>
                            </div>
                            <button type="button" onClick={event => { event.preventDefault(); updateGradeSheetConfig(config.sourceId, { selected: false }); }} className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-700">استبعاد المصدر</button>
                          </div>
                        </summary>

                        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                          <label className="text-sm font-medium text-gray-700">مصدر المادة
                            <select
                              value={config.subjectSource}
                              onChange={event => updateGradeSheetConfig(config.sourceId, {
                                subjectSource: event.target.value as GradeSubjectSource,
                                subjectName: event.target.value === 'inferred' ? info.analysis.subjectInference.subjectName : config.subjectName,
                                subjectId: event.target.value === 'fixed' ? config.subjectId : info.analysis.subjectInference.subjectId,
                                acknowledged: false,
                              })}
                              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
                            >
                              <option value="inferred">استنتاج من الورقة/بيانات المنطقة</option>
                              <option value="column">من عمود المادة لكل صف</option>
                              <option value="fixed">مادة ثابتة لهذا المصدر</option>
                            </select>
                          </label>
                          {config.subjectSource === 'fixed' && (
                            <label className="text-sm font-medium text-gray-700">المادة الثابتة
                              <select
                                value={config.subjectId || ''}
                                onChange={event => {
                                  const subject = subjects.find(item => item.id === Number(event.target.value));
                                  updateGradeSheetConfig(config.sourceId, { subjectId: subject?.id || null, subjectName: subject?.name || null, acknowledged: false });
                                }}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
                              >
                                <option value="">— اختر المادة —</option>
                                {filteredSubjects.map(subject => (
                                  <option key={subject.id} value={subject.id}>
                                    {subject.name}{subject.class_name ? ` — ${subject.class_name}` : ''}{subject.section_name ? ` / ${subject.section_name}` : ''}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          {config.subjectSource === 'column' && (
                            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                              المادة لكل صف من: <strong>{info.analysis.columns.find(column => column.key === config.mapping.subject_name)?.displayName || 'حدد عمود المادة أدناه'}</strong>
                            </div>
                          )}
                          {config.subjectSource === 'inferred' && (
                            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                              المادة المستنتجة: <strong>{config.subjectName || 'غير محددة'}</strong>
                            </div>
                          )}
                          <label className="text-sm font-medium text-gray-700">تقييد بالصف (اختياري)
                            <select value={config.classId || ''} onChange={event => updateGradeSheetConfig(config.sourceId, { classId: event.target.value ? Number(event.target.value) : null, sectionId: null, acknowledged: false })} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2">
                              <option value="">من بيانات الطالب</option>
                              {classes.filter(item => item.status === 'active').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                          </label>
                          <label className="text-sm font-medium text-gray-700">تقييد بالشعبة (اختياري)
                            <select value={config.sectionId || ''} onChange={event => updateGradeSheetConfig(config.sourceId, { sectionId: event.target.value ? Number(event.target.value) : null, acknowledged: false })} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2">
                              <option value="">من بيانات الطالب</option>
                              {filteredSections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                          </label>
                        </div>

                        <div className="mt-4 overflow-auto rounded-lg border border-gray-200">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50"><tr><th className="px-3 py-2 text-right">حقل Smart School</th><th className="px-3 py-2 text-right">عمود Excel</th><th className="px-3 py-2 text-right">الثقة</th></tr></thead>
                            <tbody>
                              {SYSTEM_FIELDS.grades.map(field => {
                                const inference = info.analysis.gradeFieldInferences.find(item => item.field === field.key);
                                return (
                                  <tr key={field.key} className="border-t border-gray-100">
                                    <td className="px-3 py-2 font-medium text-gray-800">{field.label}</td>
                                    <td className="px-3 py-2">
                                      <select value={config.mapping[field.key] || ''} onChange={event => changeGradeSheetMapping(config.sourceId, field.key, event.target.value)} className="w-full min-w-56 rounded-md border border-gray-300 px-2 py-1.5">
                                        <option value="">— تجاهل —</option>
                                        {info.analysis.columns
                                          .filter(column => !RAW_GRADE_FIELDS.some(rawField => rawField === field.key) || !calculatedColumnKeys.has(column.key))
                                          .map(column => <option key={column.key} value={column.key}>{column.displayName} — {column.columnLetter}</option>)}
                                      </select>
                                    </td>
                                    <td className="px-3 py-2 text-xs text-gray-600">{inference && inference.source.type === 'column' && config.mapping[field.key] === inference.source.columnKey ? `${Math.round(inference.confidence * 100)}%` : 'اختيار يدوي'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {discoveredMarkers.length > 0 && (
                          <div className="mt-4 overflow-auto rounded-lg border border-violet-200 bg-violet-50/40">
                            <div className="border-b border-violet-200 px-3 py-2">
                              <p className="text-sm font-bold text-violet-900">قيم نصية خاصة مكتشفة</p>
                              <p className="text-xs text-violet-700">لا يفترض النظام معنى أي علامة. اختر تفسيراً صريحاً لكل علامة؛ وإلا ستبقى خطأ تحقق.</p>
                            </div>
                            <table className="w-full text-sm">
                              <thead><tr><th className="px-3 py-2 text-right">القيمة</th><th className="px-3 py-2 text-right">الحقول/التكرار</th><th className="px-3 py-2 text-right">التفسير لهذا المصدر</th></tr></thead>
                              <tbody>{discoveredMarkers.map(marker => (
                                <tr key={marker.normalized_value} className="border-t border-violet-100">
                                  <td className="px-3 py-2 font-bold text-violet-900">{marker.value}</td>
                                  <td className="px-3 py-2 text-xs text-violet-800">
                                    {marker.fields.map(field => SYSTEM_FIELDS.grades.find(item => item.key === field)?.label || field).join('، ')} — {marker.count} خلية
                                  </td>
                                  <td className="px-3 py-2">
                                    <select
                                      value={config.specialValues[marker.normalized_value] || ''}
                                      onChange={event => changeGradeSpecialValue(config.sourceId, marker.normalized_value, event.target.value as GradeSpecialValueAction | '')}
                                      className="w-full min-w-56 rounded-md border border-violet-200 bg-white px-2 py-1.5"
                                    >
                                      <option value="">غير مفسرة — ستظهر كخطأ</option>
                                      <option value="not_applicable">غير منطبق / غير مشمول — تخطي المادة</option>
                                    </select>
                                  </td>
                                </tr>
                              ))}</tbody>
                            </table>
                          </div>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <button type="button" onClick={() => applyGradeMappingToCompatibleSheets(config.sourceId)} className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">تطبيق الربط على المصادر المتوافقة</button>
                          {calculatedColumns.length > 0 && <span className="text-xs text-amber-700">أعمدة محسوبة ستُتجاهل: {calculatedColumns.join('، ')}</span>}
                        </div>
                        {needsAcknowledgement && (
                          <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                            <input type="checkbox" checked={config.acknowledged} onChange={event => updateGradeSheetConfig(config.sourceId, { acknowledged: event.target.checked })} className="mt-0.5" />
                            <span>راجعت المادة والحقول ذات الثقة المنخفضة لهذا المصدر وأؤكد الاختيارات.</span>
                          </label>
                        )}
                      </details>
                    );
                  })}
                  {!gradeSheetConfigs.some(config => config.selected) && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">لم تُحدد أي مصادر درجات. ارجع إلى قائمة الأوراق أو اختر الأوراق المقترحة.</div>}
                </div>
              )}

              {selectedType === 'students' && (
                <div className="mb-4 space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-bold text-gray-900">ما فهمه النظام</h3>
                      <p className="text-xs text-gray-600">
                        المنطقة المرجحة: الصفوف {(selectedTable?.region.startRow || 0) + 1}–{(selectedTable?.region.endRow || 0) + 1}
                        {'، '}الأعمدة {selectedTable?.columns[0]?.columnLetter || '—'}–{selectedTable?.columns[selectedTable.columns.length - 1]?.columnLetter || '—'}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${selectedSheetInfo?.analysis.categoryConfidence && selectedSheetInfo.analysis.categoryConfidence >= 0.9 ? 'bg-green-100 text-green-700' : selectedSheetInfo?.analysis.categoryConfidence && selectedSheetInfo.analysis.categoryConfidence >= 0.7 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                      قائمة طلاب — ثقة {Math.round((selectedSheetInfo?.analysis.categoryConfidence || 0) * 100)}%
                    </span>
                  </div>

                  <div className="overflow-auto rounded-lg border border-gray-200 bg-white">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50"><tr><th className="px-3 py-2 text-right">الحقل</th><th className="px-3 py-2 text-right">المصدر القابل للتغيير</th><th className="px-3 py-2 text-right">الثقة</th></tr></thead>
                      <tbody>
                        {STUDENT_SEMANTIC_FIELDS.map(field => {
                          const inference = selectedTable?.fieldInferences.find(item => item.field === field);
                          const selectedSource = studentSources[field];
                          const isRecommended = fieldSourceIdentity(selectedSource) === fieldSourceIdentity(inference?.source);
                          const metadataOptions = (selectedSheetInfo?.analysis.metadata || []).filter(candidate => candidate.field === field);
                          return (
                            <tr key={field} className="border-t border-gray-100 align-top">
                              <td className="px-3 py-3 font-medium text-gray-900">{STUDENT_SEMANTIC_LABELS[field]}{(field === 'full_name' || field === 'class_name') && <span className="text-red-500"> *</span>}</td>
                              <td className="px-3 py-3">
                                <select value={fieldSourceIdentity(selectedSource)} onChange={event => changeStudentSource(field, event.target.value)} className="w-full min-w-56 rounded-md border border-gray-300 px-2 py-2 text-sm">
                                  {field !== 'full_name' && field !== 'class_name' && <option value="ignore">تجاهل</option>}
                                  {(selectedSheetInfo?.analysis.columns || []).map(column => <option key={column.key} value={column.key}>{column.displayName} — العمود {column.columnLetter}</option>)}
                                  {(field === 'class_name' || field === 'section_name') && metadataOptions.map((candidate, index) => (
                                    <option key={`${fieldSourceIdentity(candidate.source)}-${index}`} value={fieldSourceIdentity(candidate.source)}>
                                      {candidate.source.type === 'metadata-cell' ? `نص أعلى الجدول: ${candidate.originalText}` : candidate.source.type === 'sheet-name' ? `اسم الورقة: ${candidate.originalText}` : `اسم الملف: ${candidate.originalText}`}
                                    </option>
                                  ))}
                                  {(field === 'class_name' || field === 'section_name') && <option value="system-selection">اختيار موجود من النظام</option>}
                                  {(field === 'class_name' || field === 'section_name') && <option value="constant">قيمة ثابتة يدوية</option>}
                                </select>
                                {selectedSource?.type === 'constant' && (field === 'class_name' || field === 'section_name') && (
                                  <input value={selectedSource.value} onChange={event => changeConstantSource(field, event.target.value)} placeholder="اكتب القيمة التي ستطبق على جميع الصفوف" className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                                )}
                                {selectedSource?.type === 'system-selection' && field === 'class_name' && (
                                  <select value={selectedClassId || ''} onChange={event => { setSelectedClassId(event.target.value ? Number(event.target.value) : null); setSelectedSectionId(null); }} className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                                    <option value="">— اختر الصف —</option>
                                    {classes.filter(item => item.status === 'active').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                                  </select>
                                )}
                                {selectedSource?.type === 'system-selection' && field === 'section_name' && (
                                  <select value={selectedSectionId || ''} onChange={event => setSelectedSectionId(event.target.value ? Number(event.target.value) : null)} className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                                    <option value="">— اختر الشعبة —</option>
                                    {sections.filter(item => item.status === 'active' && (!selectedClassId || item.class_id === selectedClassId)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                                  </select>
                                )}
                              </td>
                              <td className="px-3 py-3">
                                {isRecommended && inference ? (
                                  <span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-bold ${inference.confidence >= 0.9 ? 'bg-green-100 text-green-700' : inference.confidence >= 0.7 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                                    {inference.confidence >= 0.9 ? 'ثقة عالية' : inference.confidence >= 0.7 ? 'يحتاج مراجعة' : 'غير مؤكد'} ({Math.round(inference.confidence * 100)}%)
                                  </span>
                                ) : <span className="text-xs font-medium text-blue-700">اختيار المستخدم</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {lowConfidenceInferences.length > 0 && (
                    <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      <input type="checkbox" checked={analysisAcknowledged} onChange={event => setAnalysisAcknowledged(event.target.checked)} className="mt-0.5" />
                      <span>راجعت الحقول غير المؤكدة ({lowConfidenceInferences.map(inference => STUDENT_SEMANTIC_LABELS[inference.field]).join('، ')}) وأوافق على المصادر المختارة.</span>
                    </label>
                  )}
                  <p className="text-xs text-gray-600">الاقتراحات لا تقفل الاختيار. لن ينشئ الاستيراد صفوفاً أو شعباً، وسيعيد الخادم التحقق من المدرسة والصف والشعبة قبل الحفظ.</p>
                </div>
              )}

              {selectedType !== 'grades' && <div className="overflow-auto border border-gray-200 rounded-lg mb-4">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-right px-4 py-2 font-semibold text-gray-700">حقل النظام</th>
                      <th className="text-right px-4 py-2 font-semibold text-gray-700">عمود Excel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SYSTEM_FIELDS[selectedType].filter(field => selectedType !== 'students' || !STUDENT_SEMANTIC_FIELDS.includes(field.key as StudentSemanticField)).map(field => (
                      <tr key={field.key} className="border-t border-gray-100">
                        <td className="px-4 py-2">
                          <span className={field.required ? 'font-bold text-red-600' : 'text-gray-800'}>{field.label}</span>
                          {field.required && <span className="text-red-500 mr-1">*</span>}
                        </td>
                        <td className="px-4 py-2">
                          <select
                            value={mapping[field.key] || ''}
                            onChange={e => handleMappingChange(field.key, e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                          >
                            <option value="">— تجاهل هذا الحقل —</option>
                            {selectedSheetInfo?.analysis.columns.map(column => (
                              <option key={column.key} value={column.key}>{column.displayName} — العمود {column.columnLetter}</option>
                            ))}
                          </select>
                          {field.hint && <p className="mt-1 text-xs text-gray-500">{field.hint}</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}

              {selectedType !== 'grades' && ignoredCols.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                  <p className="text-sm text-amber-800 font-bold">أعمدة سيتم تجاهلها:</p>
                  <p className="text-sm text-amber-700">{ignoredCols.join('، ')}</p>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => setStep('sheets')} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">رجوع</button>
                <button onClick={parseSheetAndPreview} disabled={loading || !schoolId} className="bg-primary-600 hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={16} />}
                  معاينة البيانات
                </button>
              </div>
            </div>
          )}

          {step === 'preview' && preview && (
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">معاينة البيانات</h2>
              {selectedSheetInfo && selectedType !== 'grades' && (
                <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                  الورقة: <strong>{selectedSheetInfo.name}</strong>
                  {' — '}النوع المتوقع: <strong>{selectedSheetInfo.type === 'students' ? 'قائمة طلاب' : selectedSheetInfo.type === 'grade_sheet' ? 'ورقة مادة/درجات' : selectedSheetInfo.type === 'summary' ? 'ملخص/تقرير' : 'غير معروف'}</strong>
                  {' — '}الثقة: <strong>{Math.round(selectedSheetInfo.analysis.categoryConfidence * 100)}%</strong>
                  {' — '}نطاق الجدول: <strong>{(selectedTable?.region.startRow || 0) + 1}–{(selectedTable?.region.endRow || 0) + 1}</strong>
                </div>
              )}
              {selectedType === 'grades' && (preview.sources || preview.sheets) && (
                <div className="mb-4 overflow-auto rounded-lg border border-gray-200">
                  <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm font-bold text-gray-800">ملخص مصادر الدرجات</div>
                  <table className="w-full text-sm">
                    <thead><tr><th className="px-3 py-2 text-right">المصدر</th><th className="px-3 py-2 text-right">مصدر المادة</th><th className="px-3 py-2 text-right">صالح</th><th className="px-3 py-2 text-right">غير منطبق</th><th className="px-3 py-2 text-right">جديد</th><th className="px-3 py-2 text-right">تحديث</th><th className="px-3 py-2 text-right">أخطاء</th></tr></thead>
                    <tbody>{(preview.sources || preview.sheets || []).map((source, index) => <tr key={source.source_id || `${source.sheet_name}-${index}`} className="border-t border-gray-100"><td className="px-3 py-2 font-medium">{source.sheet_name}{source.region_id ? ` — Region ${source.region_id}` : ''}</td><td className="px-3 py-2">{source.subject_source === 'column' ? 'من عمود المادة' : source.subject_name || 'حسب المطابقة'}</td><td className="px-3 py-2">{source.valid_rows}</td><td className="px-3 py-2 text-violet-700">{source.not_applicable_rows || 0}</td><td className="px-3 py-2">{source.new_rows}</td><td className="px-3 py-2">{source.update_rows}</td><td className="px-3 py-2 text-red-700">{source.error_rows}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
              {selectedType === 'students' && preview.valid[0]?.data && (
                <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  الصف: <strong>{preview.valid[0].data.class_name || 'غير محدد'}</strong>
                  {' — '}الشعبة: <strong>{studentSources.section_name?.type === 'ignore' ? 'بلا شعبة' : (preview.valid[0].data.section_name || 'مشتقة لكل صف')}</strong>
                </div>
              )}
              <div className={`grid grid-cols-2 gap-3 mb-4 ${selectedType === 'grades' ? 'md:grid-cols-6' : 'md:grid-cols-5'}`}>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-blue-700">{preview.total_rows}</p>
                  <p className="text-xs text-blue-600">إجمالي الصفوف</p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-700">{preview.valid_rows}</p>
                  <p className="text-xs text-green-600">صالح</p>
                </div>
                {selectedType === 'grades' && (
                  <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-center">
                    <p className="text-2xl font-bold text-violet-700">{preview.not_applicable_rows || 0}</p>
                    <p className="text-xs text-violet-600">غير منطبق/متخطى</p>
                  </div>
                )}
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-red-700">{preview.error_rows}</p>
                  <p className="text-xs text-red-600">خطأ</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-amber-700">{preview.duplicate_rows}</p>
                  <p className="text-xs text-amber-600">مكرر/متخطى</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-gray-700">{preview.skipped_rows || 0}</p>
                  <p className="text-xs text-gray-600">فارغ/متخطى</p>
                </div>
              </div>

              {preview.errors.length > 0 && (
                <div className="mb-4 max-h-64 overflow-auto border border-red-200 rounded-lg">
                  <div className="bg-red-50 px-4 py-2 text-sm font-bold text-red-700 border-b border-red-200">أخطاء في الصفوف</div>
                  <table className="w-full text-sm">
                    <thead className="bg-red-50 sticky top-0">
                      <tr><th className="px-4 py-2 text-right">الصف</th><th className="px-4 py-2 text-right">الحقل</th><th className="px-4 py-2 text-right">الخطأ</th></tr>
                    </thead>
                    <tbody>
                      {preview.errors.map((e, i) => (
                        <tr key={i} className="border-t border-red-100">
                          <td className="px-4 py-2 text-red-700 font-bold">{e.label || (e.sheet ? `${e.sheet} — ${e.row ?? 'الورقة'}` : e.row)}</td>
                          <td className="px-4 py-2 text-red-600">{e.field}</td>
                          <td className="px-4 py-2 text-red-600">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {preview.warnings.length > 0 && (
                <div className="mb-4 max-h-56 overflow-auto rounded-lg border border-amber-200">
                  <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800">تحذيرات المعاينة ({preview.warnings.length})</div>
                  <ul className="divide-y divide-amber-100 text-sm">
                    {preview.warnings.slice(0, 100).map((warning, index) => (
                      <li key={index} className="px-4 py-2 text-amber-800"><strong>{warning.label || warning.row || 'عام'}:</strong> {warning.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedType === 'grades' && (preview.not_applicable?.length || 0) > 0 && (
                <div className="mb-4 max-h-56 overflow-auto rounded-lg border border-violet-200">
                  <div className="border-b border-violet-200 bg-violet-50 px-4 py-2 text-sm font-bold text-violet-800">صفوف غير منطبقة تم تخطيها ({preview.not_applicable_rows || 0})</div>
                  <table className="w-full text-sm">
                    <thead><tr><th className="px-3 py-2 text-right">المصدر</th><th className="px-3 py-2 text-right">الطالب</th><th className="px-3 py-2 text-right">المادة</th><th className="px-3 py-2 text-right">العلامة</th></tr></thead>
                    <tbody>{preview.not_applicable?.map((record, index) => (
                      <tr key={record.source_id ? `${record.source_id}:${record.excel_row_number}:${record.subject_id}` : index} className="border-t border-violet-100">
                        <td className="px-3 py-2">{record.sheet_name}{record.region_id ? ` — Region ${record.region_id}` : ''} — Excel row {record.excel_row_number}</td>
                        <td className="px-3 py-2">{record.student_name}{record.student_number ? ` (${record.student_number})` : ''}</td>
                        <td className="px-3 py-2">{record.subject_name}</td>
                        <td className="px-3 py-2">{record.markers?.map((marker: any) => `${marker.value} (${SYSTEM_FIELDS.grades.find(field => field.key === marker.field)?.label || marker.field})`).join('، ')}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}

              {preview.duplicates.length > 0 && (
                <div className="mb-4 max-h-48 overflow-auto rounded-lg border border-amber-200">
                  <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-700">صفوف مكررة</div>
                  <table className="w-full text-sm"><thead><tr><th className="px-4 py-2 text-right">صف Excel</th><th className="px-4 py-2 text-right">الطالب</th><th className="px-4 py-2 text-right">رقم الطالب</th></tr></thead><tbody>
                      {preview.duplicates.map((duplicate, index) => <tr key={index} className="border-t border-amber-100"><td className="px-4 py-2">{duplicate.label || duplicate.row}</td><td className="px-4 py-2">{duplicate.full_name || duplicate.message || ''}</td><td className="px-4 py-2">{duplicate.student_number || ''}</td></tr>)}
                  </tbody></table>
                </div>
              )}

              {selectedType === 'grades' && preview.valid.length > 0 && (
                <div className="mb-4 max-h-80 overflow-auto rounded-lg border border-gray-200">
                  <div className="border-b border-gray-200 bg-green-50 px-4 py-2 text-sm font-bold text-green-700">تغييرات الدرجات المخططة ({preview.valid_rows})</div>
                  <table className="w-full text-sm"><thead className="sticky top-0 bg-gray-50"><tr><th className="px-3 py-2 text-right">المصدر</th><th className="px-3 py-2 text-right">الطالب</th><th className="px-3 py-2 text-right">الصف/الشعبة</th><th className="px-3 py-2 text-right">المادة</th><th className="px-3 py-2 text-right">التغييرات الخام</th><th className="px-3 py-2 text-right">الإجراء</th></tr></thead><tbody>
                    {preview.valid.slice(0, 100).map((record, index) => <tr key={record.source_id ? `${record.source_id}:${record.excel_row_number}:${record.subject_id}` : index} className="border-t border-gray-100 align-top"><td className="px-3 py-2">{record.sheet_name}{record.region_id ? ` — Region ${record.region_id}` : ''} — Excel row {record.excel_row_number}</td><td className="px-3 py-2">{record.student_name}{record.student_number ? ` (${record.student_number})` : ''}</td><td className="px-3 py-2">{record.class_name || '—'} / {record.section_name || '—'}</td><td className="px-3 py-2">{record.subject_name}</td><td className="px-3 py-2 text-xs">{record.changed_fields?.map((field: string) => `${field}: ${record.existing_values?.[field] ?? 'فارغ'} ← ${record.values?.[field] ?? 'فارغ'}`).join('، ') || '—'}</td><td className="px-3 py-2">{record.action === 'update' ? 'تحديث' : 'إنشاء'}{record.assignment_action === 'create' ? ' + تسجيل مادة' : record.assignment_action === 'reactivate' ? ' + إعادة تفعيل التسجيل' : ''}</td></tr>)}
                  </tbody></table>
                </div>
              )}

              {selectedType !== 'grades' && preview.valid.length > 0 && (
                <div className="mb-4 max-h-80 overflow-auto border border-gray-200 rounded-lg">
                  <div className="bg-green-50 px-4 py-2 text-sm font-bold text-green-700 border-b border-green-200">الصفوف الصالحة ({preview.valid_rows})</div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-right">صف Excel</th>
                        {previewFields.map(f => (
                          <th key={f.key} className="px-4 py-2 text-right">{f.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.valid.slice(0, 50).map((r, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-4 py-2 text-gray-500">{r.data.excel_row_number || r.row_index}</td>
                          {previewFields.map(f => (
                            <td key={f.key} className="px-4 py-2 text-gray-800">{String(r.data[f.key] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                      {preview.valid.length > 50 && (
                        <tr><td colSpan={100} className="px-4 py-2 text-center text-gray-500 text-sm">... و {preview.valid.length - 50} صفوف أخرى</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => setStep('mapping')} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">رجوع</button>
                <button onClick={handleConfirm} disabled={loading || (preview.valid_rows === 0 && (preview.not_applicable_rows || 0) === 0) || preview.error_rows > 0 || !schoolId} className="bg-green-600 hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                  تأكيد الاستيراد
                </button>
              </div>
            </div>
          )}

          {step === 'confirm' && confirmResult && (
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
              <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="text-green-600" size={32} />
              </div>
              <h2 className="text-lg font-bold text-green-700 mb-2">تم الاستيراد بنجاح</h2>
              <div className="grid grid-cols-4 gap-3 mb-4 text-sm">
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-xl font-bold text-green-700">{confirmResult.imported_count}</p>
                  <p className="text-xs text-green-600">مستورد</p>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-xl font-bold text-blue-700">{confirmResult.updated_count}</p>
                  <p className="text-xs text-blue-600">محدث</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xl font-bold text-amber-700">{confirmResult.skipped_count}</p>
                  <p className="text-xs text-amber-600">متخطى</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-xl font-bold text-red-700">{confirmResult.error_count}</p>
                  <p className="text-xs text-red-600">خطأ</p>
                </div>
              </div>
              <button onClick={() => { setStep('upload'); setFile(null); setPreview(null); setConfirmResult(null); }} className="bg-primary-600 hover:bg-primary-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">
                استيراد جديد
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Export Tab ── */}
      {activeTab === 'export' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">تصدير البيانات</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {availableTypes.map(t => (
                <button key={t.value} onClick={() => handleExport(t.value)} disabled={!schoolId} className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors text-right">
                  {t.icon}
                  <div className="flex-1">
                    <p className="font-bold text-gray-900">{t.label}</p>
                    <p className="text-xs text-gray-500">تنزيل ملف Excel</p>
                  </div>
                  <Download size={18} className="text-gray-400" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Templates Tab ── */}
      {activeTab === 'templates' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">قوالب Excel</h2>
            <p className="text-sm text-gray-500 mb-4">قم بتحميل قوالب Excel فارغة لملء البيانات واستيرادها لاحقاً.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {availableTypes.map(t => (
                <button key={t.value} onClick={() => handleTemplateDownload(t.value)} className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-right">
                  {t.icon}
                  <div className="flex-1">
                    <p className="font-bold text-gray-900">{t.label}</p>
                    <p className="text-xs text-gray-500">تنزيل قالب Excel</p>
                  </div>
                  <FileSpreadsheet size={18} className="text-gray-400" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Jobs Tab ── */}
      {activeTab === 'jobs' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">سجل عمليات الاستيراد</h2>
            {loading && (
              <div className="flex justify-center p-8">
                <Loader2 className="animate-spin text-primary-600" size={24} />
              </div>
            )}
            {!loading && importJobs.length === 0 && (
              <p className="text-center text-gray-500 py-8">لا توجد عمليات استيراد</p>
            )}
            {!loading && importJobs.length > 0 && (
              <div className="overflow-auto border border-gray-200 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-right">#</th>
                      <th className="px-4 py-2 text-right">النوع</th>
                      <th className="px-4 py-2 text-right">الملف</th>
                      <th className="px-4 py-2 text-right">الحالة</th>
                      <th className="px-4 py-2 text-right">مستورد</th>
                      <th className="px-4 py-2 text-right">متخطى</th>
                      <th className="px-4 py-2 text-right">محدث</th>
                      <th className="px-4 py-2 text-right">خطأ</th>
                      <th className="px-4 py-2 text-right">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importJobs.map((job: any) => (
                      <tr key={job.id} className="border-t border-gray-100">
                        <td className="px-4 py-2 text-gray-500">{job.id}</td>
                        <td className="px-4 py-2">{job.import_type}</td>
                        <td className="px-4 py-2">{job.file_name || '—'}</td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${job.status === 'completed' ? 'bg-green-100 text-green-700' : job.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                            {job.status}
                          </span>
                        </td>
                        <td className="px-4 py-2">{job.imported_rows}</td>
                        <td className="px-4 py-2">{job.skipped_rows}</td>
                        <td className="px-4 py-2">{job.updated_rows}</td>
                        <td className="px-4 py-2">{job.error_rows}</td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{new Date((job.created_at || 0) * 1000).toLocaleString('ar-IQ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
