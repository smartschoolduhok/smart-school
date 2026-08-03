import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  getStudentSubjects, getClasses, getSections, getStudents, getSubjects,
  assignSubjectsToClass, assignSubjectsToSection, assignSubjectsToStudents, assignSubjectToOne,
  deactivateStudentSubject, reactivateStudentSubject, bulkDeactivateStudentSubject
} from '../../lib/api';
import { toArabicDigits } from '../../lib/arabicDigits';
import { ACADEMIC_MANAGEMENT_ROLES, hasRole } from '../../lib/rbac';
import {
  Search, Filter, Plus, X, Check, BookMarked, GraduationCap, Users, User,
  Layers, BookOpen, ToggleLeft, ToggleRight, AlertCircle, Loader2, ChevronDown, ChevronUp
} from 'lucide-react';

type Mode = 'list' | 'class' | 'section' | 'students' | 'one';

interface AssignmentRecord {
  id: number;
  school_id: number;
  student_id: number;
  subject_id: number;
  class_id: number;
  section_id: number | null;
  is_active: number;
  assigned_at: string;
  removed_at: string | null;
  notes: string | null;
  student_name?: string;
  student_number?: string;
  subject_name?: string;
  subject_type?: string;
  counts_in_average?: number;
  appears_in_report_card?: number;
  class_name?: string;
  section_name?: string;
  assigned_by_name?: string;
}

interface ClassRec { id: number; name: string; school_id: number; stage: string; status: string; }
interface SectionRec { id: number; name: string; class_id: number; school_id: number; }
interface StudentRec { id: number; full_name: string; student_number: string; class_id: number | null; section_id: number | null; }
interface SubjectRec { id: number; name: string; subject_type: string; class_id: number; section_id: number | null; }

