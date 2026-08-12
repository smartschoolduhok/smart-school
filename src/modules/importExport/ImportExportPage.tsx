import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { IMPORT_EXPORT_ROLES, hasRole } from '../../lib/rbac';
import { previewImport, confirmImport, getExportData, getImportJobs, getClasses, getSections } from '../../lib/api';
import {
  analyzeWorksheet,
  classifyWorksheet,
  detectHeaderRowAt,
  normalizeHeader,
  sheetRowsToRecords,
  type WorksheetCategory,
  type WorksheetRows,
} from '../../lib/excelImport';
import { Upload, Download, FileSpreadsheet, Table, AlertTriangle, CheckCircle, XCircle, FileText, History, ChevronRight, ArrowLeft, ArrowRight, Loader2, BookOpen, Layers, GraduationCap, Users } from 'lucide-react';

// ===========================================
// Phase 13A: Excel Import/Export Page
// ===========================================

type ImportType = 'students' | 'classes-sections' | 'subjects' | 'employees' | 'grades' | 'student-subjects';
type ImportMode = 'skip_existing' | 'update_existing' | 'error_on_existing';
type AssignmentMode = 'strict_existing_assignments' | 'auto_assign_missing_subjects';
type ClassAssignmentMode = 'excel' | 'override';
type SectionAssignmentMode = 'excel' | 'override' | 'none';

interface SheetInfo {
  name: string;
  type: WorksheetCategory;
  columnNames: string[];
  headerRowIndex: number;
  headerScore: number;
  headerConfidence: 'high' | 'medium' | 'low';
  rowCount: number;
  rows: WorksheetRows;
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
  valid: PreviewRow[];
  errors: any[];
  warnings: any[];
  duplicates: any[];
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
  second_month: ['السعي الثاني', 'second_month', 'second term', 'الفصل الثاني'],
  third_month: ['درجة الفصل الثاني', 'الفصل الثاني', 'third_month', 'third term', 'السعي الثالث'],
  fourth_month: ['السعي الرابع', 'fourth_month', 'fourth term'],
  mid_year_exam: ['نصف السنة', 'درجة نصف السنة', 'mid_year_exam', 'mid_year', 'mid year exam', 'mid'],
  final_exam: ['امتحان نهاية السنة', 'درجة نهاية السنة', 'final_exam', 'final exam', 'final', 'نهاية السنة'],
  completion_exam: ['الاكمال', 'درجة الاكمال', 'completion_exam', 'completion', 'complementary', 'الإكمال'],
};

function autoMapColumns(excelColumns: string[], importType: ImportType): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<string>();
  const fields = SYSTEM_FIELDS[importType];
  for (const field of fields) {
    const candidates = AUTO_MAP_RULES[field.key] || [];
    for (const col of excelColumns) {
      const colLower = normalizeHeader(col);
      if (used.has(col)) continue;
      if (candidates.some(c => {
        const candidate = normalizeHeader(c);
        return colLower === candidate || (candidate.length > 2 && colLower.includes(candidate));
      })) {
        map[field.key] = col;
        used.add(col);
        break;
      }
    }
  }
  return map;
}

function detectIgnoredColumns(excelColumns: string[], mapping: ColumnMap): string[] {
  const used = new Set(Object.values(mapping).filter(Boolean));
  return excelColumns.filter(c => !used.has(c));
}

