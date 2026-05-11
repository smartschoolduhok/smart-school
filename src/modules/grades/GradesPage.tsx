import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  getGrades, getStudentGrades, initializeStudentGrades, initializeSectionGrades,
  updateGrade, bulkUpdateGrades, getGradeHistory, getGradeSettings, updateGradeSettings,
  getStudents, getClasses, getSections, getSubjects, getSchools
} from '../../lib/api';
import { toArabicDigits } from '../../lib/arabicDigits';
import {
  Calculator, Save, Loader2, AlertCircle, CheckCircle, Search, User, Users,
  Settings, History, BookOpen, ChevronDown, ChevronUp
} from 'lucide-react';

/* ─── Shared helpers ─── */
function displayNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return toArabicDigits(String(n));
}

/* ─── Types ─── */
interface GradeRecord {
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

interface GradeSettings {
  id?: number;
  school_id: number;
  max_grade: number;
  passing_grade: number;
  exemption_grade: number;
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

const TAB_CONFIG: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'student', label: 'إدخال درجات طالب', icon: <User size={18} /> },
  { key: 'section', label: 'إدخال درجات شعبة', icon: <Users size={18} /> },
  { key: 'settings', label: 'إعدادات الدرجات', icon: <Settings size={18} /> },
  { key: 'history', label: 'سجل تعديل الدرجات', icon: <History size={18} /> },
];

export default function GradesPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('student');

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

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {TAB_CONFIG.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'student' && <StudentGradesTab />}
      {activeTab === 'section' && <SectionGradesTab />}
      {activeTab === 'settings' && <SettingsTab />}
      {activeTab === 'history' && <HistoryTab />}
    </div>
  );
}

/* ═══════════════════════════════════════
   Tab 1: إدخال درجات طالب
   ═══════════════════════════════════════ */
