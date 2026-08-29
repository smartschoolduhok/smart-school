import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { getSubjects, getClasses, getSections, createSubject, updateSubject, archiveSubject, reorderSubjects } from '../../lib/api';
import { toArabicDigits } from '../../lib/arabicDigits';
import { ACADEMIC_MANAGEMENT_ROLES, hasRole } from '../../lib/rbac';
import { mergeReturnedSubjectOrder, moveOrderedItem } from '../../lib/subjectOrdering';
import { religiousTrackLabel, type ReligiousTrack } from '../../lib/religiousSubjects';
import { Search, Plus, Filter, Archive, Edit2, X, Check, BookOpen, ListOrdered, Tag, Users, GripVertical, ArrowUp, ArrowDown } from 'lucide-react';

interface SubjectRecord {
  id: number;
  school_id: number;
  class_id: number;
  section_id: number | null;
  name: string;
  subject_type: 'أساسية' | 'اختيارية';
  religious_track: ReligiousTrack | null;
  counts_in_average: boolean;
  appears_in_report_card: boolean;
  passing_grade: number;
  exemption_grade: number;
  order_index: number;
  status: 'active' | 'inactive' | 'archived';
  created_at: string;
  updated_at: string;
  class_name?: string;
  section_name?: string;
}

interface ClassRecord {
  id: number;
  name: string;
  order_index: number;
  status?: 'active' | 'inactive' | 'archived';
}

interface SectionRecord {
  id: number;
  name: string;
  class_id: number;
}

const emptyForm = {
  class_id: '' as string | number,
  section_id: '' as string | number,
  name: '',
  subject_type: 'أساسية' as 'أساسية' | 'اختيارية',
  religious_track: '' as '' | ReligiousTrack,
  counts_in_average: true,
  appears_in_report_card: true,
  passing_grade: 50,
  exemption_grade: 25,
};

