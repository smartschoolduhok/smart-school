// ===========================================
// Analytics Page - Phase 5
// RTL Arabic dashboard with 8 analytics tabs
// ===========================================

import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  GraduationCap,
  Users,
  BookOpen,
  AlertTriangle,
  TrendingUp,
  ShieldAlert,
  UserCircle,
} from 'lucide-react';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import {
  getAnalyticsOverview,
  getAnalyticsByClass,
  getAnalyticsBySection,
  getAnalyticsBySubject,
  getStudentsCloseToPassing,
  getStudentsCloseToExemption,
  getExemptionBlockers,
  getStudentSummary,
  getClasses,
  getSections,
  getSubjects,
  getStudents,
} from '../../lib/api';
import { toArabicDigits } from '../../lib/arabicDigits';
import { displayGradeStatus } from '../../lib/gradePresentation';

// ---- Types ----
type TabKey =
  | 'overview'
  | 'by-class'
  | 'by-section'
  | 'by-subject'
  | 'close-passing'
  | 'close-exemption'
  | 'exemption-blockers'
  | 'student-summary';

interface TabDef {
  key: TabKey;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabDef[] = [
  { key: 'overview', label: 'نظرة عامة', icon: <LayoutDashboard size={18} /> },
  { key: 'by-class', label: 'تحليل حسب الصف', icon: <GraduationCap size={18} /> },
  { key: 'by-section', label: 'تحليل حسب الشعبة', icon: <Users size={18} /> },
  { key: 'by-subject', label: 'تحليل حسب المادة', icon: <BookOpen size={18} /> },
  { key: 'close-passing', label: 'القريبون من النجاح', icon: <TrendingUp size={18} /> },
  { key: 'close-exemption', label: 'القريبون من الإعفاء', icon: <ShieldAlert size={18} /> },
  { key: 'exemption-blockers', label: 'المواد التي منعت الإعفاء', icon: <AlertTriangle size={18} /> },
  { key: 'student-summary', label: 'ملخص الطالب', icon: <UserCircle size={18} /> },
];

interface FilterState {
  schoolId: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  studentId: string;
}

// ---- Helpers ----
function pctColor(pct: number): string {
  if (pct >= 80) return 'text-emerald-600 bg-emerald-50';
  if (pct >= 60) return 'text-amber-600 bg-amber-50';
  if (pct >= 40) return 'text-orange-600 bg-orange-50';
  return 'text-red-600 bg-red-50';
}

function statusBadge(status: string | null): string {
  if (!status) return 'bg-gray-100 text-gray-700';
  switch (status) {
    case 'ناجح':
      return 'bg-emerald-100 text-emerald-700';
    case 'مكمل':
      return 'bg-amber-100 text-amber-700';
    case 'راسب':
      return 'bg-red-100 text-red-700';
    case 'معفو':
      return 'bg-indigo-100 text-indigo-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

function statusIcon(status: string | null): string {
  switch (status) {
    case 'ناجح':
      return '✅';
    case 'مكمل':
      return '⚠️';
    case 'راسب':
      return '❌';
    case 'معفو':
      return '⭐';
    default:
      return '—';
  }
}

// ---- Component ----
export default function AnalyticsPage() {
  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);

  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [filters, setFilters] = useState<FilterState>({
    schoolId: '',
    classId: '',
    sectionId: '',
    subjectId: '',
    studentId: '',
  });

  // Dropdown data
  const [classes, setClasses] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);

  // Tab data
  const [overviewData, setOverviewData] = useState<any>(null);
  const [byClassData, setByClassData] = useState<any[]>([]);
  const [bySectionData, setBySectionData] = useState<any[]>([]);
  const [bySubjectData, setBySubjectData] = useState<any[]>([]);
  const [closePassingData, setClosePassingData] = useState<any[]>([]);
  const [closeExemptionData, setCloseExemptionData] = useState<any[]>([]);
  const [blockersData, setBlockersData] = useState<any[]>([]);
  const [studentSummaryData, setStudentSummaryData] = useState<any>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load filter dropdowns
  useEffect(() => {
    setClasses([]); setSections([]); setSubjects([]); setStudents([]);
    setOverviewData(null);
    setByClassData([]); setBySectionData([]); setBySubjectData([]);
    setClosePassingData([]); setCloseExemptionData([]); setBlockersData([]);
    setStudentSummaryData(null);
    setLoading(false);
    setError(null);
    async function loadDropdowns() {
      if (schoolId == null) {
        setClasses([]); setSections([]); setSubjects([]); setStudents([]);
        return;
      }
      const isCurrent = captureSchoolRequest();
      const [clsRes, secRes, subRes, stuRes] = await Promise.all([
        getClasses(schoolId),
        getSections(schoolId),
        getSubjects(schoolId),
        getStudents(schoolId),
      ]);
      if (!isCurrent()) return;
      setClasses(clsRes.data || []);
      setSections(secRes.data || []);
      setSubjects(subRes.data || []);
      setStudents(stuRes.data || []);
    }
    setFilters({ schoolId: '', classId: '', sectionId: '', subjectId: '', studentId: '' });
    loadDropdowns();
  }, [schoolId]);

  // Build query params from filters
  const buildQueryParams = useCallback(() => {
    const params: Record<string, number | null> = {};
    if (schoolId != null) params.school_id = schoolId;
    if (filters.classId) params.class_id = Number(filters.classId);
    if (filters.sectionId) params.section_id = Number(filters.sectionId);
    if (filters.subjectId) params.subject_id = Number(filters.subjectId);
    return params;
  }, [filters, schoolId]);

  // Fetch data when tab or filters change
  useEffect(() => {
    const params = buildQueryParams();
    let cancelled = false;

    async function fetchData() {
      if (schoolId == null) {
        setLoading(false);
        return;
      }
      const isCurrent = captureSchoolRequest();
      setLoading(true);
      setError(null);
      try {
        switch (activeTab) {
          case 'overview': {
            const res = await getAnalyticsOverview(params);
            if (!cancelled && isCurrent()) setOverviewData(res.data ?? res);
            break;
          }
          case 'by-class': {
            const res = await getAnalyticsByClass(params);
            if (!cancelled && isCurrent()) setByClassData(res.data || []);
            break;
          }
          case 'by-section': {
            const res = await getAnalyticsBySection(params);
            if (!cancelled && isCurrent()) setBySectionData(res.data || []);
            break;
          }
          case 'by-subject': {
            const res = await getAnalyticsBySubject(params);
            if (!cancelled && isCurrent()) setBySubjectData(res.data || []);
            break;
          }
          case 'close-passing': {
            const res = await getStudentsCloseToPassing(params);
            if (!cancelled && isCurrent()) setClosePassingData(res.data || []);
            break;
          }
          case 'close-exemption': {
            const res = await getStudentsCloseToExemption(params);
            if (!cancelled && isCurrent()) setCloseExemptionData(res.data || []);
            break;
          }
          case 'exemption-blockers': {
            const res = await getExemptionBlockers(params);
            if (!cancelled && isCurrent()) setBlockersData(res.data || []);
            break;
          }
          case 'student-summary': {
            if (filters.studentId) {
              const res = await getStudentSummary(Number(filters.studentId));
              if (!cancelled && isCurrent()) setStudentSummaryData(res.data ?? res);
            } else {
              if (!cancelled && isCurrent()) setStudentSummaryData(null);
            }
            break;
          }
        }
      } catch (err: any) {
        if (!cancelled && isCurrent()) setError(err?.error || 'حدث خطأ أثناء جلب البيانات');
      } finally {
        if (!cancelled && isCurrent()) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [activeTab, buildQueryParams, filters.studentId]);

  // ---- UI Helpers ----
  function FilterSelect({
    label,
    value,
    onChange,
    options,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: { id: number; name: string }[];
  }) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500">{label}</label>
        <select
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">الكل</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  function Card({
    title,
    value,
    suffix,
    colorClass,
  }: {
    title: string;
    value: number | string;
    suffix?: string;
    colorClass?: string;
  }) {
    return (
      <div className={`rounded-xl border border-gray-200 p-4 ${colorClass || 'bg-white'}`}>
        <p className="text-xs text-gray-500 mb-1">{title}</p>
        <p className="text-2xl font-bold text-gray-900">
          {toArabicDigits(value)}
          {suffix ? <span className="text-sm font-normal text-gray-500 mr-1">{suffix}</span> : null}
        </p>
      </div>
    );
  }

  // ---- Render ----
  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">التحليل</h1>
          <p className="text-sm text-gray-500 mt-1">تحليلات الأداء الأكاديمي</p>
        </div>
      </div>

      <SystemAdminSchoolSelector {...schoolScope} />

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <FilterSelect
            label="الصف"
            value={filters.classId}
            onChange={(v) => setFilters((f) => ({ ...f, classId: v }))}
            options={classes}
          />
          <FilterSelect
            label="الشعبة"
            value={filters.sectionId}
            onChange={(v) => setFilters((f) => ({ ...f, sectionId: v }))}
            options={sections}
          />
          <FilterSelect
            label="المادة"
            value={filters.subjectId}
            onChange={(v) => setFilters((f) => ({ ...f, subjectId: v }))}
            options={subjects}
          />
          {activeTab === 'student-summary' && (
            <FilterSelect
              label="الطالب"
              value={filters.studentId}
              onChange={(v) => setFilters((f) => ({ ...f, studentId: v }))}
              options={students.map((s) => ({ id: s.id, name: s.full_name }))}
            />
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex overflow-x-auto border-b border-gray-200">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.key
                  ? 'text-primary-700 border-b-2 border-primary-600 bg-primary-50'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="p-4 min-h-[300px]">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
              <span className="mr-3 text-gray-500">جاري التحميل...</span>
            </div>
          )}

          {error && !loading && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
              {error}
            </div>
          )}

          {!loading && !error && activeTab === 'overview' && overviewData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                <Card title="إجمالي السجلات" value={overviewData.total || 0} />
                <Card title="الناجحون" value={overviewData.pass_count || 0} colorClass="bg-emerald-50" />
                <Card title="المكملون" value={overviewData.incomplete_count || 0} colorClass="bg-amber-50" />
                <Card title="الراسبون" value={overviewData.fail_count || 0} colorClass="bg-red-50" />
                <Card title="المعفيون" value={overviewData.exempt_count || 0} colorClass="bg-blue-50" />
                <Card title="قريبون من النجاح" value={overviewData.close_to_passing_count || 0} colorClass="bg-orange-50" />
                <Card title="قريبون من الإعفاء" value={overviewData.close_to_exemption_count || 0} colorClass="bg-purple-50" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card title="نسبة النجاح" value={overviewData.pass_percentage || 0} suffix="%" colorClass={pctColor(overviewData.pass_percentage || 0)} />
                <Card title="نسبة المكملين" value={overviewData.incomplete_percentage || 0} suffix="%" />
                <Card title="نسبة الراسبين" value={overviewData.fail_percentage || 0} suffix="%" />
                <Card title="نسبة المعفين" value={overviewData.exempt_percentage || 0} suffix="%" />
              </div>
              <div className="text-xs text-gray-500">
                درجة النجاح: {toArabicDigits(overviewData.passing_grade || 50)} — درجة الإعفاء: {toArabicDigits(overviewData.exemption_grade || 90)}
              </div>
            </div>
          )}