function StudentGradesTab() {
  const { user } = useAuth();
  const schoolId = user?.school_id;
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [grades, setGrades] = useState<GradeRecord[]>([]);
  const [settings, setSettings] = useState<GradeSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState<Record<number, boolean>>({});
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [studentName, setStudentName] = useState('');

  useEffect(() => { loadStudents(); }, [schoolId]);

  async function loadStudents() {
    const res = await getStudents(schoolId ?? null, null, null);
    if (res.data) setStudents(res.data as StudentRecord[]);
  }

  async function loadStudentGrades(studentId: string) {
    if (!studentId) return;
    setLoading(true);
    const res = await getStudentGrades(studentId);
    if (res.data) {
      setGrades((res.data.grades || []) as GradeRecord[]);
      setSettings((res.data.settings || null) as GradeSettings | null);
      setStudentName(res.data.student_name || '');
    }
    setLoading(false);
  }

  async function handleInit() {
    if (!selectedStudentId) { setMessage({ text: 'يرجى اختيار طالب أولاً', type: 'error' }); return; }
    setInitLoading(true);
    const res = await initializeStudentGrades(selectedStudentId);
    setInitLoading(false);
    if (res.error) {
      setMessage({ text: res.error, type: 'error' });
    } else {
      setMessage({ text: `تمت تهيئة درجات الطالب بنجاح (تم إنشاء ${toArabicDigits(String(res.data?.created || 0))} وتخطي ${toArabicDigits(String(res.data?.skipped || 0))})`, type: 'success' });
      await loadStudentGrades(selectedStudentId);
    }
    setTimeout(() => setMessage(null), 4000);
  }

  async function handleSaveGrade(grade: GradeRecord, field: string, value: string) {
    const num = value === '' ? null : Number(value);
    if (value !== '' && (num === null || isNaN(num))) {
      setMessage({ text: `القيمة في حقل ${fieldNameArabic(field)} ليست رقمًا صحيحًا`, type: 'error' });
      setTimeout(() => setMessage(null), 3000);
      return;
    }
    if (num !== null && settings && (num < 0 || num > settings.max_grade)) {
      setMessage({ text: `القيمة يجب أن تكون بين ٠ و ${toArabicDigits(String(settings.max_grade))}`, type: 'error' });
      setTimeout(() => setMessage(null), 3000);
      return;
    }

    setSaveLoading((prev) => ({ ...prev, [grade.id]: true }));
    const payload: Record<string, any> = { [field]: num };
    const res = await updateGrade(grade.id, payload);
    setSaveLoading((prev) => ({ ...prev, [grade.id]: false }));

    if (res.error) {
      setMessage({ text: res.error, type: 'error' });
    } else {
      await loadStudentGrades(selectedStudentId);
      setMessage({ text: 'تم حفظ الدرجة بنجاح — اضغط Enter أو انقر خارج الحقل لحفظ القيمة', type: 'success' });
    }
    setTimeout(() => setMessage(null), 3000);
  }

  function fieldNameArabic(field: string): string {
    const map: Record<string, string> = {
      first_month: 'الشهر الأول',
      second_month: 'الشهر الثاني',
      third_month: 'الشهر الثالث',
      fourth_month: 'الشهر الرابع',
      mid_year_exam: 'نصف السنة',
      final_exam: 'الامتحان النهائي',
      completion_exam: 'درجة الإكمال',
      notes: 'ملاحظات',
    };
    return map[field] || field;
  }

  function statusBadge(status: string | null) {
    if (!status) return <span className="text-gray-400">—</span>;
    const cls =
      status === 'ناجح' ? 'bg-emerald-100 text-emerald-700' :
      status === 'راسب' ? 'bg-red-100 text-red-700' :
      status === 'مكمل' ? 'bg-amber-100 text-amber-700' :
      status === 'معفى' ? 'bg-blue-100 text-blue-700' :
      'bg-gray-100 text-gray-700';
    return <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${cls}`}>{status}</span>;
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
                  <th rowSpan={2} className="px-3 py-2 text-right font-medium border-b border-gray-200 align-middle">المادة</th>
                  <th colSpan={3} className="px-2 py-1 text-center font-medium border-b border-gray-200 border-l border-gray-200 bg-blue-50/40">الفصل الأول</th>
                  <th colSpan={3} className="px-2 py-1 text-center font-medium border-b border-gray-200 border-l border-gray-200 bg-emerald-50/40">الفصل الثاني</th>
                  <th colSpan={3} className="px-2 py-1 text-center font-medium border-b border-gray-200 border-l border-gray-200 bg-amber-50/40">السنوي</th>
                  <th colSpan={2} className="px-2 py-1 text-center font-medium border-b border-gray-200 border-l border-gray-200 bg-rose-50/40">النهائي</th>
                  <th rowSpan={2} className="px-2 py-2 text-center font-medium border-b border-gray-200 w-20 align-middle">الحالة</th>
                  <th rowSpan={2} className="px-2 py-2 text-center font-medium border-b border-gray-200 w-20 align-middle">ملاحظات</th>
                </tr>
                <tr className="bg-gray-50 text-gray-500 text-[10px]">
                  {/* First term sub-columns */}
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">الشهر ١</th>
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">الشهر ٢</th>
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">نصف السنة</th>
                  {/* Second term sub-columns */}
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">الشهر ٣</th>
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">الشهر ٤</th>
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">معدل الفصل</th>
                  {/* Annual sub-columns */}
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">السعي</th>
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">النهائي</th>
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">الدرجة</th>
                  {/* Final sub-columns */}
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">الإكمال</th>
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">الفعّالة</th>
                </tr>
              </thead>
              <tbody>
                {grades.map((g) => (
                  <tr key={g.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 border-b border-gray-100 font-medium text-gray-900">{g.subject_name}</td>
                    {/* First term: editable */}
                    {(['first_month','second_month','mid_year_exam'] as const).map((field) => (
                      <td key={field} className="px-1 py-1 border-b border-gray-100">
                        <input
                          type="text"
                          inputMode="numeric"
                          defaultValue={displayNum(g[field] as any)}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            const current = g[field] === null ? '' : toArabicDigits(String(g[field]));
                            if (val !== current) handleSaveGrade(g, field, val);
                          }}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          className="w-full px-1.5 py-1 text-center text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                          placeholder="—"
                        />
                      </td>
                    ))}
                    {/* Second term: editable */}
                    {(['third_month','fourth_month'] as const).map((field) => (
                      <td key={field} className="px-1 py-1 border-b border-gray-100">
                        <input
                          type="text"
                          inputMode="numeric"
                          defaultValue={displayNum(g[field] as any)}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            const current = g[field] === null ? '' : toArabicDigits(String(g[field]));
                            if (val !== current) handleSaveGrade(g, field, val);
                          }}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          className="w-full px-1.5 py-1 text-center text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                          placeholder="—"
                        />
                      </td>
                    ))}
                    {/* Second term average: read-only */}
                    <td className="px-1 py-1 border-b border-gray-100 text-center text-gray-600 font-medium bg-gray-50/50">{displayNum(g.second_term_average)}</td>
                    {/* Annual: read-only effort */}
                    <td className="px-1 py-1 border-b border-gray-100 text-center text-gray-700 font-semibold bg-amber-50/30">{displayNum(g.annual_effort)}</td>
                    {/* Final exam: editable */}
                    <td className="px-1 py-1 border-b border-gray-100">
                      <input
                        type="text"
                        inputMode="numeric"
                        defaultValue={displayNum(g.final_exam as any)}
                        onBlur={(e) => {
                          const val = e.target.value.trim();
                          const current = g.final_exam === null ? '' : toArabicDigits(String(g.final_exam));
                          if (val !== current) handleSaveGrade(g, 'final_exam', val);
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className="w-full px-1.5 py-1 text-center text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                        placeholder="—"
                      />
                    </td>
                    {/* Final grade: read-only */}
                    <td className="px-1 py-1 border-b border-gray-100 text-center text-gray-700 font-semibold bg-amber-50/30">{displayNum(g.final_grade)}</td>
                    {/* Completion exam: editable */}
                    <td className="px-1 py-1 border-b border-gray-100">
                      <input
                        type="text"
                        inputMode="numeric"
                        defaultValue={displayNum(g.completion_exam as any)}
                        onBlur={(e) => {
                          const val = e.target.value.trim();
                          const current = g.completion_exam === null ? '' : toArabicDigits(String(g.completion_exam));
                          if (val !== current) handleSaveGrade(g, 'completion_exam', val);
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className="w-full px-1.5 py-1 text-center text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                        placeholder="—"
                      />
                    </td>
                    {/* Effective grade: read-only (same as completion or final) */}
                    <td className="px-1 py-1 border-b border-gray-100 text-center text-gray-700 font-semibold bg-rose-50/30">{displayNum(g.effective_grade ?? g.final_grade)}</td>
                    {/* Status */}
                    <td className="px-2 py-2 border-b border-gray-100 text-center">{statusBadge(g.result_status)}</td>
                    {/* Notes */}
                    <td className="px-1 py-1 border-b border-gray-100">
                      <input
                        type="text"
                        defaultValue={g.notes || ''}
                        onBlur={(e) => {
                          const val = e.target.value.trim();
                          if (val !== (g.notes || '')) handleSaveGrade(g, 'notes', val);
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
            <p className="flex flex-wrap gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block"></span> الفصل الأول: الشهر ١ + الشهر ٢ + نصف السنة</span>
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span> الفصل الثاني: الشهر ٣ + الشهر ٤</span>
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span> السعي السنوي = معدل الفصل الأول + معدل الفصل الثاني</span>
            </p>
            <p className="flex flex-wrap gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400 inline-block"></span> الدرجة الفعّالة = النهائي (أو الإكمال إذا أقل من النجاح)</span>
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block"></span> الحقول الرمادية تُحسب تلقائيًا</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   Tab 2: إدخال درجات شعبة
   ═══════════════════════════════════════ */
function SectionGradesTab() {
  const { user } = useAuth();
  const schoolId = user?.school_id;
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [sections, setSections] = useState<SectionRecord[]>([]);
  const [subjects, setSubjects] = useState<SubjectRecord[]>([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [grades, setGrades] = useState<GradeRecord[]>([]);
  const [fieldToEdit, setFieldToEdit] = useState<string>('first_month');
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const editableFields = [
    { key: 'first_month', label: 'الشهر الأول' },
    { key: 'second_month', label: 'الشهر الثاني' },
    { key: 'mid_year_exam', label: 'نصف السنة' },
    { key: 'third_month', label: 'الشهر الثالث' },
    { key: 'fourth_month', label: 'الشهر الرابع' },
    { key: 'final_exam', label: 'الامتحان النهائي' },
    { key: 'completion_exam', label: 'درجة الإكمال' },
  ];

  useEffect(() => { loadClasses(); loadSubjects(); }, [schoolId]);
  useEffect(() => {
    if (selectedClassId) loadSections(selectedClassId);
    else { setSections([]); setSelectedSectionId(''); }
  }, [selectedClassId]);

  async function loadClasses() {
    const res = await getClasses(schoolId ?? null);
    if (res.data) setClasses(res.data as ClassRecord[]);
  }
  async function loadSections(classId: string) {
    const res = await getSections(schoolId ?? null, Number(classId));
    if (res.data) setSections(res.data as SectionRecord[]);
  }
  async function loadSubjects() {
    const res = await getSubjects(schoolId ?? null, null, null);
    if (res.data) setSubjects(res.data as SubjectRecord[]);
  }

  async function loadGrades() {
    if (!selectedSectionId || !selectedSubjectId) return;
    setLoading(true);
    const res = await getGrades({
      section_id: Number(selectedSectionId),
      subject_id: Number(selectedSubjectId),
      is_active: true,
    });
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
    setInitLoading(true);
    const res = await initializeSectionGrades({
      section_id: Number(selectedSectionId),
      subject_ids: [Number(selectedSubjectId)],
    });
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
    setSaveLoading(true);
    const entries = Object.entries(edits)
      .filter(([, v]) => v !== '')
      .map(([gradeId, value]) => ({
        grade_id: Number(gradeId),
        [fieldToEdit]: value,
      }));
    const res = await bulkUpdateGrades(entries);
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
          <select value={fieldToEdit} onChange={(e) => setFieldToEdit(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
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
            <button onClick={handleBulkSave} disabled={saveLoading || Object.keys(edits).filter((k) => edits[Number(k)] !== '').length === 0} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
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
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          g.result_status === 'ناجح' ? 'bg-emerald-100 text-emerald-700' :
                          g.result_status === 'راسب' ? 'bg-red-100 text-red-700' :
                          g.result_status === 'مكمل' ? 'bg-amber-100 text-amber-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {g.result_status || '—'}
                        </span>
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
function SettingsTab() {
  const { user } = useAuth();
  const isAdmin = user?.role_key === 'system_admin';
  const isTeacher = user?.role_key === 'teacher';
  const canEdit = isAdmin || ['school_owner', 'principal', 'vice_principal'].includes(user?.role_key || '');
  const jwtSchoolId = user?.school_id;
  const [selectedSchoolId, setSelectedSchoolId] = useState<number | null>(jwtSchoolId ?? null);
  const [schools, setSchools] = useState<Array<Record<string, any>>>([]);
  const [settings, setSettings] = useState<GradeSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const [form, setForm] = useState({
    max_grade: '100',
    passing_grade: '50',
    exemption_grade: '90',
    general_exemption_average_grade: '85',
    general_exemption_min_subject_grade: '75',
  });

  useEffect(() => {
    if (isAdmin) {
      getSchools().then((res) => { if (res.data) setSchools(res.data as any); });
    }
  }, [isAdmin]);

  useEffect(() => {
    loadSettings();
  }, [selectedSchoolId, jwtSchoolId]);

  async function loadSettings() {
    setLoading(true);
    const schoolIdForApi = isAdmin ? selectedSchoolId : jwtSchoolId;
    const res = await getGradeSettings(schoolIdForApi ?? null);
    setLoading(false);
    if (res.error) {
      setMessage({ text: res.error, type: 'error' });
      return;
    }
    const data = Array.isArray(res.data) ? res.data[0] : res.data;
    if (data) {
      setSettings(data as GradeSettings);
      setForm({
        max_grade: String(data.max_grade ?? 100),
        passing_grade: String(data.passing_grade ?? 50),
        exemption_grade: String(data.exemption_grade ?? 90),
        general_exemption_average_grade: String(data.general_exemption_average_grade ?? 85),
        general_exemption_min_subject_grade: String(data.general_exemption_min_subject_grade ?? 75),
      });
    }
  }

  async function handleSave() {
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

    setSaving(true);
    const payload: Record<string, any> = {
      max_grade: maxGrade,
      passing_grade: passingGrade,
      exemption_grade: exemptionGrade,
      general_exemption_average_grade: generalAvg,
      general_exemption_min_subject_grade: generalMin,
    };
    const schoolIdForApi = isAdmin ? selectedSchoolId : jwtSchoolId;
    const res = await updateGradeSettings(payload, schoolIdForApi ?? null);
    setSaving(false);
    if (res.error) {
      setMessage({ text: res.error, type: 'error' });
    } else {
      setMessage({ text: 'تم حفظ إعدادات الدرجات بنجاح', type: 'success' });
      const data = Array.isArray(res.data) ? res.data[0] : res.data;
      if (data) setSettings(data as GradeSettings);
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">الدرجة العظمى</label>
              <input type="number" value={form.max_grade} disabled={isTeacher} onChange={(e) => setForm((f) => ({ ...f, max_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">درجة النجاح</label>
              <input type="number" value={form.passing_grade} disabled={isTeacher} onChange={(e) => setForm((f) => ({ ...f, passing_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">درجة الإعفاء الفردي (المادة)</label>
              <input type="number" value={form.exemption_grade} disabled={isTeacher} onChange={(e) => setForm((f) => ({ ...f, exemption_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-500" />
              <p className="text-xs text-gray-500 mt-1">إذا كان السعي السنوي ≥ هذه القيمة ⇒ معفى فرديًا</p>
            </div>
            <div />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">متوسط الإعفاء العام</label>
              <input type="number" value={form.general_exemption_average_grade} disabled={isTeacher} onChange={(e) => setForm((f) => ({ ...f, general_exemption_average_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-500" />
              <p className="text-xs text-gray-500 mt-1">متوسط السعي السنوي لجميع المواد يجب أن يكون ≥ هذه القيمة</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">أدنى درجة للإعفاء العام (لكل مادة)</label>
              <input type="number" value={form.general_exemption_min_subject_grade} disabled={isTeacher} onChange={(e) => setForm((f) => ({ ...f, general_exemption_min_subject_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-500" />
              <p className="text-xs text-gray-500 mt-1">أدنى سعي سنوي بين جميع المواد يجب أن يكون ≥ هذه القيمة</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-2">
            {isAdmin && (
              <div className="w-full max-w-sm">
                <label className="block text-sm font-medium text-gray-700 mb-1">اختيار المدرسة</label>
                <select
                  value={selectedSchoolId ?? ''}
                  onChange={(e) => setSelectedSchoolId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white"
                >
                  <option value="">— اختر مدرسة —</option>
                  {schools.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
            {isTeacher && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 text-sm">
                <AlertCircle size={16} />
                <span>ليس لديك صلاحية تعديل الإعدادات. يمكنك فقط الاطلاع على القيم.</span>
              </div>
            )}
            {canEdit && (
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
function HistoryTab() {
  const { user } = useAuth();
  const schoolId = user?.school_id;
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [grades, setGrades] = useState<GradeRecord[]>([]);
  const [selectedGradeId, setSelectedGradeId] = useState<number | null>(null);
  const [history, setHistory] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadStudents(); }, [schoolId]);

  async function loadStudents() {
    const res = await getStudents(schoolId ?? null, null, null);
    if (res.data) setStudents(res.data as StudentRecord[]);
  }

  async function loadGrades(studentId: string) {
    if (!studentId) return;
    setLoading(true);
    const res = await getStudentGrades(studentId);
    if (res.data) setGrades((res.data.grades || []) as GradeRecord[]);
    setLoading(false);
  }

  async function loadHistory(gradeId: number) {
    setLoading(true);
    const res = await getGradeHistory(gradeId);
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
            onChange={(e) => { setSelectedStudentId(e.target.value); loadGrades(e.target.value); setHistory([]); setSelectedGradeId(null); }}
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
              onClick={() => { setSelectedGradeId(g.id); loadHistory(g.id); }}
              className={`text-right p-3 rounded-lg border transition-colors ${selectedGradeId === g.id ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:bg-gray-50'}`}
            >
              <p className="font-medium text-sm text-gray-900">{g.subject_name}</p>
              <p className="text-xs text-gray-500 mt-1">السعي السنوي: {displayNum(g.annual_effort)} | الحالة: {g.result_status || '—'}</p>
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
    first_month: 'الشهر الأول',
    second_month: 'الشهر الثاني',
    third_month: 'الشهر الثالث',
    fourth_month: 'الشهر الرابع',
    mid_year_exam: 'نصف السنة',
    final_exam: 'الامتحان النهائي',
    completion_exam: 'درجة الإكمال',
    notes: 'ملاحظات',
  };
  return map[name] || name;
}
