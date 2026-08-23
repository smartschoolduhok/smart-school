import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import type { RoleKey } from '../../types';
import { SCHOOL_MANAGEMENT_ROLES, hasRole } from '../../lib/rbac';
import {
  getGrades, getStudentGrades, initializeStudentGrades, initializeSectionGrades,
  updateGrade, bulkUpdateGrades, getGradeHistory, getGradeSettings, updateGradeSettings,
  getStudents, getClasses, getSections, getSubjects
} from '../../lib/api';
import { toArabicDigits } from '../../lib/arabicDigits';
import type { GradeCalculationSettings } from '../../lib/gradeCalculations';
import { displayGradeStatus } from '../../lib/gradePresentation';
import { createPerKeyTaskQueue, mergeUpdatedRow } from '../../lib/perKeyTaskQueue';
import {
  gradeInputColumns,
  gradeSchemeSummary,
  normalizeGradeSchemeSettings,
  RAW_GRADE_FIELD_LABELS,
  validateGradeSchemeSettings,
  type GradeEnabledFlag,
  type GradeTermInputMode,
  type RawGradeField,
} from '../../lib/gradeScheme';
import {
  Calculator, Save, Loader2, AlertCircle, CheckCircle, Search, User, Users,
  Settings, History, BookOpen, ChevronDown, ChevronUp
} from 'lucide-react';

/* ─── Shared helpers ─── */
function displayNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return toArabicDigits(String(n));
}