          {!loading && !error && (activeTab === 'by-class' || activeTab === 'by-section' || activeTab === 'by-subject') && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-right font-medium">{activeTab === 'by-class' ? 'الصف' : activeTab === 'by-section' ? 'الشعبة' : 'المادة'}</th>
                    <th className="px-3 py-2 text-center font-medium">الإجمالي</th>
                    <th className="px-3 py-2 text-center font-medium">ناجح</th>
                    <th className="px-3 py-2 text-center font-medium">مكمل</th>
                    <th className="px-3 py-2 text-center font-medium">راسب</th>
                    <th className="px-3 py-2 text-center font-medium">معفى</th>
                    <th className="px-3 py-2 text-center font-medium">قريب من النجاح</th>
                    <th className="px-3 py-2 text-center font-medium">قريب من الإعفاء</th>
                    <th className="px-3 py-2 text-center font-medium">نسبة النجاح</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(activeTab === 'by-class' ? byClassData : activeTab === 'by-section' ? bySectionData : bySubjectData).map((row: any) => (
                    <tr key={row.class_id || row.section_id || row.subject_id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {activeTab === 'by-section' ? `${row.class_name} / ${row.section_name}` : row.class_name || row.section_name || row.subject_name || '—'}
                      </td>
                      <td className="px-3 py-2 text-center">{toArabicDigits(row.total || 0)}</td>
                      <td className="px-3 py-2 text-center text-emerald-600">{toArabicDigits(row.pass_count || 0)}</td>
                      <td className="px-3 py-2 text-center text-amber-600">{toArabicDigits(row.incomplete_count || 0)}</td>
                      <td className="px-3 py-2 text-center text-red-600">{toArabicDigits(row.fail_count || 0)}</td>
                      <td className="px-3 py-2 text-center text-blue-600">{toArabicDigits(row.exempt_count || 0)}</td>
                      <td className="px-3 py-2 text-center text-orange-600">{toArabicDigits(row.close_to_passing || 0)}</td>
                      <td className="px-3 py-2 text-center text-purple-600">{toArabicDigits(row.close_to_exemption || 0)}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${pctColor(row.pass_percentage || 0)}`}>
                          {toArabicDigits(row.pass_percentage || 0)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                  {(activeTab === 'by-class' ? byClassData : activeTab === 'by-section' ? bySectionData : bySubjectData).length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-gray-400">
                        لا توجد بيانات
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && activeTab === 'close-passing' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">الطلاب الذين يحتاجون من ١ إلى ٥ درجات للنجاح</p>
              {closePassingData.length === 0 && <p className="text-gray-400 text-center py-8">لا توجد بيانات</p>}
              {closePassingData.map((s: any) => (
                <div key={`${s.student_id}-${s.subject_name}`} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg p-3">
                  <div>
                    <p className="font-medium text-gray-900">{s.student_name}</p>
                    <p className="text-xs text-gray-500">{s.class_name} / {s.section_name} — {s.subject_name}</p>
                  </div>
                  <div className="text-left">
                    <p className="text-sm text-gray-600">الدرجة الفعلية: <span className="font-bold text-gray-900">{toArabicDigits(s.effective_grade)}</span></p>
                    <p className="text-xs text-amber-600">يحتاج {toArabicDigits(s.marks_needed)} درجة</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && !error && activeTab === 'close-exemption' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">الطلاب الذين يحتاجون من ١ إلى ٥ درجات للإعفاء الفردي (السعي السنوي)</p>
              {closeExemptionData.length === 0 && <p className="text-gray-400 text-center py-8">لا توجد بيانات</p>}
              {closeExemptionData.map((s: any) => (
                <div key={`${s.student_id}-${s.subject_name}`} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg p-3">
                  <div>
                    <p className="font-medium text-gray-900">{s.student_name}</p>
                    <p className="text-xs text-gray-500">{s.class_name} / {s.section_name} — {s.subject_name}</p>
                  </div>
                  <div className="text-left">
                    <p className="text-sm text-gray-600">السعي السنوي: <span className="font-bold text-gray-900">{toArabicDigits(s.annual_effort)}</span></p>
                    <p className="text-xs text-purple-600">يحتاج {toArabicDigits(s.marks_needed)} درجة</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && !error && activeTab === 'exemption-blockers' && (
            <div className="overflow-x-auto">
              <p className="text-sm text-gray-500 mb-3">المواد التي تحتوي على طلاب بسعي سنوي مفقود أو أقل من الحد الأدنى للإعفاء العام (تمنع الإعفاء العام)</p>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-right font-medium">المادة</th>
                    <th className="px-3 py-2 text-center font-medium">إجمالي الطلاب</th>
                    <th className="px-3 py-2 text-center font-medium">المعفون</th>
                    <th className="px-3 py-2 text-center font-medium">المانعون</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {blockersData.map((row: any) => (
                    <tr key={row.subject_id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">{row.subject_name}</td>
                      <td className="px-3 py-2 text-center">{toArabicDigits(row.total_students || 0)}</td>
                      <td className="px-3 py-2 text-center text-blue-600">{toArabicDigits(row.exempt_count || 0)}</td>
                      <td className="px-3 py-2 text-center text-red-600">{toArabicDigits(row.blocker_count || 0)}</td>
                    </tr>
                  ))}
                  {blockersData.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-gray-400">لا توجد بيانات</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && activeTab === 'student-summary' && (
            <div className="space-y-4">
              {!filters.studentId && (
                <p className="text-gray-400 text-center py-8">اختر طالباً من قائمة الفلاتر</p>
              )}
              {studentSummaryData && (
                <>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="font-bold text-gray-900 mb-1">{studentSummaryData.student?.full_name}</h3>
                    <p className="text-sm text-gray-500">
                      {studentSummaryData.student?.class_name} / {studentSummaryData.student?.section_name}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      درجة النجاح: {toArabicDigits(studentSummaryData.passing_grade || 50)} — درجة الإعفاء: {toArabicDigits(studentSummaryData.exemption_grade || 90)}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <Card title="المواد" value={studentSummaryData.summary?.total_subjects || 0} />
                    <Card title="الناجح" value={studentSummaryData.summary?.pass_count || 0} colorClass="bg-emerald-50" />
                    <Card title="المكمل" value={studentSummaryData.summary?.incomplete_count || 0} colorClass="bg-amber-50" />
                    <Card title="الراسب" value={studentSummaryData.summary?.fail_count || 0} colorClass="bg-red-50" />
                    <Card title="المعفى" value={studentSummaryData.summary?.exempt_count || 0} colorClass="bg-blue-50" />
                  </div>

                  {studentSummaryData.summary?.general_exemption_eligible && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-emerald-700 text-sm font-medium">
                      ✅ مؤهل للإعفاء العام (متوسط السعي السنوي ≥ {toArabicDigits(studentSummaryData.general_exemption_average_grade || 85)} وأدنى مادة ≥ {toArabicDigits(studentSummaryData.general_exemption_min_subject_grade || 75)})
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-gray-600">
                        <tr>
                          <th className="px-3 py-2 text-right font-medium">المادة</th>
                          <th className="px-3 py-2 text-center font-medium">الدرجة النهائية</th>
                          <th className="px-3 py-2 text-center font-medium">درجة التكميل</th>
                          <th className="px-3 py-2 text-center font-medium">الدرجة الفعلية</th>
                          <th className="px-3 py-2 text-center font-medium">السعي السنوي</th>
                          <th className="px-3 py-2 text-center font-medium">الحالة</th>
                          <th className="px-3 py-2 text-center font-medium">إعفاء فردي</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(studentSummaryData.subjects || []).map((sub: any) => (
                          <tr key={sub.subject_id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-medium text-gray-900">{sub.subject_name}</td>
                            <td className="px-3 py-2 text-center">{toArabicDigits(sub.final_grade ?? '—')}</td>
                            <td className="px-3 py-2 text-center">{toArabicDigits(sub.grade_after_completion ?? '—')}</td>
                            <td className="px-3 py-2 text-center font-bold">{toArabicDigits(sub.effective_grade ?? '—')}</td>
                            <td className="px-3 py-2 text-center">{toArabicDigits(sub.annual_effort ?? '—')}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusBadge(displayGradeStatus(sub.result_status, sub.exemption_status))}`}>
                                {displayGradeStatus(sub.result_status, sub.exemption_status) || '—'} {statusIcon(displayGradeStatus(sub.result_status, sub.exemption_status))}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center">
                              {sub.exemption_status === 1 ? (
                                <span className="text-blue-600 text-xs font-medium">معفى</span>
                              ) : (
                                <span className="text-gray-400 text-xs">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
