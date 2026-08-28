import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { getStudents, getClasses, getSections, createStudent, updateStudent, archiveStudent } from '../../lib/api';
import { toArabicDigits } from '../../lib/arabicDigits';
import { ACADEMIC_MANAGEMENT_ROLES, hasRole } from '../../lib/rbac';
import {
  FINALIZED_STUDENT_PLACEMENT_MESSAGE,
  isStudentPlacementFinalized,
} from '../../lib/studentPlacementUx';
import { Search, Plus, Filter, Archive, Edit2, X, Check, User, Users } from 'lucide-react';

interface StudentRecord {
  id: number;
  school_id: number;
  student_number: string;
  full_name: string;
  father_name: string | null;
  mother_name: string | null;
  gender: 'male' | 'female';
  birth_date: string | null;
  phone: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  address: string | null;
  class_id: number | null;
  section_id: number | null;
  photo_url: string | null;
  notes: string | null;
  status: 'active' | 'inactive' | 'archived';
  created_at: string;
  updated_at: string;
  class_name?: string;
  section_name?: string;
  current_enrollment_status?: string | null;
  current_promotion_status?: string | null;
}

interface ClassRecord {
  id: number;
  name: string;
}

interface SectionRecord {
  id: number;
  name: string;
  class_id: number;
}

const emptyForm = {
  student_number: '',
  full_name: '',
  father_name: '',
  mother_name: '',
  gender: 'male' as 'male' | 'female',
  birth_date: '',
  phone: '',
  guardian_name: '',
  guardian_phone: '',
  address: '',
  class_id: '' as string | number,
  section_id: '' as string | number,
  notes: '',
};