export default function ImportExportPage() {
  const { user } = useAuth();
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
  const [schoolId, setSchoolId] = useState<number>(user?.school_id || 1);
  const fileRef = useRef<HTMLInputElement>(null);
  const [xlsxModule, setXlsxModule] = useState<any>(null);
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>('strict_existing_assignments');
  const [clearEmptyFields, setClearEmptyFields] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null);
  const [classes, setClasses] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);
  const [classAssignmentMode, setClassAssignmentMode] = useState<ClassAssignmentMode>('override');
  const [sectionAssignmentMode, setSectionAssignmentMode] = useState<SectionAssignmentMode>('excel');

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

  useEffect(() => {
    if (user?.school_id) setSchoolId(user.school_id);
  }, [user]);

  useEffect(() => {
    if (activeTab === 'jobs') loadJobs();
  }, [activeTab]);

  useEffect(() => {
    let cancelled = false;
    if (!schoolId) return;
    Promise.all([getClasses(schoolId), getSections(schoolId)]).then(([classResult, sectionResult]) => {
      if (cancelled) return;
      setClasses(classResult.data || []);
      setSections(sectionResult.data || []);
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
        const analysis = analyzeWorksheet(name, rows);
        return {
          name,
          type: analysis.category,
          columnNames: analysis.columnNames,
          headerRowIndex: analysis.headerRowIndex,
          headerScore: analysis.score,
          headerConfidence: analysis.confidence,
          rowCount: analysis.rowCount,
          rows,
        };
      });
      setSheets(sheetInfos);
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
      setMapping(autoMapColumns(info.columnNames, suggestedType));
      setImportTypeConfirmed(true);
    } else {
      setMapping({});
      setImportTypeConfirmed(false);
    }
    setStep('mapping');
  };

  const changeHeaderRow = (oneBasedRow: number) => {
    const info = sheets.find(s => s.name === selectedSheet);
    if (!info) return;
    const detection = detectHeaderRowAt(info.rows, Math.max(0, oneBasedRow - 1));
    setSheets(previous => previous.map(sheet => sheet.name === info.name ? {
      ...sheet,
      columnNames: detection.columnNames,
      type: classifyWorksheet(sheet.name, sheet.rows, detection),
      headerRowIndex: detection.headerRowIndex,
      headerScore: detection.score,
      headerConfidence: detection.confidence,
      rowCount: Math.max(0, sheet.rows.length - detection.headerRowIndex - 1),
    } : sheet));
    setMapping(autoMapColumns(detection.columnNames, selectedType));
    setPreview(null);
  };

  const handleMappingChange = (field: string, col: string) => {
    setMapping(prev => ({ ...prev, [field]: col }));
  };

  const parseSheetAndPreview = async () => {
    if (!selectedSheet || !file) return;
    setLoading(true);
    try {
      const info = sheets.find(s => s.name === selectedSheet);
      if (!info) throw new Error('تعذر العثور على ورقة العمل المحددة');
      if (!importTypeConfirmed) throw new Error('اختر نوع الاستيراد لهذه الورقة أولاً');
      if (!mapping.full_name && selectedType === 'students') throw new Error('يجب ربط حقل اسم الطالب');
      if (selectedType === 'students' && classAssignmentMode === 'excel' && !mapping.class_name) {
        throw new Error('يجب ربط عمود الصف أو اختيار صف واحد لكل الملف');
      }
      if (selectedType === 'students' && sectionAssignmentMode === 'excel' && !mapping.section_name) {
        throw new Error('يجب ربط عمود الشعبة أو اختيار وضع آخر للشعبة');
      }
      if (selectedType === 'students' && classAssignmentMode === 'override' && !selectedClassId) {
        throw new Error('يجب اختيار الصف عند استخدام الصف المحدد يدوياً');
      }
      if (selectedType === 'students' && sectionAssignmentMode === 'override' && !selectedSectionId) {
        throw new Error('يجب اختيار الشعبة عند استخدام الشعبة المحددة يدوياً');
      }
      const rows = sheetRowsToRecords(info.rows, info.headerRowIndex);
      const payload: any = { school_id: schoolId, rows, mode, mapping };
      if (selectedType === 'students') {
        payload.class_assignment_mode = classAssignmentMode;
        payload.section_assignment_mode = sectionAssignmentMode;
        payload.selected_class_id = selectedClassId;
        payload.selected_section_id = selectedSectionId;
      }
      if (selectedType === 'grades') {
        payload.assignment_mode = assignmentMode;
        payload.clear_empty_fields = clearEmptyFields;
        payload.selected_subject_id = selectedSubjectId;
        payload.selected_class_id = selectedClassId;
        payload.selected_section_id = selectedSectionId;
        payload.selected_sheet = selectedSheet;
      }
      if (selectedType === 'student-subjects') {
        payload.selected_class_id = selectedClassId;
        payload.selected_section_id = selectedSectionId;
      }
      const res = await previewImport(selectedType, payload);
      if (res.data) {
        setPreview(res.data as PreviewResult);
        setStep('preview');
      } else if (res.error) {
        alert(res.error);
      }
    } catch (err: any) {
      alert('فشل في المعاينة: ' + (err.message || 'خطأ غير معروف'));
    }
    setLoading(false);
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setLoading(true);
    try {
      const rowsToSend = preview.valid.map((r: PreviewRow) => r.data);
      const payload: any = { school_id: schoolId, rows: rowsToSend, mode, file_name: file?.name || 'import.xlsx' };
      if (selectedType === 'students') {
        payload.class_assignment_mode = classAssignmentMode;
        payload.section_assignment_mode = sectionAssignmentMode;
        payload.selected_class_id = selectedClassId;
        payload.selected_section_id = selectedSectionId;
      }
      if (selectedType === 'grades') {
        payload.assignment_mode = assignmentMode;
        payload.clear_empty_fields = clearEmptyFields;
      }
      const res = await confirmImport(selectedType, payload);
      if (res.data) {
        setConfirmResult(res.data);
        setStep('confirm');
      } else if (res.error) {
        alert(res.error);
      }
    } catch (err: any) {
      alert('فشل في تأكيد الاستيراد: ' + (err.message || 'خطأ غير معروف'));
    }
    setLoading(false);
  };

  const handleExport = async (type: ImportType) => {
    setLoading(true);
    try {
      const res = await getExportData(type, schoolId);
      if (res.data?.rows) {
        const XLSX = await loadXlsx();
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
      alert('فشل في التصدير: ' + (err.message || 'خطأ غير معروف'));
    }
    setLoading(false);
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

  const ignoredCols = selectedSheet ? detectIgnoredColumns(sheets.find(s => s.name === selectedSheet)?.columnNames || [], mapping) : [];

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
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white ${s.type === 'students' ? 'bg-green-500' : s.type === 'grade_sheet' ? 'bg-blue-500' : s.type === 'summary' ? 'bg-amber-500' : 'bg-gray-400'}`}>
                      {s.type === 'students' ? <Users size={18} /> : s.type === 'grade_sheet' ? <BookOpen size={18} /> : s.type === 'summary' ? <FileText size={18} /> : <Table size={18} />}
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-gray-900">{s.name}</p>
                      <p className="text-xs text-gray-500">
                        {s.type === 'students' ? 'قائمة طلاب' : s.type === 'grade_sheet' ? 'ورقة مادة/درجات' : s.type === 'summary' ? 'ملخص/تقرير' : 'غير معروف'}
                        {' — '}صف العناوين {s.headerRowIndex + 1} — {s.columnNames.length} أعمدة — {s.rowCount} صفوف بيانات
                        {' — '}ثقة {s.headerConfidence === 'high' ? 'عالية' : s.headerConfidence === 'medium' ? 'متوسطة' : 'منخفضة'}
                      </p>
                    </div>
                    <ChevronRight size={18} className="text-gray-400" />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={() => setStep('upload')} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">رجوع</button>
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
                  <input
                    id="header-row"
                    type="number"
                    min={1}
                    max={sheets.find(s => s.name === selectedSheet)?.rows.length || 1}
                    value={(sheets.find(s => s.name === selectedSheet)?.headerRowIndex || 0) + 1}
                    onChange={event => changeHeaderRow(Number(event.target.value) || 1)}
                    className="w-28 rounded-md border border-blue-300 px-3 py-2 text-sm"
                  />
                  <span className="text-xs text-blue-700">
                    اكتشاف تلقائي ضمن أول 20 صفاً غير فارغ. غيّر الرقم لإعادة حساب الأعمدة والربط.
                  </span>
                </div>
              </div>

              <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                {availableTypes.map(t => (
                  <button key={t.value} onClick={() => { setSelectedType(t.value); setImportTypeConfirmed(true); setMapping(autoMapColumns(sheets.find(s => s.name === selectedSheet)?.columnNames || [], t.value)); }} className={`flex items-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors ${importTypeConfirmed && selectedType === t.value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 hover:bg-gray-50'}`}>
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
                </div>
              )}

              {selectedType === 'students' && (
                <div className="mb-4 space-y-4 rounded-lg border border-gray-200 p-4">
                  <div>
                    <p className="text-sm font-bold text-gray-900 mb-2">تحديد الصف</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
                      <button type="button" onClick={() => { setClassAssignmentMode('excel'); if (sectionAssignmentMode === 'override') { setSectionAssignmentMode('excel'); setSelectedSectionId(null); } }} className={`rounded-lg border p-3 text-sm ${classAssignmentMode === 'excel' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200'}`}>من عمود Excel</button>
                      <button type="button" onClick={() => setClassAssignmentMode('override')} className={`rounded-lg border p-3 text-sm ${classAssignmentMode === 'override' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200'}`}>صف واحد لكل الملف</button>
                    </div>
                    {classAssignmentMode === 'override' && (
                      <select value={selectedClassId || ''} onChange={event => { setSelectedClassId(event.target.value ? Number(event.target.value) : null); setSelectedSectionId(null); }} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                        <option value="">— اختر الصف —</option>
                        {classes.filter(item => item.status === 'active').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900 mb-2">تحديد الشعبة</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
                      <button type="button" onClick={() => setSectionAssignmentMode('excel')} className={`rounded-lg border p-3 text-sm ${sectionAssignmentMode === 'excel' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200'}`}>من عمود Excel</button>
                      <button type="button" disabled={classAssignmentMode !== 'override'} onClick={() => setSectionAssignmentMode('override')} className={`rounded-lg border p-3 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${sectionAssignmentMode === 'override' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200'}`}>شعبة واحدة لكل الملف</button>
                      <button type="button" onClick={() => { setSectionAssignmentMode('none'); setSelectedSectionId(null); }} className={`rounded-lg border p-3 text-sm ${sectionAssignmentMode === 'none' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200'}`}>بلا شعبة</button>
                    </div>
                    {sectionAssignmentMode === 'override' && (
                      <select value={selectedSectionId || ''} onChange={event => setSelectedSectionId(event.target.value ? Number(event.target.value) : null)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                        <option value="">— اختر الشعبة —</option>
                        {sections.filter(item => item.status === 'active' && (!selectedClassId || item.class_id === selectedClassId)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">لن ينشئ الاستيراد صفوفاً أو شعباً جديدة. أي صف أو شعبة غير موجودة أو من مدرسة أخرى سيُرفض من الخادم.</p>
                </div>
              )}

              <div className="overflow-auto border border-gray-200 rounded-lg mb-4">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-right px-4 py-2 font-semibold text-gray-700">حقل النظام</th>
                      <th className="text-right px-4 py-2 font-semibold text-gray-700">عمود Excel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SYSTEM_FIELDS[selectedType].map(field => (
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
                            {sheets.find(s => s.name === selectedSheet)?.columnNames.map(col => (
                              <option key={col} value={col}>{col}</option>
                            ))}
                          </select>
                          {field.hint && <p className="mt-1 text-xs text-gray-500">{field.hint}</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {ignoredCols.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                  <p className="text-sm text-amber-800 font-bold">أعمدة سيتم تجاهلها:</p>
                  <p className="text-sm text-amber-700">{ignoredCols.join('، ')}</p>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => setStep('sheets')} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">رجوع</button>
                <button onClick={parseSheetAndPreview} disabled={loading} className="bg-primary-600 hover:bg-primary-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={16} />}
                  معاينة البيانات
                </button>
              </div>
            </div>
          )}

          {step === 'preview' && preview && (
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">معاينة البيانات</h2>
              {selectedType === 'students' && preview.valid[0]?.data && (
                <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  الصف: <strong>{preview.valid[0].data.class_name || 'غير محدد'}</strong>
                  {' — '}الشعبة: <strong>{sectionAssignmentMode === 'none' ? 'بلا شعبة' : (preview.valid[0].data.section_name || 'مشتقة لكل صف')}</strong>
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-blue-700">{preview.total_rows}</p>
                  <p className="text-xs text-blue-600">إجمالي الصفوف</p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-700">{preview.valid_rows}</p>
                  <p className="text-xs text-green-600">صالح</p>
                </div>
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
                          <td className="px-4 py-2 text-red-700 font-bold">{e.row}</td>
                          <td className="px-4 py-2 text-red-600">{e.field}</td>
                          <td className="px-4 py-2 text-red-600">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {preview.duplicates.length > 0 && (
                <div className="mb-4 max-h-48 overflow-auto rounded-lg border border-amber-200">
                  <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-700">صفوف مكررة</div>
                  <table className="w-full text-sm"><thead><tr><th className="px-4 py-2 text-right">صف Excel</th><th className="px-4 py-2 text-right">الطالب</th><th className="px-4 py-2 text-right">رقم الطالب</th></tr></thead><tbody>
                    {preview.duplicates.map((duplicate, index) => <tr key={index} className="border-t border-amber-100"><td className="px-4 py-2">{duplicate.row}</td><td className="px-4 py-2">{duplicate.full_name || ''}</td><td className="px-4 py-2">{duplicate.student_number || ''}</td></tr>)}
                  </tbody></table>
                </div>
              )}

              {preview.valid.length > 0 && (
                <div className="mb-4 max-h-80 overflow-auto border border-gray-200 rounded-lg">
                  <div className="bg-green-50 px-4 py-2 text-sm font-bold text-green-700 border-b border-green-200">الصفوف الصالحة ({preview.valid_rows})</div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-right">صف Excel</th>
                        {SYSTEM_FIELDS[selectedType].filter(f => mapping[f.key] || (selectedType === 'students' && ['student_number', 'full_name', 'class_name', 'section_name'].includes(f.key))).map(f => (
                          <th key={f.key} className="px-4 py-2 text-right">{f.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.valid.slice(0, 50).map((r, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-4 py-2 text-gray-500">{r.data.excel_row_number || r.row_index}</td>
                          {SYSTEM_FIELDS[selectedType].filter(f => mapping[f.key] || (selectedType === 'students' && ['student_number', 'full_name', 'class_name', 'section_name'].includes(f.key))).map(f => (
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
                <button onClick={handleConfirm} disabled={loading || preview.valid_rows === 0} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
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
                <button key={t.value} onClick={() => handleExport(t.value)} className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-right">
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
