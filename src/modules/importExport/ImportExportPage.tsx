import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { previewImport, confirmImport, getExportData, getImportJobs } from '../../lib/api';
import { Upload, Download, FileSpreadsheet, Table, AlertTriangle, CheckCircle, XCircle, FileText, History, ChevronRight, ArrowLeft, ArrowRight, Loader2, BookOpen, Layers, GraduationCap, Users } from 'lucide-react';

// ===========================================
// Phase 13A: Excel Import/Export Page
// ===========================================

type ImportType = 'students' | 'classes-sections' | 'subjects' | 'employees';
type ImportMode = 'skip_existing' | 'update_existing' | 'error_on_existing';
type SheetType = 'students' | 'subjects' | 'summary' | 'unknown';

interface SheetInfo {
  name: string;
  type: SheetType;
  columnNames: string[];
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
];

const MODE_OPTIONS: { value: ImportMode; label: string; description: string }[] = [
  { value: 'skip_existing', label: 'تخطي المكرر', description: 'تخطي الصفوف الموجودة مسبقاً' },
  { value: 'update_existing', label: 'تحديث المكرر', description: 'تحديث الصفوف الموجودة بالبيانات الجديدة' },
  { value: 'error_on_existing', label: 'خطأ عند المكرر', description: 'إظهار خطأ إذا كان الصف موجوداً' },
];