export default function StudentsPage() {
  const { user } = useAuth();
  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);

  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [sections, setSections] = useState<SectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [filterClass, setFilterClass] = useState<string>('');
  const [filterSection, setFilterSection] = useState<string>('');
  const [filterGender, setFilterGender] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('active');
  const [showFilters, setShowFilters] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [placementFinalized, setPlacementFinalized] = useState(false);

  const canManage = hasRole(user?.role_key, ACADEMIC_MANAGEMENT_ROLES);
  const canManageSelectedSchool = canManage && schoolId != null;

  useEffect(() => {
    setStudents([]);
    setClasses([]);
    setSections([]);
    setFilterClass('');
    setFilterSection('');
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setLoading(false);
    setSaving(false);
    setError('');
    setFormError('');
    setPlacementFinalized(false);
    void loadData();
  }, [schoolId]);

  async function loadData() {
    const isCurrentRequest = captureSchoolRequest();
    if (schoolId == null) {
      setStudents([]);
      setClasses([]);
      setSections([]);
      setError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const [sRes, cRes, secRes] = await Promise.all([
      getStudents(schoolId),
      getClasses(schoolId),
      getSections(schoolId),
    ]);
    if (!isCurrentRequest()) return;
    if (sRes.data) setStudents(sRes.data as StudentRecord[]);
    else if (sRes.error) setError(sRes.error);
    if (cRes.data) setClasses(cRes.data as ClassRecord[]);
    if (secRes.data) setSections(secRes.data as SectionRecord[]);
    setLoading(false);
  }

  const filteredStudents = useMemo(() => {
    let list = students;
    if (filterStatus) list = list.filter((s) => s.status === filterStatus);
    if (filterClass) list = list.filter((s) => String(s.class_id) === filterClass);
    if (filterSection) list = list.filter((s) => String(s.section_id) === filterSection);
    if (filterGender) list = list.filter((s) => s.gender === filterGender);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.full_name.toLowerCase().includes(q) ||
          s.student_number.toLowerCase().includes(q) ||
          (s.father_name && s.father_name.toLowerCase().includes(q)) ||
          (s.guardian_name && s.guardian_name.toLowerCase().includes(q))
      );
    }
    return list;
  }, [students, search, filterClass, filterSection, filterGender, filterStatus]);

  function openCreate() {
    if (schoolId == null) return;
    setForm(emptyForm);
    setFormError('');
    setModalMode('create');
    setEditingId(null);
    setPlacementFinalized(false);
    setModalOpen(true);
  }

  function openEdit(s: StudentRecord) {
    if (schoolId == null) return;
    setForm({
      student_number: s.student_number,
      full_name: s.full_name,
      father_name: s.father_name || '',
      mother_name: s.mother_name || '',
      gender: s.gender,
      birth_date: s.birth_date || '',
      phone: s.phone || '',
      guardian_name: s.guardian_name || '',
      guardian_phone: s.guardian_phone || '',
      address: s.address || '',
      class_id: s.class_id || '',
      section_id: s.section_id || '',
      notes: s.notes || '',
    });
    setFormError('');
    setModalMode('edit');
    setEditingId(s.id);
    setPlacementFinalized(isStudentPlacementFinalized(
      s.current_enrollment_status,
      s.current_promotion_status,
    ));
    setModalOpen(true);
  }

  async function handleSave() {
    setFormError('');
    if (schoolId == null) { setFormError('يجب اختيار المدرسة المستهدفة أولاً'); return; }
    if (!form.student_number.trim() || !form.full_name.trim() || !form.gender) {
      setFormError('رقم الطالب والاسم الكامل والجنس مطلوبة');
      return;
    }
    const isCurrentRequest = captureSchoolRequest();
    setSaving(true);
    const payload = {
      school_id: schoolId,
      student_number: form.student_number.trim(),
      full_name: form.full_name.trim(),
      father_name: form.father_name.trim() || null,
      mother_name: form.mother_name.trim() || null,
      gender: form.gender,
      birth_date: form.birth_date || null,
      phone: form.phone.trim() || null,
      guardian_name: form.guardian_name.trim() || null,
      guardian_phone: form.guardian_phone.trim() || null,
      address: form.address.trim() || null,
      class_id: form.class_id ? Number(form.class_id) : null,
      section_id: form.section_id ? Number(form.section_id) : null,
      notes: form.notes.trim() || null,
    };
    if (modalMode === 'create') {
      const res = await createStudent(payload);
      if (!isCurrentRequest()) return;
      if (res.error) setFormError(res.error);
      else { setModalOpen(false); loadData(); }
    } else if (editingId != null) {
      const res = await updateStudent(editingId, { ...payload, status: 'active' });
      if (!isCurrentRequest()) return;
      if (res.error) setFormError(res.error);
      else { setModalOpen(false); loadData(); }
    }
    setSaving(false);
  }

  async function handleArchive(id: number) {
    if (schoolId == null) return;
    if (!confirm('هل أنت متأكد من أرشفة هذا الطالب؟')) return;
    const isCurrentRequest = captureSchoolRequest();
    const res = await archiveStudent(id, schoolId);
    if (!isCurrentRequest()) return;
    if (res.error) alert(res.error);
    else loadData();
  }

  const sectionsForClass = useMemo(() => {
    if (!form.class_id) return [];
    return sections.filter((sec) => String(sec.class_id) === String(form.class_id));
  }, [form.class_id, sections]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">الطلاب</h1>
          <p className="text-sm text-gray-500 mt-1">إدارة بيانات الطلاب والشؤون الأكاديمية</p>
        </div>
        {canManageSelectedSchool && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={18} />
            <span>إضافة طالب</span>
          </button>
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
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="البحث بالاسم أو الرقم أو اسم الأب/ولي الأمر..."
              className="w-full pr-10 pl-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
              showFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Filter size={18} />
            <span>التصفية</span>
          </button>
        </div>
        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3 pt-3 border-t border-gray-100">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="active">نشط</option>
              <option value="inactive">غير نشط</option>
              <option value="archived">مؤرشف</option>
              <option value="">الكل</option>
            </select>
            <select
              value={filterClass}
              onChange={(e) => { setFilterClass(e.target.value); setFilterSection(''); }}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">كل الصفوف</option>
              {classes.map((c) => (
                <option key={c.id} value={String(c.id)}>{c.name}</option>
              ))}
            </select>
            <select
              value={filterSection}
              onChange={(e) => setFilterSection(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">كل الشعب</option>
              {sections
                .filter((s) => !filterClass || String(s.class_id) === filterClass)
                .map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.name}</option>
                ))}
            </select>
            <select
              value={filterGender}
              onChange={(e) => setFilterGender(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">كل الأجناس</option>
              <option value="male">ذكر</option>
              <option value="female">أنثى</option>
            </select>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600">
            <Users size={20} />
          </div>
          <div>
            <p className="text-xs text-gray-500">إجمالي الطلاب</p>
            <p className="text-lg font-bold text-gray-900">{toArabicDigits(students.length)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center text-green-600">
            <User size={20} />
          </div>
          <div>
            <p className="text-xs text-gray-500">الطلاب النشطون</p>
            <p className="text-lg font-bold text-gray-900">{toArabicDigits(students.filter((s) => s.status === 'active').length)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center text-amber-600">
            <Archive size={20} />
          </div>
          <div>
            <p className="text-xs text-gray-500">المؤرشفون</p>
            <p className="text-lg font-bold text-gray-900">{toArabicDigits(students.filter((s) => s.status === 'archived').length)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center text-purple-600">
            <Users size={20} />
          </div>
          <div>
            <p className="text-xs text-gray-500">المعروضون</p>
            <p className="text-lg font-bold text-gray-900">{toArabicDigits(filteredStudents.length)}</p>
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
        ) : filteredStudents.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Search size={24} className="text-gray-400" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">لا توجد نتائج</h3>
            <p className="text-sm text-gray-500">جرب تغيير معايير البحث أو التصفية</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">#</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">الرقم</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">الاسم الكامل</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">الجنس</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">الصف</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">الشعبة</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">ولي الأمر</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">الحالة</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredStudents.map((s, idx) => (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-500">{toArabicDigits(idx + 1)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{toArabicDigits(s.student_number)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{s.full_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.gender === 'male' ? 'ذكر' : 'أنثى'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.class_name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.section_name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.guardian_name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                        s.status === 'active' ? 'bg-green-100 text-green-700' :
                        s.status === 'archived' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {s.status === 'active' ? 'نشط' : s.status === 'archived' ? 'مؤرشف' : 'غير نشط'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {canManageSelectedSchool && (
                          <>
                            <button onClick={() => openEdit(s)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="تعديل">
                              <Edit2 size={16} />
                            </button>
                            <button onClick={() => handleArchive(s.id)} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title="أرشفة">
                              <Archive size={16} />
                            </button>
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

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">
                {modalMode === 'create' ? 'إضافة طالب جديد' : 'تعديل بيانات الطالب'}
              </h2>
              <button onClick={() => setModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">رقم الطالب <span className="text-red-500">*</span></label>
                  <input
                    value={form.student_number}
                    onChange={(e) => setForm({ ...form, student_number: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الاسم الكامل <span className="text-red-500">*</span></label>
                  <input
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">اسم الأب</label>
                  <input
                    value={form.father_name}
                    onChange={(e) => setForm({ ...form, father_name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">اسم الأم</label>
                  <input
                    value={form.mother_name}
                    onChange={(e) => setForm({ ...form, mother_name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الجنس <span className="text-red-500">*</span></label>
                  <select
                    value={form.gender}
                    onChange={(e) => setForm({ ...form, gender: e.target.value as 'male' | 'female' })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="male">ذكر</option>
                    <option value="female">أنثى</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ الميلاد</label>
                  <input
                    type="date"
                    value={form.birth_date}
                    onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">رقم الهاتف</label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ولي الأمر</label>
                  <input
                    value={form.guardian_name}
                    onChange={(e) => setForm({ ...form, guardian_name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">هاتف ولي الأمر</label>
                  <input
                    value={form.guardian_phone}
                    onChange={(e) => setForm({ ...form, guardian_phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">العنوان</label>
                  <input
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {modalMode === 'edit' && placementFinalized && (
                  <div className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
                    {FINALIZED_STUDENT_PLACEMENT_MESSAGE}
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الصف</label>
                  <select
                    value={form.class_id}
                    onChange={(e) => setForm({ ...form, class_id: e.target.value, section_id: '' })}
                    disabled={placementFinalized}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    <option value="">— اختر الصف —</option>
                    {classes.map((c) => (
                      <option key={c.id} value={String(c.id)}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الشعبة</label>
                  <select
                    value={form.section_id}
                    onChange={(e) => setForm({ ...form, section_id: e.target.value })}
                    disabled={placementFinalized}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    <option value="">— اختر الشعبة —</option>
                    {sectionsForClass.map((sec) => (
                      <option key={sec.id} value={String(sec.id)}>{sec.name}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات</label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 border-t border-gray-100 bg-white">
              {formError && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                >
                  {formError}
                </div>
              )}
              <div className="flex items-center justify-end gap-3 p-6">
                <button onClick={() => setModalOpen(false)} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  إلغاء
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check size={18} />}
                  <span>{modalMode === 'create' ? 'إضافة' : 'حفظ التغييرات'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