function statusBadge(status: string | null) {
  if (!status) return <span className="text-gray-400">—</span>;
  const cls =
    status === 'ناجح' ? 'bg-emerald-100 text-emerald-700' :
    status === 'راسب' ? 'bg-red-100 text-red-700' :
    status === 'مكمل' ? 'bg-amber-100 text-amber-700' :
    status === 'معفو' ? 'bg-indigo-100 text-indigo-700' :
    'bg-gray-100 text-gray-700';
  return <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${cls}`}>{status}</span>;
}

/* ─── Types ─── */
interface GradeRecord {
  id: number;
  school_id: number;
  student_subject_id: number;
  first_term_grade: number | null;
  first_month: number | null;
  second_month: number | null;
  second_term_grade: number | null;
  third_month: number | null;
  fourth_month: number | null;
  mid_year_exam: number | null;
  final_exam: number | null;
  completion_exam: number | null;
  first_term_average: number | null;
  second_term_average: number | null;
  annual_effort: number | null;
  final_grade: number | null;
  grade_after_completion: number | null;
  effective_grade: number | null;
  result_status: string | null;
  exemption_status: number;
  notes: string | null;
  is_active: number;
  student_name?: string;
  student_number?: string;
  subject_name?: string;
  class_name?: string;
  section_name?: string;
  subject_id?: number;
}

interface StudentRecord {
  id: number;
  full_name: string;
  student_number: string;
  class_id: number | null;
  section_id: number | null;
}

interface ClassRecord { id: number; name: string; }
interface SectionRecord { id: number; name: string; class_id: number; }
interface SubjectRecord { id: number; name: string; class_id: number | null; section_id: number | null; }

interface GradeSettings extends GradeCalculationSettings {
  id?: number;
  school_id: number;
  general_exemption_average_grade: number;
  general_exemption_min_subject_grade: number;
  first_term_formula?: string;
  second_term_formula?: string;
  annual_effort_formula?: string;
  final_grade_formula?: string;
  completion_formula?: string;
  effective_formula?: string;
}

interface AuditRecord {
  id: number;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_by_name: string | null;
  change_reason: string | null;
  created_at: string;
}

type TabKey = 'student' | 'section' | 'settings' | 'history';

const DEFAULT_GRADE_SETTINGS_FORM = {
  max_grade: '100',
  passing_grade: '50',
  exemption_grade: '90',
  general_exemption_average_grade: '85',
  general_exemption_min_subject_grade: '75',
  first_term_input_mode: 'monthly' as GradeTermInputMode,
  second_term_input_mode: 'monthly' as GradeTermInputMode,
  mid_year_exam_enabled: 1 as GradeEnabledFlag,
  final_exam_enabled: 1 as GradeEnabledFlag,
  completion_exam_enabled: 1 as GradeEnabledFlag,
};

const TAB_CONFIG: { key: TabKey; label: string; icon: React.ReactNode; roles?: readonly RoleKey[] }[] = [
  { key: 'student', label: 'إدخال درجات طالب', icon: <User size={18} /> },
  { key: 'section', label: 'إدخال درجات شعبة', icon: <Users size={18} /> },
  { key: 'settings', label: 'إعدادات الدرجات', icon: <Settings size={18} />, roles: SCHOOL_MANAGEMENT_ROLES },
  { key: 'history', label: 'سجل تعديل الدرجات', icon: <History size={18} /> },
];

function canAccessTab(userRole: RoleKey | undefined, tabRoles?: readonly RoleKey[]): boolean {
  if (!tabRoles || tabRoles.length === 0) return true;
  return hasRole(userRole, tabRoles);
}

export default function GradesPage() {
  const { user } = useAuth();
  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const visibleTabs = TAB_CONFIG.filter((tab) => canAccessTab(user?.role_key, tab.roles));
  const [activeTab, setActiveTab] = useState<TabKey>('student');
  // Reset to first visible tab if current tab becomes hidden
  const effectiveTab = visibleTabs.find((t) => t.key === activeTab) ? activeTab : visibleTabs[0]?.key || 'student';

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-primary-50 rounded-lg flex items-center justify-center">
          <Calculator size={20} className="text-primary-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">الدرجات والحسابات</h1>
          <p className="text-sm text-gray-500">إدارة درجات الطلاب والحسابات الأكاديمية</p>
        </div>
      </div>

      <SystemAdminSchoolSelector {...schoolScope} />

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              effectiveTab === tab.key
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {effectiveTab === 'student' && <StudentGradesTab schoolId={schoolId} />}
      {effectiveTab === 'section' && <SectionGradesTab schoolId={schoolId} />}
      {effectiveTab === 'settings' && <SettingsTab schoolId={schoolId} />}
      {effectiveTab === 'history' && <HistoryTab schoolId={schoolId} />}
    </div>
  );
}

/* ═══════════════════════════════════════
   Tab 1: إدخال درجات طالب
   ═══════════════════════════════════════ */
function StudentGradesTab({ schoolId }: { schoolId: number | null }) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [grades, setGrades] = useState<GradeRecord[]>([]);
  const [settings, setSettings] = useState<GradeSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [studentName, setStudentName] = useState('');
  const [gradeSaveQueue] = useState(() => createPerKeyTaskQueue<number>());
  const inputColumns = useMemo(() => settings ? gradeInputColumns(settings) : [], [settings]);

  useEffect(() => {
    setStudents([]);
    setSelectedStudentId('');
    setGrades([]);
    setSettings(null);
    setStudentName('');
    setLoading(false);
    setInitLoading(false);
    setMessage(null);
    void loadStudents();
  }, [schoolId]);

  async function loadStudents() {
    if (schoolId == null) { setStudents([]); return; }
    const isCurrent = captureSchoolRequest();
    const res = await getStudents(schoolId, null, null);
    if (!isCurrent()) return;
    if (res.data) setStudents(res.data as StudentRecord[]);
  }

  async function loadStudentGrades(studentId: string) {
    if (!studentId) return;
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    const res = await getStudentGrades(studentId);
    if (!isCurrent()) return;
    if (res.data) {
      setGrades((res.data.grades || []) as GradeRecord[]);
      setSettings((res.data.settings || null) as GradeSettings | null);
      setStudentName(res.data.student_name || '');
    }
    setLoading(false);
  }

  async function handleInit() {
    if (!selectedStudentId) { setMessage({ text: 'يرجى اختيار طالب أولاً', type: 'error' }); return; }
    if (schoolId == null) return;
    const isCurrent = captureSchoolRequest();
    setInitLoading(true);
    const res = await initializeStudentGrades(selectedStudentId, schoolId);
    if (!isCurrent()) return;
    setInitLoading(false);
    if (res.error) {
      setMessage({ text: res.error, type: 'error' });
    } else {
      setMessage({ text: `تمت تهيئة درجات الطالب بنجاح (تم إنشاء ${toArabicDigits(String(res.data?.created || 0))} وتخطي ${toArabicDigits(String(res.data?.skipped || 0))})`, type: 'success' });
      await loadStudentGrades(selectedStudentId);
    }
    setTimeout(() => setMessage(null), 4000);
  }

  async function handleSaveGrade(grade: GradeRecord, field: RawGradeField | 'notes', value: string) {
    const num = field === 'notes' ? null : value === '' ? null : Number(value);
    if (field !== 'notes' && value !== '' && (num === null || isNaN(num))) {
      setMessage({ text: `القيمة في حقل ${fieldNameArabic(field)} ليست رقمًا صحيحًا`, type: 'error' });
      setTimeout(() => setMessage(null), 3000);
      return;
    }
    if (field !== 'notes' && num !== null && settings && (num < 0 || num > settings.max_grade)) {
      setMessage({ text: `القيمة يجب أن تكون بين ٠ و ${toArabicDigits(String(settings.max_grade))}`, type: 'error' });
      setTimeout(() => setMessage(null), 3000);
      return;
    }

    if (schoolId == null) return;
    const isCurrent = captureSchoolRequest();
    const payload: Record<string, any> = { [field]: field === 'notes' ? value : num };
    try {
      await gradeSaveQueue.enqueue(grade.id, async () => {
        if (!isCurrent()) return;
        const res = await updateGrade(grade.id, payload, schoolId);
        if (!isCurrent()) return;

        if (res.error) {
          setMessage({ text: res.error, type: 'error' });
          setTimeout(() => setMessage(null), 3000);
          return;
        }

        if (!res.data || Number(res.data.id) !== grade.id) {
          setMessage({ text: 'تعذر تحديث الدرجة من استجابة الخادم', type: 'error' });
          setTimeout(() => setMessage(null), 3000);
          return;
        }

        const updated = { ...res.data, id: Number(res.data.id) } as Partial<GradeRecord> & Pick<GradeRecord, 'id'>;
        setGrades((current) => mergeUpdatedRow(current, updated));
      });
    } catch {
      if (!isCurrent()) return;
      setMessage({ text: 'فشل حفظ الدرجة، يرجى المحاولة مرة أخرى', type: 'error' });
      setTimeout(() => setMessage(null), 3000);
    }
  }

  function fieldNameArabic(field: string): string {
    const map: Record<string, string> = {
      ...RAW_GRADE_FIELD_LABELS,
      notes: 'ملاحظات',
    };
    return map[field] || field;
  }

  return (
    <div className="space-y-4">
      {message && (
        <div className={`flex items-center gap-2 p-3 rounded-lg ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span className="text-sm">{message.text}</span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-medium text-gray-700 mb-1">اختيار الطالب</label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select
              value={selectedStudentId}
              onChange={(e) => { setSelectedStudentId(e.target.value); loadStudentGrades(e.target.value); }}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white"
            >
              <option value="">— اختر طالب —</option>
              {students.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.full_name} ({toArabicDigits(s.student_number)})
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          onClick={handleInit}
          disabled={initLoading || !selectedStudentId}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {initLoading ? <Loader2 size={16} className="animate-spin" /> : <BookOpen size={16} />}
          تهيئة درجات الطالب
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={28} className="animate-spin text-primary-600" />
          <span className="mr-2 text-sm text-gray-500">جاري تحميل الدرجات...</span>
        </div>
      )}

      {!loading && selectedStudentId && grades.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <BookOpen size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">لا توجد درجات لهذا الطالب</p>
          <p className="text-xs text-gray-400 mt-1">يمكنك تهيئة الدرجات بالنقر على الزر أعلاه</p>
        </div>
      )}

      {!loading && grades.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">درجات الطالب: {studentName}</h3>
              {settings && (
                <p className="text-xs text-gray-500 mt-0.5">
                  الدرجة العظمى: {toArabicDigits(String(settings.max_grade))} | درجة النجاح: {toArabicDigits(String(settings.passing_grade))} | درجة الإعفاء الفردي: {toArabicDigits(String(settings.exemption_grade))}
                  {settings.general_exemption_average_grade !== undefined && (
                    <> | الإعفاء العام: متوسط ≥ {toArabicDigits(String(settings.general_exemption_average_grade))}، أدنى ≥ {toArabicDigits(String(settings.general_exemption_min_subject_grade))}</>
                  )}
                </p>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-xs">
                  <th className="px-3 py-2 text-right font-medium border-b border-gray-200">المادة</th>
                  {inputColumns.map((column) => (
                    <th key={column.key} className="px-2 py-2 text-center font-medium border-b border-gray-200 min-w-24">
                      {column.label}{!column.editable && <span className="block text-[9px] text-gray-400">محسوب</span>}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-center font-medium border-b border-gray-200 min-w-20">السعي السنوي</th>
                  <th className="px-2 py-2 text-center font-medium border-b border-gray-200 min-w-20">الدرجة النهائية</th>
                  <th className="px-2 py-2 text-center font-medium border-b border-gray-200 min-w-20">الدرجة الفعّالة</th>
                  <th className="px-2 py-2 text-center font-medium border-b border-gray-200 min-w-20">الحالة</th>
                  <th className="px-2 py-2 text-center font-medium border-b border-gray-200 min-w-24">ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {grades.map((g) => (
                  <tr key={g.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 border-b border-gray-100 font-medium text-gray-900">{g.subject_name}</td>
                    {inputColumns.map((column) => (
                      <td key={column.key} className={`px-1 py-1 border-b border-gray-100 ${column.editable ? '' : 'text-center text-gray-600 font-medium bg-gray-50/50'}`}>
                        {column.editable ? (
                          <input
                            type="text"
                            inputMode="numeric"
                            defaultValue={displayNum(g[column.key])}
                            onBlur={(e) => {
                              const field = column.key as RawGradeField;
                              const val = e.target.value.trim();
                              const current = g[field] === null ? '' : toArabicDigits(String(g[field]));
                              if (val !== current) void handleSaveGrade(g, field, val);
                            }}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            className="w-full px-1.5 py-1 text-center text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                            placeholder="—"
                          />
                        ) : displayNum(g[column.key])}
                      </td>
                    ))}
                    <td className="px-1 py-1 border-b border-gray-100 text-center text-gray-700 font-semibold bg-amber-50/30">{displayNum(g.annual_effort)}</td>
                    <td className="px-1 py-1 border-b border-gray-100 text-center text-gray-700 font-semibold bg-amber-50/30">{displayNum(g.final_grade)}</td>
                    <td className="px-1 py-1 border-b border-gray-100 text-center text-gray-700 font-semibold bg-rose-50/30">{displayNum(g.effective_grade ?? g.final_grade)}</td>
                    <td className="px-2 py-2 border-b border-gray-100 text-center">{statusBadge(displayGradeStatus(g.result_status, g.exemption_status))}</td>
                    <td className="px-1 py-1 border-b border-gray-100">
                      <input
                        type="text"
                        defaultValue={g.notes || ''}
                        onBlur={(e) => {
                          const val = e.target.value.trim();
                          if (val !== (g.notes || '')) void handleSaveGrade(g, 'notes', val);
                        }}
                        className="w-full px-1.5 py-1 text-center text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                        placeholder="—"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 space-y-1">
            <p>{gradeSchemeSummary(settings)}</p>
            <p>لا تُحسب النتائج حتى تكتمل جميع مكونات النظام المفعّلة. الحقول الرمادية تُحسب تلقائيًا.</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   Tab 2: إدخال درجات شعبة
   ═══════════════════════════════════════ */
function SectionGradesTab({ schoolId }: { schoolId: number | null }) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [sections, setSections] = useState<SectionRecord[]>([]);
  const [subjects, setSubjects] = useState<SubjectRecord[]>([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [grades, setGrades] = useState<GradeRecord[]>([]);
  const [settings, setSettings] = useState<GradeSettings | null>(null);
  const [fieldToEdit, setFieldToEdit] = useState<string>('');
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const editableFields = useMemo(() => settings ? gradeInputColumns(settings).filter(column => column.editable) : [], [settings]);

  useEffect(() => {
    setClasses([]);
    setSections([]);
    setSubjects([]);
    setSelectedClassId('');
    setSelectedSectionId('');
    setSelectedSubjectId('');
    setGrades([]);
    setSettings(null);
    setFieldToEdit('');
    setEdits({});
    setLoading(false);
    setInitLoading(false);
    setSaveLoading(false);
    setMessage(null);
    setShowConfirm(false);
    void loadClasses();
    void loadSubjects();
    void loadSettings();
  }, [schoolId]);
  useEffect(() => {
    if (!editableFields.some(field => field.key === fieldToEdit)) {
      setFieldToEdit(editableFields[0]?.key || '');
      setEdits({});
      setShowConfirm(false);
    }
  }, [editableFields, fieldToEdit]);
  useEffect(() => {
    if (selectedClassId) loadSections(selectedClassId);
    else { setSections([]); setSelectedSectionId(''); }
  }, [selectedClassId]);

  async function loadClasses() {
    if (schoolId == null) { setClasses([]); return; }
    const isCurrent = captureSchoolRequest();
    const res = await getClasses(schoolId);
    if (!isCurrent()) return;
    if (res.data) setClasses(res.data as ClassRecord[]);
  }
  async function loadSections(classId: string) {
    if (schoolId == null) { setSections([]); return; }
    const isCurrent = captureSchoolRequest();
    const res = await getSections(schoolId, Number(classId));
    if (!isCurrent()) return;
    if (res.data) setSections(res.data as SectionRecord[]);
  }
  async function loadSubjects() {
    if (schoolId == null) { setSubjects([]); return; }
    const isCurrent = captureSchoolRequest();
    const res = await getSubjects(schoolId, null, null);
    if (!isCurrent()) return;
    if (res.data) setSubjects(res.data as SubjectRecord[]);
  }
  async function loadSettings() {
    if (schoolId == null) { setSettings(null); return; }
    const isCurrent = captureSchoolRequest();
    const res = await getGradeSettings(schoolId);
    if (!isCurrent()) return;
    const data = Array.isArray(res.data) ? res.data[0] : res.data;
    setSettings(data ? data as GradeSettings : null);
  }

  async function loadGrades() {
    if (schoolId == null || !selectedSectionId || !selectedSubjectId) return;
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    const res = await getGrades({
      school_id: schoolId,
      section_id: Number(selectedSectionId),
      subject_id: Number(selectedSubjectId),
      is_active: true,
    });
    if (!isCurrent()) return;
    setGrades((res.data || []) as GradeRecord[]);
    setEdits({});
    setLoading(false);
  }

  async function handleInit() {
    if (!selectedSectionId || !selectedSubjectId) {
      setMessage({ text: 'يرجى اختيار الشعبة والمادة', type: 'error' });
      setTimeout(() => setMessage(null), 3000);
      return;
    }
    if (schoolId == null) return;
    const isCurrent = captureSchoolRequest();
    setInitLoading(true);
    const res = await initializeSectionGrades({
      school_id: schoolId,
      section_id: Number(selectedSectionId),
      subject_ids: [Number(selectedSubjectId)],
    });
    if (!isCurrent()) return;
    setInitLoading(false);
    if (res.error) {
      setMessage({ text: res.error, type: 'error' });
    } else {
      setMessage({ text: `تمت تهيئة درجات الشعبة بنجاح (إنشاء ${toArabicDigits(String(res.data?.created || 0))})`, type: 'success' });
      await loadGrades();
    }
    setTimeout(() => setMessage(null), 4000);
  }

  function handleBulkSave() {
    if (!fieldToEdit) {
      setMessage({ text: 'لا توجد حقول درجات مفعّلة للإدخال', type: 'error' });
      return;
    }
    const entries = Object.entries(edits)
      .filter(([, v]) => v !== '')
      .map(([gradeId, value]) => ({
        grade_id: Number(gradeId),
        [fieldToEdit]: value,
      }));
    if (entries.length === 0) {
      setMessage({ text: 'لا توجد تغييرات للحفظ', type: 'error' });
      setTimeout(() => setMessage(null), 3000);
      return;
    }
    setShowConfirm(true);
  }

  async function confirmBulkSave() {
    setShowConfirm(false);
    if (schoolId == null) return;
    const isCurrent = captureSchoolRequest();
    setSaveLoading(true);
    const entries = Object.entries(edits)
      .filter(([, v]) => v !== '')
      .map(([gradeId, value]) => ({
        grade_id: Number(gradeId),
        [fieldToEdit]: value,
      }));
    const res = await bulkUpdateGrades(entries, schoolId);
    if (!isCurrent()) return;
    setSaveLoading(false);
    if (res.error) {
      setMessage({ text: res.error, type: 'error' });
    } else {
      setMessage({ text: `تم حفظ ${toArabicDigits(String(res.data?.updated || 0))} درجة بنجاح`, type: 'success' });
      setEdits({});
      await loadGrades();
    }
    setTimeout(() => setMessage(null), 4000);
  }

  return (
    <div className="space-y-4">
      {message && (
        <div className={`flex items-center gap-2 p-3 rounded-lg ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span className="text-sm">{message.text}</span>
        </div>
      )}

      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-lg">
            <h3 className="text-lg font-bold text-gray-900 mb-2">تأكيد الحفظ</h3>
            <p className="text-sm text-gray-600 mb-4">
              هل أنت متأكد من حفظ التغييرات على {toArabicDigits(String(Object.keys(edits).filter((k) => edits[Number(k)] !== '').length))} طالب؟
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowConfirm(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">إلغاء</button>
              <button onClick={confirmBulkSave} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700">تأكيد الحفظ</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <label className="block text-xs font-medium text-gray-700 mb-1">الصف</label>
          <select value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <option value="">— اختر —</option>
            {classes.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </div>
        <div className="w-40">
          <label className="block text-xs font-medium text-gray-700 mb-1">الشعبة</label>
          <select value={selectedSectionId} onChange={(e) => { setSelectedSectionId(e.target.value); }} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" disabled={!selectedClassId}>
            <option value="">— اختر —</option>
            {sections.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select>
        </div>
        <div className="w-56">
          <label className="block text-xs font-medium text-gray-700 mb-1">المادة</label>
          <select value={selectedSubjectId} onChange={(e) => setSelectedSubjectId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <option value="">— اختر —</option>
            {subjects.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select>
        </div>
        <div className="w-40">
          <label className="block text-xs font-medium text-gray-700 mb-1">الحقل</label>
          <select value={fieldToEdit} onChange={(e) => { setFieldToEdit(e.target.value); setEdits({}); }} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" disabled={!editableFields.length}>
            {!editableFields.length && <option value="">لا توجد حقول مفعّلة</option>}
            {editableFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
        <button onClick={loadGrades} disabled={!selectedSectionId || !selectedSubjectId} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-50">
          عرض الدرجات
        </button>
        <button onClick={handleInit} disabled={initLoading || !selectedSectionId || !selectedSubjectId} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
          {initLoading ? <Loader2 size={16} className="animate-spin" /> : <BookOpen size={16} />}
          تهيئة
        </button>
      </div>

      {grades.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">{toArabicDigits(String(grades.length))} طالب</p>
            <button onClick={handleBulkSave} disabled={saveLoading || !fieldToEdit || Object.keys(edits).filter((k) => edits[Number(k)] !== '').length === 0} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
              {saveLoading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              حفظ الجميع
            </button>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-600 text-xs">
                    <th className="px-3 py-2 text-right font-medium border-b border-gray-200">الطالب</th>
                    <th className="px-2 py-2 text-center font-medium border-b border-gray-200 w-32">{editableFields.find((f) => f.key === fieldToEdit)?.label}</th>
                    <th className="px-2 py-2 text-center font-medium border-b border-gray-200 w-24">السعي السنوي</th>
                    <th className="px-2 py-2 text-center font-medium border-b border-gray-200 w-24">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {grades.map((g) => (
                    <tr key={g.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-2 border-b border-gray-100 font-medium text-gray-900">{g.student_name}</td>
                      <td className="px-1 py-1 border-b border-gray-100">
                        <input
                          type="text"
                          inputMode="numeric"
                          defaultValue={displayNum((g as any)[fieldToEdit])}
                          onChange={(e) => setEdits((prev) => ({ ...prev, [g.id]: e.target.value }))}
                          className="w-full px-1.5 py-1 text-center text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                          placeholder="—"
                        />
                      </td>
                      <td className="px-2 py-2 border-b border-gray-100 text-center text-gray-600 font-medium bg-gray-50/50">{displayNum(g.annual_effort)}</td>
                      <td className="px-2 py-2 border-b border-gray-100 text-center">
                        {statusBadge(displayGradeStatus(g.result_status, g.exemption_status))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={28} className="animate-spin text-primary-600" />
          <span className="mr-2 text-sm text-gray-500">جاري التحميل...</span>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   Tab 3: إعدادات الدرجات
   ═══════════════════════════════════════ */
function SettingsTab({ schoolId }: { schoolId: number | null }) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const { user } = useAuth();
  const canEdit = hasRole(user?.role_key, SCHOOL_MANAGEMENT_ROLES);
  const [settings, setSettings] = useState<GradeSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const [form, setForm] = useState(DEFAULT_GRADE_SETTINGS_FORM);

  useEffect(() => {
    setSettings(null);
    setForm(DEFAULT_GRADE_SETTINGS_FORM);
    setMessage(null);
    setLoading(false);
    setSaving(false);
    void loadSettings();
  }, [schoolId]);

  async function loadSettings() {
    if (schoolId == null) { setLoading(false); return; }
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    const res = await getGradeSettings(schoolId);
    if (!isCurrent()) return;
    setLoading(false);
    if (res.error) {
      setMessage({ text: res.error, type: 'error' });
      setSettings(null);
      return;
    }
    const data = Array.isArray(res.data) ? res.data[0] : res.data;
    if (data) {
      const scheme = normalizeGradeSchemeSettings(data);
      setSettings({ ...data, ...scheme } as GradeSettings);
      setForm({
        max_grade: String(data.max_grade ?? 100),
        passing_grade: String(data.passing_grade ?? 50),
        exemption_grade: String(data.exemption_grade ?? 90),
        general_exemption_average_grade: String(data.general_exemption_average_grade ?? 85),
        general_exemption_min_subject_grade: String(data.general_exemption_min_subject_grade ?? 75),
        ...scheme,
      });
    } else {
      setSettings(null);
    }
  }

  async function handleSave() {
    if (schoolId == null) { setMessage({ text: 'يجب اختيار المدرسة المستهدفة أولاً', type: 'error' }); return; }
    const maxGrade = Number(form.max_grade);
    const passingGrade = Number(form.passing_grade);
    const exemptionGrade = Number(form.exemption_grade);
    const generalAvg = Number(form.general_exemption_average_grade);
    const generalMin = Number(form.general_exemption_min_subject_grade);

    if ([maxGrade, passingGrade, exemptionGrade, generalAvg, generalMin].some((n) => isNaN(n))) {
      setMessage({ text: 'جميع القيم يجب أن تكون أرقامًا صالحة', type: 'error' });
      return;
    }
    if (maxGrade <= 0) { setMessage({ text: 'الدرجة العظمى يجب أن تكون أكبر من ٠', type: 'error' }); return; }
    if (passingGrade < 0 || passingGrade > maxGrade) { setMessage({ text: 'درجة النجاح يجب أن تكون بين ٠ والدرجة العظمى', type: 'error' }); return; }
    if (exemptionGrade < passingGrade) { setMessage({ text: 'درجة الإعفاء يجب أن تكون ≥ درجة النجاح', type: 'error' }); return; }
    if (exemptionGrade > maxGrade) { setMessage({ text: 'درجة الإعفاء يجب أن تكون ≤ الدرجة العظمى', type: 'error' }); return; }
    if (generalAvg < passingGrade) { setMessage({ text: 'متوسط الإعفاء العام يجب أن يكون ≥ درجة النجاح', type: 'error' }); return; }
    if (generalAvg > maxGrade) { setMessage({ text: 'متوسط الإعفاء العام يجب أن يكون ≤ الدرجة العظمى', type: 'error' }); return; }
    if (generalMin < passingGrade) { setMessage({ text: 'أدنى درجة للإعفاء العام يجب أن تكون ≥ درجة النجاح', type: 'error' }); return; }
    if (generalMin > generalAvg) { setMessage({ text: 'أدنى درجة للإعفاء العام يجب أن تكون ≤ متوسط الإعفاء العام', type: 'error' }); return; }
    const schemeError = validateGradeSchemeSettings(form);
    if (schemeError) { setMessage({ text: schemeError, type: 'error' }); return; }

    setSaving(true);
    const isCurrent = captureSchoolRequest();
    const payload: Record<string, any> = {
      max_grade: maxGrade,
      passing_grade: passingGrade,
      exemption_grade: exemptionGrade,
      general_exemption_average_grade: generalAvg,
      general_exemption_min_subject_grade: generalMin,
      first_term_input_mode: form.first_term_input_mode,
      second_term_input_mode: form.second_term_input_mode,
      mid_year_exam_enabled: form.mid_year_exam_enabled,
      final_exam_enabled: form.final_exam_enabled,
      completion_exam_enabled: form.completion_exam_enabled,
    };
    const res = await updateGradeSettings(payload, schoolId);
    if (!isCurrent()) return;
    setSaving(false);
    if (res.error) {
      setMessage({ text: res.error, type: 'error' });
    } else {
      const apiMessage = (res.data as any)?.message || 'تم حفظ إعدادات الدرجات بنجاح';
      setMessage({ text: apiMessage, type: 'success' });
      const data = Array.isArray(res.data) ? res.data[0] : res.data;
      if (data) setSettings({ ...data, ...normalizeGradeSchemeSettings(data) } as GradeSettings);
    }
    setTimeout(() => setMessage(null), 4000);
  }

  return (
    <div className="space-y-4">
      {message && (
        <div className={`flex items-center gap-2 p-3 rounded-lg ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span className="text-sm">{message.text}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={28} className="animate-spin text-primary-600" />
          <span className="mr-2 text-sm text-gray-500">جاري التحميل...</span>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6 max-w-2xl">
          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">إعدادات الدرجات</h3>
            <p className="text-sm text-gray-500">تُستخدم هذه القيم لحساب النتائج والإعفاءات</p>
          </div>

          <div className="rounded-lg border border-primary-100 bg-primary-50/40 p-4 space-y-4">
            <div>
              <h4 className="text-sm font-bold text-gray-900">نظام إدخال الدرجات</h4>
              <p className="text-xs text-gray-500 mt-1">اختر المكونات التي تعتمدها المدرسة. لا تُحتسب المكونات المعطّلة.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(['first_term_input_mode', 'second_term_input_mode'] as const).map((key, index) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">إدخال الفصل {index === 0 ? 'الأول' : 'الثاني'}</label>
                  <select
                    value={form[key]}
                    disabled={!canEdit}
                    onChange={(event) => setForm(current => ({ ...current, [key]: event.target.value as GradeTermInputMode }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white disabled:bg-gray-100"
                  >
                    <option value="monthly">شهري: الشهر {index === 0 ? 'الأول + الشهر الثاني' : 'الثالث + الشهر الرابع'}</option>
                    <option value="direct">درجة فصل مباشرة</option>
                    <option value="disabled">غير مستخدم</option>
                  </select>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {([
                ['mid_year_exam_enabled', 'امتحان نصف السنة'],
                ['final_exam_enabled', 'امتحان نهاية السنة'],
                ['completion_exam_enabled', 'امتحان الإكمال'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form[key] === 1}
                    disabled={!canEdit}
                    onChange={(event) => setForm(current => ({ ...current, [key]: event.target.checked ? 1 : 0 }))}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className="text-xs text-primary-800 leading-6"><strong>الملخص:</strong> {gradeSchemeSummary(form)}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">الدرجة العظمى</label>
              <input type="number" value={form.max_grade} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, max_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">درجة النجاح</label>
              <input type="number" value={form.passing_grade} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, passing_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">درجة الإعفاء الفردي (المادة)</label>
              <input type="number" value={form.exemption_grade} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, exemption_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-500" />
              <p className="text-xs text-gray-500 mt-1">إذا كان السعي السنوي ≥ هذه القيمة ⇒ معفى فرديًا</p>
            </div>
            <div />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">متوسط الإعفاء العام</label>
              <input type="number" value={form.general_exemption_average_grade} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, general_exemption_average_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-500" />
              <p className="text-xs text-gray-500 mt-1">متوسط السعي السنوي لجميع المواد يجب أن يكون ≥ هذه القيمة</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">أدنى درجة للإعفاء العام (لكل مادة)</label>
              <input type="number" value={form.general_exemption_min_subject_grade} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, general_exemption_min_subject_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-500" />
              <p className="text-xs text-gray-500 mt-1">أدنى سعي سنوي بين جميع المواد يجب أن يكون ≥ هذه القيمة</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-2">
            {!canEdit && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 text-sm">
                <AlertCircle size={16} />
                <span>ليس لديك صلاحية تعديل الإعدادات. يمكنك فقط الاطلاع على القيم.</span>
              </div>
            )}
            {canEdit && schoolId != null && (
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-5 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 w-fit">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                حفظ الإعدادات
              </button>
            )}
          </div>

          {settings && (
            <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-600 space-y-1">
              <p><strong>الحالي:</strong> الدرجة العظمى = {toArabicDigits(String(settings.max_grade))} | النجاح = {toArabicDigits(String(settings.passing_grade))} | الإعفاء الفردي = {toArabicDigits(String(settings.exemption_grade))}</p>
              <p>الإعفاء العام: متوسط ≥ {toArabicDigits(String(settings.general_exemption_average_grade))} | أدنى مادة ≥ {toArabicDigits(String(settings.general_exemption_min_subject_grade))}</p>
              <p>{gradeSchemeSummary(settings)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   Tab 4: سجل تعديل الدرجات
   ═══════════════════════════════════════ */
function HistoryTab({ schoolId }: { schoolId: number | null }) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [grades, setGrades] = useState<GradeRecord[]>([]);
  const [selectedGradeId, setSelectedGradeId] = useState<number | null>(null);
  const [history, setHistory] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setStudents([]);
    setSelectedStudentId('');
    setGrades([]);
    setSelectedGradeId(null);
    setHistory([]);
    setLoading(false);
    void loadStudents();
  }, [schoolId]);

  async function loadStudents() {
    if (schoolId == null) { setStudents([]); return; }
    const isCurrent = captureSchoolRequest();
    const res = await getStudents(schoolId, null, null);
    if (!isCurrent()) return;
    if (res.data) setStudents(res.data as StudentRecord[]);
  }

  async function loadGrades(studentId: string) {
    if (!studentId) return;
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    const res = await getStudentGrades(studentId);
    if (!isCurrent()) return;
    if (res.data) setGrades((res.data.grades || []) as GradeRecord[]);
    setLoading(false);
  }

  async function loadHistory(gradeId: number) {
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    const res = await getGradeHistory(gradeId);
    if (!isCurrent()) return;
    if (res.data) setHistory((res.data || []) as AuditRecord[]);
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-medium text-gray-700 mb-1">اختيار الطالب</label>
          <select
            value={selectedStudentId}
            onChange={(e) => { setSelectedStudentId(e.target.value); setGrades([]); loadGrades(e.target.value); setHistory([]); setSelectedGradeId(null); }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white"
          >
            <option value="">— اختر طالب —</option>
            {students.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.full_name} ({toArabicDigits(s.student_number)})
              </option>
            ))}
          </select>
        </div>
      </div>

      {grades.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {grades.map((g) => (
            <button
              key={g.id}
              onClick={() => { setSelectedGradeId(g.id); setHistory([]); loadHistory(g.id); }}
              className={`text-right p-3 rounded-lg border transition-colors ${selectedGradeId === g.id ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:bg-gray-50'}`}
            >
              <p className="font-medium text-sm text-gray-900">{g.subject_name}</p>
              <p className="text-xs text-gray-500 mt-1">السعي السنوي: {displayNum(g.annual_effort)} | الحالة: {displayGradeStatus(g.result_status, g.exemption_status) || '—'}</p>
            </button>
          ))}
        </div>
      )}

      {selectedGradeId && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-900">سجل التعديلات</h3>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-primary-600" />
            </div>
          ) : history.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">لا توجد تعديلات مسجلة</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-600 text-xs">
                    <th className="px-3 py-2 text-right font-medium border-b border-gray-200">الحقل</th>
                    <th className="px-3 py-2 text-center font-medium border-b border-gray-200">القيمة القديمة</th>
                    <th className="px-3 py-2 text-center font-medium border-b border-gray-200">القيمة الجديدة</th>
                    <th className="px-3 py-2 text-center font-medium border-b border-gray-200">المُعدِّل</th>
                    <th className="px-3 py-2 text-center font-medium border-b border-gray-200">التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 border-b border-gray-100 font-medium text-gray-900">{fieldLabel(h.field_name)}</td>
                      <td className="px-3 py-2 border-b border-gray-100 text-center text-gray-500">{h.old_value ?? '—'}</td>
                      <td className="px-3 py-2 border-b border-gray-100 text-center text-gray-900 font-medium">{h.new_value ?? '—'}</td>
                      <td className="px-3 py-2 border-b border-gray-100 text-center text-gray-600">{h.changed_by_name ?? '—'}</td>
                      <td className="px-3 py-2 border-b border-gray-100 text-center text-gray-500 text-xs">{new Date((Number(h.created_at) || 0) * 1000).toLocaleString('ar-SY')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function fieldLabel(name: string): string {
  const map: Record<string, string> = {
    ...RAW_GRADE_FIELD_LABELS,
    notes: 'ملاحظات',
  };
  return map[name] || name;
}