const SYSTEM_FIELDS: Record<ImportType, { key: string; label: string; required?: boolean; hint?: string }[]> = {
  students: [
    { key: 'student_number', label: 'رقم الطالب', required: true },
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
};

function classifySheetName(name: string): SheetType {
  const n = name.toLowerCase().trim();
  const studentNames = ['ادخال الاسماء', 'الاسماء', 'الطلاب', 'اسماء الطلاب', 'students', 'student', 'names', 'الاسم', 'اسماء'];
  const summaryNames = ['ملخص', 'النتيجة النهائية', 'نصف السنة', 'القرار', 'كنترول', 'تدقيق', 'تجييك', 'summary', 'control', 'report', 'final', 'result'];
  const subjectNames = ['فيزياء', 'كيمياء', 'احياء', 'الفيزياء', 'الكيمياء', 'الاحياء', 'عربية', 'العربية', 'اسلامية', 'الاسلامية', 'انكليزية', 'الانكليزية', 'الاجتماعيات', 'رياضيات', 'الرياضيات', 'حاسوب', 'الحاسوب', 'الانجليزية', 'انجليزية', 'فرنسية', 'الفرنسية', 'التاريخ', 'تاريخ', 'جغرافيا', 'الجغرافيا', 'علوم', 'العلوم', 'رياضة', 'الرياضة', 'الفن', 'فن', 'موسيقى', 'الكردية', 'السورية', 'الفلسفة', 'المنطق', 'الاقتصاد', 'الادارة', 'القانون', 'الاحصاء', 'النفس', 'الاجتماع', 'البيولوجيا', 'الجيولوجيا', 'الفلك', 'الفنون', 'الصحة', 'البيئة', 'الطاقة', 'الفضاء', 'النووي', 'الليزر', 'المواد'];

  if (studentNames.some(s => n.includes(s.toLowerCase()))) return 'students';
  if (summaryNames.some(s => n.includes(s.toLowerCase()))) return 'summary';
  if (subjectNames.some(s => n.includes(s.toLowerCase()))) return 'subjects';
  return 'unknown';
}

function autoMapColumns(excelColumns: string[], importType: ImportType): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<string>();
  const fields = SYSTEM_FIELDS[importType];
  for (const field of fields) {
    const candidates = AUTO_MAP_RULES[field.key] || [];
    for (const col of excelColumns) {
      const colLower = col.toLowerCase().trim();
      if (used.has(col)) continue;
      if (candidates.some(c => colLower === c.toLowerCase() || colLower.includes(c.toLowerCase()))) {
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
  const [mode, setMode] = useState<ImportMode>('skip_existing');
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [sheetRows, setSheetRows] = useState<any[]>([]);
  const [mapping, setMapping] = useState<ColumnMap>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [confirmResult, setConfirmResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'upload' | 'sheets' | 'mapping' | 'preview' | 'confirm'>('upload');
  const [importJobs, setImportJobs] = useState<any[]>([]);
  const [schoolId, setSchoolId] = useState<number>(user?.school_id || 1);
  const fileRef = useRef<HTMLInputElement>(null);
  const [xlsxModule, setXlsxModule] = useState<any>(null);

  const canAccessEmployees = user?.role_key === 'system_admin' || user?.role_key === 'school_owner' || user?.role_key === 'principal';
  const canImportExport = user?.role_key === 'system_admin' || user?.role_key === 'school_owner' || user?.role_key === 'principal' || user?.role_key === 'registrar';
  const canExport = canImportExport;

  const availableTypes = TYPE_OPTIONS.filter(t => t.value !== 'employees' || canAccessEmployees);

  useEffect(() => {
    if (user?.school_id) setSchoolId(user.school_id);
  }, [user]);

  useEffect(() => {
    if (activeTab === 'jobs') loadJobs();
  }, [activeTab]);

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
        const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
        const headers = (json[0] || []).map(String);
        return { name, type: classifySheetName(name), columnNames: headers };
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
    const sheetType = info.type;
    let suggestedType: ImportType = 'students';
    if (sheetType === 'subjects') suggestedType = 'subjects';
    setSelectedType(suggestedType);
    setMapping(autoMapColumns(info.columnNames, suggestedType));
    setStep('mapping');
  };

  const handleMappingChange = (field: string, col: string) => {
    setMapping(prev => ({ ...prev, [field]: col }));
  };

  const mappedRows = useCallback(() => {
    if (!selectedSheet || !xlsxModule || !file) return [];
    return sheetRows; // Actually parsed below on mapping step
  }, [selectedSheet, xlsxModule, file, sheetRows]);

  const parseSheetAndPreview = async () => {
    if (!selectedSheet || !file) return;
    setLoading(true);
    try {
      const XLSX = await loadXlsx();
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const ws = workbook.Sheets[selectedSheet];
      const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
      const headers = json[0] || [];
      const rows = json.slice(1).map((r: any[]) => {
        const obj: Record<string, any> = {};
        headers.forEach((h: any, i: number) => {
          if (h) obj[String(h)] = r[i] ?? '';
        });
        return obj;
      }).filter(r => Object.values(r).some(v => v !== ''));
      setSheetRows(rows);

      const mappedData = rows.map((raw: any) => {
        const obj: Record<string, any> = {};
        for (const [field, col] of Object.entries(mapping)) {
          if (col && raw[col] !== undefined) obj[field] = raw[col];
        }
        return obj;
      }).filter(r => Object.values(r).some(v => v !== '' && v !== null));

      const res = await previewImport(selectedType, { school_id: schoolId, rows: mappedData, mode, mapping });
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
      const res = await confirmImport(selectedType, { school_id: schoolId, rows: rowsToSend, mode, file_name: file?.name || 'import.xlsx' });
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
        XLSX.utils.book_append_sheet(wb, ws, type === 'classes-sections' ? 'الصفوف والشعب' : type === 'students' ? 'الطلاب' : type === 'subjects' ? 'المواد' : 'الموظفون');
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
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white ${s.type === 'students' ? 'bg-green-500' : s.type === 'subjects' ? 'bg-blue-500' : s.type === 'summary' ? 'bg-amber-500' : 'bg-gray-400'}`}>
                      {s.type === 'students' ? <Users size={18} /> : s.type === 'subjects' ? <BookOpen size={18} /> : s.type === 'summary' ? <FileText size={18} /> : <Table size={18} />}
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-gray-900">{s.name}</p>
                      <p className="text-xs text-gray-500">
                        {s.type === 'students' ? 'ورقة محتملة: الطلاب' : s.type === 'subjects' ? 'ورقة محتملة: مواد/درجات' : s.type === 'summary' ? 'ورقة ملخص/تقرير' : 'غير محدد'} — {s.columnNames.length} أعمدة
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

              <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                {TYPE_OPTIONS.map(t => (
                  <button key={t.value} onClick={() => { setSelectedType(t.value); setMapping(autoMapColumns(sheets.find(s => s.name === selectedSheet)?.columnNames || [], t.value)); }} className={`flex items-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors ${selectedType === t.value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 hover:bg-gray-50'}`}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>

              <div className="mb-4 grid grid-cols-3 gap-3">
                {MODE_OPTIONS.map(m => (
                  <button key={m.value} onClick={() => setMode(m.value)} className={`p-3 rounded-lg border text-sm text-center transition-colors ${mode === m.value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <p className="font-bold">{m.label}</p>
                    <p className="text-xs text-gray-500 mt-1">{m.description}</p>
                  </button>
                ))}
              </div>

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
                            <option value="">— غير محدد —</option>
                            {sheets.find(s => s.name === selectedSheet)?.columnNames.map(col => (
                              <option key={col} value={col}>{col}</option>
                            ))}
                          </select>
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
              <div className="grid grid-cols-4 gap-3 mb-4">
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

              {preview.valid.length > 0 && (
                <div className="mb-4 max-h-80 overflow-auto border border-gray-200 rounded-lg">
                  <div className="bg-green-50 px-4 py-2 text-sm font-bold text-green-700 border-b border-green-200">الصفوف الصالحة ({preview.valid_rows})</div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-right">#</th>
                        {SYSTEM_FIELDS[selectedType].filter(f => mapping[f.key]).map(f => (
                          <th key={f.key} className="px-4 py-2 text-right">{f.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.valid.slice(0, 50).map((r, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-4 py-2 text-gray-500">{r.row_index}</td>
                          {SYSTEM_FIELDS[selectedType].filter(f => mapping[f.key]).map(f => (
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