export default function SubjectsPage() {
  const { user } = useAuth();
  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const canManage = hasRole(user?.role_key, ACADEMIC_MANAGEMENT_ROLES);
  const canManageSelectedSchool = canManage && schoolId != null;

  const [subjects, setSubjects] = useState<SubjectRecord[]>([]);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [sections, setSections] = useState<SectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [filterClass, setFilterClass] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterReligion, setFilterReligion] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('active');
  const [showFilters, setShowFilters] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [reorderOpen, setReorderOpen] = useState(false);
  const [reorderClassId, setReorderClassId] = useState('');
  const [orderedSubjects, setOrderedSubjects] = useState<SubjectRecord[]>([]);
  const [draggedSubjectId, setDraggedSubjectId] = useState<number | null>(null);
  const [reorderSaving, setReorderSaving] = useState(false);
  const [reorderError, setReorderError] = useState('');

  useEffect(() => {
    setSubjects([]);
    setClasses([]);
    setSections([]);
    setFilterClass('');
    setModalOpen(false);
    setReorderOpen(false);
    setReorderClassId('');
    setOrderedSubjects([]);
    setDraggedSubjectId(null);
    setReorderSaving(false);
    setReorderError('');
    setEditingId(null);
    setForm(emptyForm);
    setLoading(false);
    setSaving(false);
    setError('');
    setFormError('');
    void loadData();
  }, [schoolId]);

  async function loadData() {
    const isCurrentRequest = captureSchoolRequest();
    if (schoolId == null) {
      setSubjects([]);
      setClasses([]);
      setSections([]);
      setError('');
      setLoading(false);
      return;
    }
    setLoading(true); setError('');
    const [subRes, cRes, sRes] = await Promise.all([getSubjects(schoolId), getClasses(schoolId), getSections(schoolId)]);
    if (!isCurrentRequest()) return;
    if (subRes.data) setSubjects(subRes.data as SubjectRecord[]);
    else if (subRes.error) setError(subRes.error);
    if (cRes.data) setClasses(cRes.data as ClassRecord[]);
    if (sRes.data) setSections(sRes.data as SectionRecord[]);
    setLoading(false);
  }

  const filteredSubjects = useMemo(() => {
    let list = subjects;
    if (filterStatus) list = list.filter((s) => s.status === filterStatus);
    if (filterClass) list = list.filter((s) => String(s.class_id) === filterClass);
    if (filterType) list = list.filter((s) => s.subject_type === filterType);
    if (filterReligion === 'ordinary') list = list.filter((s) => s.religious_track == null);
    if (filterReligion === 'religious') list = list.filter((s) => s.religious_track != null);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q) || (s.class_name && s.class_name.toLowerCase().includes(q)));
    }
    const classOrder = new Map(classes.map((item) => [item.id, item.order_index]));
    return [...list].sort((a, b) =>
      ((classOrder.get(a.class_id) ?? 0) - (classOrder.get(b.class_id) ?? 0))
      || (a.class_id - b.class_id)
      || (a.order_index - b.order_index)
      || (a.id - b.id)
    );
  }, [subjects, classes, search, filterClass, filterType, filterReligion, filterStatus]);

  function openCreate() {
    if (schoolId == null) return;
    setForm(emptyForm);
    setFormError('');
    setModalMode('create');
    setEditingId(null);
    setModalOpen(true);
  }

  function openEdit(s: SubjectRecord) {
    if (schoolId == null) return;
    setForm({
      class_id: s.class_id,
      section_id: s.section_id || '',
      name: s.name,
      subject_type: s.subject_type,
      religious_track: s.religious_track || '',
      counts_in_average: !!s.counts_in_average,
      appears_in_report_card: !!s.appears_in_report_card,
      passing_grade: s.passing_grade,
      exemption_grade: s.exemption_grade,
    });
    setFormError('');
    setModalMode('edit');
    setEditingId(s.id);
    setModalOpen(true);
  }

  async function handleSave() {
    setFormError('');
    if (schoolId == null) { setFormError('يجب اختيار المدرسة المستهدفة أولاً'); return; }
    if (!form.class_id || !form.name.trim()) { setFormError('الصف واسم المادة مطلوبة'); return; }
    const isCurrentRequest = captureSchoolRequest();
    setSaving(true);
    const payload = {
      school_id: schoolId,
      class_id: Number(form.class_id),
      section_id: form.section_id ? Number(form.section_id) : null,
      name: form.name.trim(),
      subject_type: form.subject_type,
      religious_track: form.religious_track || null,
      counts_in_average: form.counts_in_average,
      appears_in_report_card: form.appears_in_report_card,
      passing_grade: Number(form.passing_grade) || 50,
      exemption_grade: Number(form.exemption_grade) || 25,
    };
    if (modalMode === 'create') {
      const res = await createSubject(payload);
      if (!isCurrentRequest()) return;
      if (res.error) setFormError(res.error);
      else { setModalOpen(false); loadData(); }
    } else if (editingId != null) {
      const res = await updateSubject(editingId, { ...payload, status: 'active' });
      if (!isCurrentRequest()) return;
      if (res.error) setFormError(res.error);
      else { setModalOpen(false); loadData(); }
    }
    setSaving(false);
  }

  async function handleArchive(id: number) {
    if (schoolId == null) return;
    if (!confirm('هل أنت متأكد من أرشفة هذه المادة؟')) return;
    const isCurrentRequest = captureSchoolRequest();
    const res = await archiveSubject(id, schoolId);
    if (!isCurrentRequest()) return;
    if (res.error) alert(res.error);
    else loadData();
  }

  function subjectsForReorder(classId: string): SubjectRecord[] {
    if (!classId) return [];
    return subjects
      .filter((subject) => subject.status === 'active' && String(subject.class_id) === classId)
      .sort((a, b) => (a.order_index - b.order_index) || (a.id - b.id));
  }

  function openReorder() {
    if (schoolId == null) return;
    const initialClassId = filterClass && classes.some((item) =>
      String(item.id) === filterClass && item.status === 'active'
    ) ? filterClass : '';
    setReorderClassId(initialClassId);
    setOrderedSubjects(subjectsForReorder(initialClassId));
    setDraggedSubjectId(null);
    setReorderError('');
    setReorderSaving(false);
    setReorderOpen(true);
  }

  function selectReorderClass(classId: string) {
    setReorderClassId(classId);
    setOrderedSubjects(subjectsForReorder(classId));
    setDraggedSubjectId(null);
    setReorderError('');
  }

  function moveSubject(subjectId: number, direction: -1 | 1) {
    setOrderedSubjects((current) => {
      const index = current.findIndex((subject) => subject.id === subjectId);
      const target = current[index + direction];
      return target ? moveOrderedItem(current, subjectId, target.id) : current;
    });
  }

  function dropSubject(targetId: number) {
    if (draggedSubjectId == null) return;
    setOrderedSubjects((current) => moveOrderedItem(current, draggedSubjectId, targetId));
    setDraggedSubjectId(null);
  }

  async function saveSubjectOrder() {
    setReorderError('');
    if (schoolId == null || !reorderClassId) {
      setReorderError('يجب اختيار المدرسة والصف أولاً');
      return;
    }

    const isCurrentRequest = captureSchoolRequest();
    setReorderSaving(true);
    const response = await reorderSubjects(
      schoolId,
      Number(reorderClassId),
      orderedSubjects.map((subject) => subject.id),
    );
    if (!isCurrentRequest()) return;
    setReorderSaving(false);
    if (response.error) {
      setReorderError(response.error);
      return;
    }

    const returned = (response.data || []) as SubjectRecord[];
    setSubjects((current) => mergeReturnedSubjectOrder(current, returned));
    setOrderedSubjects(returned);
    setReorderOpen(false);
  }

  const sectionsForClass = useMemo(() => {
    if (!form.class_id) return [];
    return sections.filter((sec) => String(sec.class_id) === String(form.class_id));
  }, [form.class_id, sections]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">المواد الدراسية</h1>
          <p className="text-sm text-gray-500 mt-1">إدارة المواد وإعدادات الدرجات والكشوف</p>
        </div>
        {canManageSelectedSchool && (
          <div className="flex items-center gap-2">
            <button onClick={openReorder} className="flex items-center gap-2 px-4 py-2.5 border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-sm font-medium transition-colors">
              <ListOrdered size={18} />
              <span>ترتيب المواد</span>
            </button>
            <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
              <Plus size={18} />
              <span>إضافة مادة</span>
            </button>
          </div>
        )}
      </div>

      <div className="mb-6">
        <SystemAdminSchoolSelector {...schoolScope} />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="البحث باسم المادة أو الصف..." className="w-full pr-10 pl-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={() => setShowFilters(!showFilters)} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors ${showFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            <Filter size={18} />
            <span>التصفية</span>
          </button>
        </div>
        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-gray-100">
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="active">نشطة</option>
              <option value="inactive">غير نشطة</option>
              <option value="archived">مؤرشفة</option>
              <option value="">الكل</option>
            </select>
            <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">كل الصفوف</option>
              {classes.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">كل الأنواع</option>
              <option value="أساسية">أساسية</option>
              <option value="اختيارية">اختيارية</option>
            </select>
            <select value={filterReligion} onChange={(e) => setFilterReligion(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">كل المواد</option>
              <option value="ordinary">مواد عادية</option>
              <option value="religious">مواد دينية</option>
            </select>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600"><BookOpen size={20} /></div>
          <div>
            <p className="text-xs text-gray-500">إجمالي المواد</p>
            <p className="text-lg font-bold text-gray-900">{toArabicDigits(subjects.length)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center text-green-600"><ListOrdered size={20} /></div>
          <div>
            <p className="text-xs text-gray-500">المواد الأساسية</p>
            <p className="text-lg font-bold text-gray-900">{toArabicDigits(subjects.filter((s) => s.subject_type === 'أساسية').length)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center text-purple-600"><Tag size={20} /></div>
          <div>
            <p className="text-xs text-gray-500">الاختيارية</p>
            <p className="text-lg font-bold text-gray-900">{toArabicDigits(subjects.filter((s) => s.subject_type === 'اختيارية').length)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center text-amber-600"><Users size={20} /></div>
          <div>
            <p className="text-xs text-gray-500">المؤرشفة</p>
            <p className="text-lg font-bold text-gray-900">{toArabicDigits(subjects.filter((s) => s.status === 'archived').length)}</p>
          </div>
        </div>
      </div>

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
        ) : filteredSubjects.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4"><Search size={24} className="text-gray-400" /></div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">لا توجد نتائج</h3>
            <p className="text-sm text-gray-500">جرب تغيير معايير البحث أو أضف مادة جديدة</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">#</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">المادة</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">النوع</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">الصف</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">الشعبة</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">الترتيب</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">نجاح/إعفاء</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">كارت النتيجة / حساب المعدل</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">الحالة</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSubjects.map((s, idx) => (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-500">{toArabicDigits(idx + 1)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{s.name}</span>
                        {s.religious_track && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                            {religiousTrackLabel(s.religious_track)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${s.subject_type === 'أساسية' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>{s.subject_type}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.class_name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.section_name || 'كل الشعب'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{toArabicDigits(s.order_index)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{toArabicDigits(s.passing_grade)} / {toArabicDigits(s.exemption_grade)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      <div className="flex flex-wrap gap-1">
                        <span className={`px-1.5 py-0.5 rounded text-xs ${s.appears_in_report_card ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                          يظهر في الكارت: {s.appears_in_report_card ? 'نعم' : 'لا'}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-xs ${s.counts_in_average ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          يدخل في المعدل: {s.counts_in_average ? 'نعم' : 'لا'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                        s.status === 'active' ? 'bg-green-100 text-green-700' : s.status === 'archived' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'
                      }`}>
                        {s.status === 'active' ? 'نشطة' : s.status === 'archived' ? 'مؤرشفة' : 'غير نشطة'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {canManageSelectedSchool && (
                          <>
                            <button onClick={() => openEdit(s)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="تعديل"><Edit2 size={16} /></button>
                            <button onClick={() => handleArchive(s.id)} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title="أرشفة"><Archive size={16} /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {reorderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="subject-order-title">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <div>
                <h2 id="subject-order-title" className="text-xl font-bold text-gray-900">ترتيب المواد</h2>
                <p className="text-sm text-gray-500 mt-1">اختر الصف ثم اسحب جميع مواده النشطة إلى الترتيب المطلوب</p>
              </div>
              <button onClick={() => setReorderOpen(false)} disabled={reorderSaving} aria-label="إغلاق ترتيب المواد" className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 disabled:opacity-50"><X size={20} /></button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              {reorderError && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{reorderError}</div>}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">الصف <span className="text-red-500">*</span></label>
                <select value={reorderClassId} onChange={(event) => selectReorderClass(event.target.value)} disabled={reorderSaving} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100">
                  <option value="">اختر الصف</option>
                  {classes.filter((item) => item.status === 'active').map((item) => (
                    <option key={item.id} value={String(item.id)}>{item.name}</option>
                  ))}
                </select>
              </div>

              {reorderClassId && orderedSubjects.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl">لا توجد مواد نشطة في هذا الصف</div>
              ) : (
                <div className="space-y-2" aria-label="قائمة ترتيب المواد">
                  {orderedSubjects.map((subject, index) => (
                    <div
                      key={subject.id}
                      draggable={!reorderSaving}
                      onDragStart={() => setDraggedSubjectId(subject.id)}
                      onDragEnd={() => setDraggedSubjectId(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => dropSubject(subject.id)}
                      className={`flex items-center gap-3 p-3 border rounded-xl bg-white transition-colors ${draggedSubjectId === subject.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}
                    >
                      <GripVertical size={20} className="text-gray-400 shrink-0 cursor-grab" aria-hidden="true" />
                      <span className="w-7 h-7 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center text-sm font-semibold shrink-0">{toArabicDigits(index + 1)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{subject.name}</p>
                        <p className="text-xs text-gray-500">{subject.section_name ? `الشعبة: ${subject.section_name}` : 'كل الشعب'}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => moveSubject(subject.id, -1)} disabled={reorderSaving || index === 0} aria-label={`نقل ${subject.name} إلى الأعلى`} className="p-1.5 text-gray-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg disabled:opacity-30"><ArrowUp size={16} /></button>
                        <button type="button" onClick={() => moveSubject(subject.id, 1)} disabled={reorderSaving || index === orderedSubjects.length - 1} aria-label={`نقل ${subject.name} إلى الأسفل`} className="p-1.5 text-gray-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg disabled:opacity-30"><ArrowDown size={16} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-100">
              <button onClick={() => setReorderOpen(false)} disabled={reorderSaving} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50">إلغاء</button>
              <button onClick={saveSubjectOrder} disabled={reorderSaving || !reorderClassId || orderedSubjects.length === 0} className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg text-sm font-medium transition-colors">
                {reorderSaving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check size={18} />}
                <span>حفظ الترتيب</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">{modalMode === 'create' ? 'إضافة مادة جديدة' : 'تعديل المادة'}</h2>
              <button onClick={() => setModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              {formError && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{formError}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">اسم المادة <span className="text-red-500">*</span></label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الصف <span className="text-red-500">*</span></label>
                  <select value={String(form.class_id)} onChange={(e) => setForm({ ...form, class_id: e.target.value, section_id: '' })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">اختر الصف</option>
                    {classes.filter((c) => (c as any).status === 'active').map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الشعبة (اختياري)</label>
                  <select value={String(form.section_id)} onChange={(e) => setForm({ ...form, section_id: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">كل الشعب</option>
                    {sectionsForClass.map((sec) => <option key={sec.id} value={String(sec.id)}>{sec.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">النوع</label>
                  <select value={form.subject_type} onChange={(e) => setForm({ ...form, subject_type: e.target.value as 'أساسية' | 'اختيارية' })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="أساسية">أساسية</option>
                    <option value="اختيارية">اختيارية</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">نوع مادة الديانة</label>
                  <select value={form.religious_track} onChange={(e) => setForm({ ...form, religious_track: e.target.value as '' | ReligiousTrack })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">ليست مادة ديانة</option>
                    <option value="islamic">إسلامية</option>
                    <option value="christian">مسيحية</option>
                    <option value="other">أخرى</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">درجة النجاح</label>
                  <input type="number" value={form.passing_grade} onChange={(e) => setForm({ ...form, passing_grade: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">درجة الإعفاء</label>
                  <input type="number" value={form.exemption_grade} onChange={(e) => setForm({ ...form, exemption_grade: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="sm:col-span-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="mb-2 text-xs text-gray-500">خيارا العرض في الكارت والدخول في المعدل مستقلان.</p>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={form.counts_in_average} onChange={(e) => setForm({ ...form, counts_in_average: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      <span className="text-sm text-gray-700">يدخل في حساب المعدل</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={form.appears_in_report_card} onChange={(e) => setForm({ ...form, appears_in_report_card: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      <span className="text-sm text-gray-700">يظهر في كارت النتيجة</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-100">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">إلغاء</button>
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg text-sm font-medium transition-colors">
                {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check size={18} />}
                <span>{modalMode === 'create' ? 'إضافة' : 'حفظ التغييرات'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