export default function StudentSubjectsPage() {
  const { user } = useAuth();
  const schoolId = user?.school_id;
  const canManage = hasRole(user?.role_key, ACADEMIC_MANAGEMENT_ROLES);

  // Data
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [classes, setClasses] = useState<ClassRec[]>([]);
  const [sections, setSections] = useState<SectionRec[]>([]);
  const [students, setStudents] = useState<StudentRec[]>([]);
  const [subjects, setSubjects] = useState<SubjectRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [filterClass, setFilterClass] = useState<string>('');
  const [filterSection, setFilterSection] = useState<string>('');
  const [filterStudent, setFilterStudent] = useState<string>('');
  const [filterSubject, setFilterSubject] = useState<string>('');
  const [filterActive, setFilterActive] = useState<string>('1');
  const [showFilters, setShowFilters] = useState(false);

  // Assignment mode
  const [mode, setMode] = useState<Mode>('list');
  const [assignClass, setAssignClass] = useState<string>('');
  const [assignSection, setAssignSection] = useState<string>('');
  const [assignSubjectIds, setAssignSubjectIds] = useState<number[]>([]);
  const [assignStudentIds, setAssignStudentIds] = useState<number[]>([]);
  const [assignStudent, setAssignStudent] = useState<string>('');
  const [assignSubject, setAssignSubject] = useState<string>('');
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [assignSuccess, setAssignSuccess] = useState('');

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false);

  useEffect(() => { loadData(); }, [schoolId]);

  async function loadData() {
    setLoading(true); setError('');
    const sid = schoolId ?? undefined;
    const [aRes, cRes, sRes, stRes, suRes] = await Promise.all([
      getStudentSubjects(sid, undefined, undefined, undefined, undefined, filterActive === '' ? null : filterActive === '1'),
      getClasses(sid), getSections(sid), getStudents(sid), getSubjects(sid)
    ]);
    if (aRes.data) setAssignments(aRes.data as AssignmentRecord[]);
    else if (aRes.error) setError(aRes.error);
    if (cRes.data) setClasses(cRes.data as ClassRec[]);
    if (sRes.data) setSections(sRes.data as SectionRec[]);
    if (stRes.data) setStudents(stRes.data as StudentRec[]);
    if (suRes.data) setSubjects(suRes.data as SubjectRec[]);
    setLoading(false);
  }

  const filteredAssignments = useMemo(() => {
    let list = assignments;
    if (filterActive !== '') list = list.filter((a) => String(a.is_active) === filterActive);
    if (filterClass) list = list.filter((a) => String(a.class_id) === filterClass);
    if (filterSection) list = list.filter((a) => String(a.section_id) === filterSection);
    if (filterStudent) list = list.filter((a) => String(a.student_id) === filterStudent);
    if (filterSubject) list = list.filter((a) => String(a.subject_id) === filterSubject);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) =>
        (a.student_name && a.student_name.toLowerCase().includes(q)) ||
        (a.subject_name && a.subject_name.toLowerCase().includes(q)) ||
        (a.class_name && a.class_name.toLowerCase().includes(q))
      );
    }
    return list;
  }, [assignments, search, filterClass, filterSection, filterStudent, filterSubject, filterActive]);

  const sectionsForClass = useMemo(() => {
    if (!filterClass) return sections;
    return sections.filter((s) => String(s.class_id) === filterClass);
  }, [filterClass, sections]);

  const subjectsForClass = useMemo(() => {
    if (!assignClass) return subjects;
    return subjects.filter((s) => String(s.class_id) === assignClass && (!assignSection || (s.section_id ? String(s.section_id) === assignSection : true)));
  }, [assignClass, assignSection, subjects]);

  const studentsForClassSection = useMemo(() => {
    let list = students.filter((st) => (st as any).status !== 'archived');
    if (assignClass) list = list.filter((st) => String(st.class_id) === assignClass);
    if (assignSection) list = list.filter((st) => String(st.section_id) === assignSection);
    return list;
  }, [assignClass, assignSection, students]);

  function toggleSubjectId(id: number) {
    setAssignSubjectIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function toggleStudentId(id: number) {
    setAssignStudentIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function resetAssign() {
    setAssignClass(''); setAssignSection(''); setAssignSubjectIds([]); setAssignStudentIds([]);
    setAssignStudent(''); setAssignSubject(''); setAssignError(''); setAssignSuccess('');
  }

  async function handleAssign() {
    setAssignError(''); setAssignSuccess('');
    if (mode === 'class') {
      if (!assignClass) { setAssignError('يجب اختيار الصف'); return; }
      if (assignSubjectIds.length === 0) { setAssignError('يجب اختيار مادة واحدة على الأقل'); return; }
      setAssigning(true);
      const res = await assignSubjectsToClass(Number(assignClass), assignSubjectIds);
      setAssigning(false);
      if (res.error) setAssignError(res.error);
      else { setAssignSuccess(`تم التعيين: ${res.data?.inserted_count || 0} تعيين جديد`); resetAssign(); loadData(); }
    } else if (mode === 'section') {
      if (!assignSection) { setAssignError('يجب اختيار الشعبة'); return; }
      if (assignSubjectIds.length === 0) { setAssignError('يجب اختيار مادة واحدة على الأقل'); return; }
      setAssigning(true);
      const res = await assignSubjectsToSection(Number(assignSection), assignSubjectIds);
      setAssigning(false);
      if (res.error) setAssignError(res.error);
      else { setAssignSuccess(`تم التعيين: ${res.data?.inserted_count || 0} تعيين جديد`); resetAssign(); loadData(); }
    } else if (mode === 'students') {
      if (assignStudentIds.length === 0) { setAssignError('يجب اختيار طالب واحد على الأقل'); return; }
      if (assignSubjectIds.length === 0) { setAssignError('يجب اختيار مادة واحدة على الأقل'); return; }
      setAssigning(true);
      const res = await assignSubjectsToStudents(assignStudentIds, assignSubjectIds);
      setAssigning(false);
      if (res.error) setAssignError(res.error);
      else { setAssignSuccess(`تم التعيين: ${res.data?.inserted_count || 0} تعيين جديد`); resetAssign(); loadData(); }
    } else if (mode === 'one') {
      if (!assignStudent || !assignSubject) { setAssignError('الطالب والمادة مطلوبان'); return; }
      setAssigning(true);
      const res = await assignSubjectToOne(Number(assignStudent), Number(assignSubject));
      setAssigning(false);
      if (res.error) setAssignError(res.error);
      else { setAssignSuccess('تم تعيين المادة للطالب بنجاح'); resetAssign(); loadData(); }
    }
  }

  async function handleDeactivate(id: number) {
    if (!confirm('هل أنت متأكد من إلغاء التعيين؟')) return;
    const res = await deactivateStudentSubject(id);
    if (res.error) alert(res.error);
    else loadData();
  }

  async function handleReactivate(id: number) {
    if (!confirm('هل أنت متأكد من إعادة تفعيل التعيين؟')) return;
    const res = await reactivateStudentSubject(id);
    if (res.error) alert(res.error);
    else loadData();
  }

  async function handleBulkDeactivate() {
    if (!confirm(`هل أنت متأكد من إلغاء ${selectedIds.length} تعيين مختار؟`)) return;
    const res = await bulkDeactivateStudentSubject(selectedIds);
    if (res.error) alert(res.error);
    else { setSelectedIds([]); setConfirmBulkOpen(false); loadData(); }
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function selectAllVisible() {
    const ids = filteredAssignments.map((a) => a.id);
    const allSelected = ids.every((id) => selectedIds.includes(id));
    if (allSelected) setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
    else setSelectedIds((prev) => Array.from(new Set([...prev, ...ids])));
  }

  const activeCount = assignments.filter((a) => a.is_active === 1).length;
  const inactiveCount = assignments.filter((a) => a.is_active === 0).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">مواد الطالب</h1>
          <p className="text-sm text-gray-500 mt-1">تعيين وإدارة مواد الطلاب</p>
        </div>
        {canManage && mode === 'list' && (
          <button onClick={() => { setMode('class'); resetAssign(); }} className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
            <Plus size={18} />
            <span>تعيين مواد</span>
          </button>
        )}
        {mode !== 'list' && (
          <button onClick={() => { setMode('list'); resetAssign(); }} className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">
            <X size={18} />
            <span>إلغاء</span>
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600"><BookMarked size={20} /></div>
          <div>
            <p className="text-xs text-gray-500">إجمالي التعيينات</p>
            <p className="text-lg font-bold text-gray-900">{toArabicDigits(assignments.length)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center text-green-600"><ToggleRight size={20} /></div>
          <div>
            <p className="text-xs text-gray-500">نشطة</p>
            <p className="text-lg font-bold text-gray-900">{toArabicDigits(activeCount)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center text-amber-600"><ToggleLeft size={20} /></div>
          <div>
            <p className="text-xs text-gray-500">غير نشطة</p>
            <p className="text-lg font-bold text-gray-900">{toArabicDigits(inactiveCount)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center text-purple-600"><GraduationCap size={20} /></div>
          <div>
            <p className="text-xs text-gray-500">الطلاب المشمولون</p>
            <p className="text-lg font-bold text-gray-900">{toArabicDigits(new Set(assignments.map((a) => a.student_id)).size)}</p>
          </div>
        </div>
      </div>

      {mode === 'list' ? (
        <>
          {/* Filters */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="البحث بطالب أو مادة..." className="w-full pr-10 pl-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <button onClick={() => setShowFilters(!showFilters)} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors ${showFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                <Filter size={18} />
                <span>التصفية</span>
              </button>
            </div>
            {showFilters && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 mt-3 pt-3 border-t border-gray-100">
                <select value={filterActive} onChange={(e) => setFilterActive(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="1">نشط</option>
                  <option value="0">غير نشط</option>
                  <option value="">الكل</option>
                </select>
                <select value={filterClass} onChange={(e) => { setFilterClass(e.target.value); setFilterSection(''); }} className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">كل الصفوف</option>
                  {classes.filter((c) => c.status === 'active').map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                </select>
                <select value={filterSection} onChange={(e) => setFilterSection(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">كل الشعب</option>
                  {sectionsForClass.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                </select>
                <select value={filterStudent} onChange={(e) => setFilterStudent(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">كل الطلاب</option>
                  {students.map((st) => <option key={st.id} value={String(st.id)}>{st.full_name}</option>)}
                </select>
                <select value={filterSubject} onChange={(e) => setFilterSubject(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">كل المواد</option>
                  {subjects.map((su) => <option key={su.id} value={String(su.id)}>{su.name}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Bulk actions */}
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm text-gray-600">{toArabicDigits(selectedIds.length)} تعيين مختار</span>
              <button onClick={() => setConfirmBulkOpen(true)} className="px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm hover:bg-red-100 transition-colors">إلغاء التعيين</button>
              <button onClick={() => setSelectedIds([])} className="px-3 py-1.5 bg-gray-50 text-gray-700 border border-gray-200 rounded-lg text-sm hover:bg-gray-100 transition-colors">إلغاء التحديد</button>
            </div>
          )}

          {/* Table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {loading ? (
              <div className="p-12 text-center">
                <div className="w-10 h-10 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-gray-500">جاري التحميل...</p>
              </div>
            ) : error ? (
              <div className="p-8 text-center text-red-600">
                <p className="font-medium">{error}</p>
                <button onClick={loadData} className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">إعادة المحاولة</button>
              </div>
            ) : filteredAssignments.length === 0 ? (
              <div className="p-12 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4"><Search size={24} className="text-gray-400" /></div>
                <h3 className="text-lg font-bold text-gray-900 mb-1">لا توجد نتائج</h3>
                <p className="text-sm text-gray-500">جرب تغيير معايير البحث أو أضف تعيين جديد</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-3 py-3 text-xs font-semibold text-gray-600">
                        <input type="checkbox" onChange={selectAllVisible} checked={filteredAssignments.length > 0 && filteredAssignments.every((a) => selectedIds.includes(a.id))} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-600">#</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-600">اسم الطالب</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-600">الصف</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-600">الشعبة</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-600">المادة</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-600">نوع المادة</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-600">المعدل</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-600">الكارت</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-600">الحالة</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-600">تاريخ التعيين</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-600">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredAssignments.map((a, idx) => (
                      <tr key={a.id} className={`hover:bg-gray-50 transition-colors ${a.is_active === 0 ? 'opacity-60' : ''}`}>
                        <td className="px-3 py-3">
                          <input type="checkbox" checked={selectedIds.includes(a.id)} onChange={() => toggleSelect(a.id)} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">{toArabicDigits(idx + 1)}</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{a.student_name || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{a.class_name || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{a.section_name || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{a.subject_name || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${a.subject_type === 'أساسية' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>{a.subject_type || '—'}</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{a.counts_in_average ? 'نعم' : 'لا'}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{a.appears_in_report_card ? 'نعم' : 'لا'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${a.is_active === 1 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                            {a.is_active === 1 ? 'نشط' : 'غير نشط'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">{a.assigned_at ? toArabicDigits(new Date(a.assigned_at).toLocaleDateString('ar-IQ')) : '—'}</td>
                        <td className="px-4 py-3">
                          {canManage && a.is_active === 1 && (
                            <button onClick={() => handleDeactivate(a.id)} className="px-2 py-1 text-xs bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 transition-colors">إلغاء التعيين</button>
                          )}
                          {canManage && a.is_active === 0 && (
                            <button onClick={() => handleReactivate(a.id)} className="px-2 py-1 text-xs bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100 transition-colors">إعادة التفعيل</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">تعيين مواد</h2>
          {/* Mode selector */}
          <div className="flex flex-wrap gap-2 mb-6">
            {[
              { key: 'class', label: 'صف بالكامل', icon: <Layers size={16} /> },
              { key: 'section', label: 'شعبة بالكامل', icon: <Users size={16} /> },
              { key: 'students', label: 'مجموعة طلاب', icon: <GraduationCap size={16} /> },
              { key: 'one', label: 'طالب واحد', icon: <User size={16} /> },
            ].map((m) => (
              <button
                key={m.key}
                onClick={() => { setMode(m.key as Mode); resetAssign(); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${mode === m.key ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>

          {assignSuccess && <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 mb-4">{assignSuccess}</div>}
          {assignError && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4 flex items-center gap-2"><AlertCircle size={16} /> {assignError}</div>}

          {/* Inputs per mode */}
          <div className="space-y-4">
            {(mode === 'class' || mode === 'section' || mode === 'students') && (
              <>
                {(mode === 'class' || mode === 'students') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">الصف <span className="text-red-500">*</span></label>
                    <select value={assignClass} onChange={(e) => { setAssignClass(e.target.value); setAssignSection(''); }} className="w-full sm:w-1/2 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">اختر الصف</option>
                      {classes.filter((c) => c.status === 'active').map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                    </select>
                  </div>
                )}
                {mode === 'section' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">الشعبة <span className="text-red-500">*</span></label>
                    <select value={assignSection} onChange={(e) => setAssignSection(e.target.value)} className="w-full sm:w-1/2 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">اختر الشعبة</option>
                      {sections.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                    </select>
                  </div>
                )}
                {mode === 'students' && assignClass && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">الشعبة (اختياري)</label>
                    <select value={assignSection} onChange={(e) => setAssignSection(e.target.value)} className="w-full sm:w-1/2 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">كل الشعب</option>
                      {sections.filter((s) => String(s.class_id) === assignClass).map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                    </select>
                  </div>
                )}
                {mode === 'students' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">الطلاب <span className="text-red-500">*</span></label>
                    <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-3 space-y-2">
                      {studentsForClassSection.length === 0 && <p className="text-sm text-gray-500">لا يوجد طلاب</p>}
                      {studentsForClassSection.map((st) => (
                        <label key={st.id} className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={assignStudentIds.includes(st.id)} onChange={() => toggleStudentId(st.id)} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                          <span className="text-sm text-gray-800">{st.full_name}</span>
                          <span className="text-xs text-gray-400 mr-auto">{st.student_number}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">المواد <span className="text-red-500">*</span></label>
                  <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {subjectsForClass.map((su) => (
                      <label key={su.id} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={assignSubjectIds.includes(su.id)} onChange={() => toggleSubjectId(su.id)} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        <span className="text-sm text-gray-800">{su.name}</span>
                      </label>
                    ))}
                    {subjectsForClass.length === 0 && <p className="text-sm text-gray-500">لا توجد مواد</p>}
                  </div>
                </div>
              </>
            )}

            {mode === 'one' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الطالب <span className="text-red-500">*</span></label>
                  <select value={assignStudent} onChange={(e) => setAssignStudent(e.target.value)} className="w-full sm:w-1/2 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">اختر الطالب</option>
                    {students.map((st) => <option key={st.id} value={String(st.id)}>{st.full_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">المادة <span className="text-red-500">*</span></label>
                  <select value={assignSubject} onChange={(e) => setAssignSubject(e.target.value)} className="w-full sm:w-1/2 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">اختر المادة</option>
                    {subjects.map((su) => <option key={su.id} value={String(su.id)}>{su.name}</option>)}
                  </select>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 mt-6 pt-6 border-t border-gray-100">
            <button onClick={() => { setMode('list'); resetAssign(); }} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">إلغاء</button>
            <button onClick={handleAssign} disabled={assigning} className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg text-sm font-medium transition-colors">
              {assigning ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
              <span>
                {mode === 'class' && 'تعيين للصف بالكامل'}
                {mode === 'section' && 'تعيين للشعبة بالكامل'}
                {mode === 'students' && 'تعيين للطلاب المختارين'}
                {mode === 'one' && 'تعيين للطالب'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Confirm bulk deactivate */}
      {confirmBulkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">تأكيد الإلغاء</h3>
            <p className="text-sm text-gray-600 mb-6">هل أنت متأكد من إلغاء {toArabicDigits(selectedIds.length)} تعيين مختار؟</p>
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setConfirmBulkOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">إلغاء</button>
              <button onClick={handleBulkDeactivate} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium">نعم، إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
