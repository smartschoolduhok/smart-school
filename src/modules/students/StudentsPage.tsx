import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { getStudents, getClasses, getSections, createStudent, updateStudent, archiveStudent, getResidentialAreas, createResidentialArea, getTransportLines } from '../../lib/api';
import { toArabicDigits } from '../../lib/arabicDigits';
import { ACADEMIC_ACCESS_ROLES, ACADEMIC_MANAGEMENT_ROLES, hasRole } from '../../lib/rbac';
import type { StudentReligion } from '../../lib/studentReligion';
import { STUDY_STATUS_LABELS, type StudyStatus } from '../../lib/studentStudyStatus';
import { useCurrentStudentStudyRoster } from './useCurrentStudentStudyRoster';
import { TRANSPORT_MODES, type ResidentialArea, type TransportLine, type TransportMode, type TransportStudentFields } from '../../lib/transport';
import {
  FINALIZED_STUDENT_PLACEMENT_MESSAGE,
  isStudentPlacementFinalized,
} from '../../lib/studentPlacementUx';
import { Search, Plus, Filter, Archive, Edit2, Eye, X, Check, User, Users, CalendarSearch, Printer } from 'lucide-react';

interface StudentRecord extends TransportStudentFields {
  id: number;
  school_id: number;
  student_number: string;
  full_name: string;
  father_name: string | null;
  mother_name: string | null;
  gender: 'male' | 'female' | 'unknown';
  religion: StudentReligion | null;
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
  gender: 'male' as 'male' | 'female' | 'unknown',
  religion: '' as '' | StudentReligion,
  birth_date: '',
  phone: '',
  guardian_name: '',
  guardian_phone: '',
  guardian_phone_secondary: '',
  address: '',
  residential_area_id: '' as string | number,
  pickup_landmark: '',
  transport_to_school: 'unspecified' as TransportMode,
  transport_from_school: 'unspecified' as TransportMode,
  transport_to_school_line_id: '' as string | number,
  transport_from_school_line_id: '' as string | number,
  private_driver_name: '',
  private_driver_phone: '',
  class_id: '' as string | number,
  section_id: '' as string | number,
  notes: '',
};

export default function StudentsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);

  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [sections, setSections] = useState<SectionRecord[]>([]);
  const [residentialAreas, setResidentialAreas] = useState<ResidentialArea[]>([]);
  const [transportLines, setTransportLines] = useState<TransportLine[]>([]);
  const [transportOptionsError, setTransportOptionsError] = useState('');
  const [loadedSchoolId, setLoadedSchoolId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [filterClass, setFilterClass] = useState<string>('');
  const [filterSection, setFilterSection] = useState<string>('');
  const [filterGender, setFilterGender] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('active');
  const [filterStudyStatus, setFilterStudyStatus] = useState<StudyStatus | ''>('');
  const [showFilters, setShowFilters] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [placementFinalized, setPlacementFinalized] = useState(false);
  const [newAreaName, setNewAreaName] = useState('');
  const [addingArea, setAddingArea] = useState(false);
  const modalSessionRef = useRef(0);

  const canManage = hasRole(user?.role_key, ACADEMIC_MANAGEMENT_ROLES);
  const canManageSelectedSchool = canManage && schoolId != null;
  const canBrowseAcademicCatalog = hasRole(user?.role_key, ACADEMIC_ACCESS_ROLES);
  const isParent = user?.role_key === 'parent';
  const isFinanceDirectory = user?.role_key === 'accountant';
  const studyRoster = useCurrentStudentStudyRoster(schoolId, canManage);
  const studyStatuses = useMemo(() => new Map(studyRoster.data?.rows.map(row => [row.student_id, row]) || []), [studyRoster.data]);
  const rosterQuery = new URLSearchParams({school_id: String(schoolId), academic_year_id: String(studyRoster.data?.academic_year.id || '')});
  if (filterClass) rosterQuery.set('class_id', filterClass);
  if (filterSection) rosterQuery.set('section_id', filterSection);
  if (filterStudyStatus) rosterQuery.set('study_status', filterStudyStatus);

  useEffect(() => {
    setStudents([]);
    setClasses([]);
    setSections([]);
    setResidentialAreas([]);
    setTransportLines([]);
    setTransportOptionsError('');
    setLoadedSchoolId(null);
    setFilterClass('');
    setFilterSection('');
    setFilterStudyStatus('');
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setLoading(false);
    setSaving(false);
    setError('');
    setFormError('');
    setPlacementFinalized(false);
    setNewAreaName('');
    setAddingArea(false);
    modalSessionRef.current += 1;
    void loadData();
    return () => { modalSessionRef.current += 1; };
  }, [schoolId]);

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId || !canManageSelectedSchool || loading || loadedSchoolId !== schoolId) return;
    const target = students.find(student => String(student.id) === editId && student.school_id === schoolId);
    if (target) openEdit(target);
    else setError('تعذر العثور على الطالب المطلوب في المدرسة المحددة');
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('edit');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, students, loading, loadedSchoolId, schoolId, canManageSelectedSchool]);

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
    const [sRes, cRes, secRes, areasRes, linesRes] = await Promise.all([
      getStudents(schoolId),
      canBrowseAcademicCatalog ? getClasses(schoolId) : Promise.resolve({ data: [] as ClassRecord[] }),
      canBrowseAcademicCatalog ? getSections(schoolId) : Promise.resolve({ data: [] as SectionRecord[] }),
      canManage ? getResidentialAreas(schoolId) : Promise.resolve({ data: [] as ResidentialArea[], error: undefined }),
      canManage ? getTransportLines(schoolId) : Promise.resolve({ data: [] as TransportLine[], error: undefined }),
    ]);
    if (!isCurrentRequest()) return;
    if (sRes.data) { setStudents(sRes.data as StudentRecord[]); setLoadedSchoolId(schoolId); }
    else if (sRes.error) setError(sRes.error);
    if (cRes.data) setClasses(cRes.data as ClassRecord[]);
    if (secRes.data) setSections(secRes.data as SectionRecord[]);
    if (areasRes.data) setResidentialAreas(areasRes.data);
    if (linesRes.data) setTransportLines(linesRes.data);
    setTransportOptionsError(areasRes.error || linesRes.error || '');
    setLoading(false);
  }

  const filteredStudents = useMemo(() => {
    let list = students;
    if (filterStatus) list = list.filter((s) => s.status === filterStatus);
    if (filterClass) list = list.filter((s) => String(s.class_id) === filterClass);
    if (filterSection) list = list.filter((s) => String(s.section_id) === filterSection);
    if (canManage && filterStudyStatus) list = studyRoster.data ? list.filter(s => (studyStatuses.get(s.id)?.study_status || 'regular') === filterStudyStatus) : [];
    if (!isFinanceDirectory && filterGender) list = list.filter((s) => s.gender === filterGender);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.full_name.toLowerCase().includes(q) ||
          s.student_number.toLowerCase().includes(q) ||
          (!isFinanceDirectory && (
            (s.father_name && s.father_name.toLowerCase().includes(q)) ||
            (s.guardian_name && s.guardian_name.toLowerCase().includes(q))
          ))
      );
    }
    return list;
  }, [students, search, filterClass, filterSection, filterGender, filterStatus, isFinanceDirectory, canManage, filterStudyStatus, studyStatuses, studyRoster.data]);

  const availableClasses = useMemo(() => {
    if (!isFinanceDirectory) return classes;
    const unique = new Map<number, ClassRecord>();
    for (const student of students) {
      if (student.class_id == null) continue;
      unique.set(student.class_id, {
        id: student.class_id,
        name: student.class_name?.trim() || `#${toArabicDigits(student.class_id)}`,
      });
    }
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [classes, isFinanceDirectory, students]);

  const availableSections = useMemo(() => {
    if (!isFinanceDirectory) return sections;
    const unique = new Map<number, SectionRecord>();
    for (const student of students) {
      if (student.section_id == null || student.class_id == null) continue;
      unique.set(student.section_id, {
        id: student.section_id,
        class_id: student.class_id,
        name: student.section_name?.trim() || `#${toArabicDigits(student.section_id)}`,
      });
    }
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [isFinanceDirectory, sections, students]);

  function openCreate() {
    if (!canManageSelectedSchool) return;
    modalSessionRef.current += 1;
    setNewAreaName('');
    setAddingArea(false);
    setSaving(false);
    setForm(emptyForm);
    setFormError('');
    setModalMode('create');
    setEditingId(null);
    setPlacementFinalized(false);
    setModalOpen(true);
  }

  function openEdit(s: StudentRecord) {
    if (!canManageSelectedSchool || s.school_id !== schoolId) return;
    modalSessionRef.current += 1;
    setNewAreaName('');
    setAddingArea(false);
    setSaving(false);
    setForm({
      student_number: s.student_number,
      full_name: s.full_name,
      father_name: s.father_name || '',
      mother_name: s.mother_name || '',
      gender: s.gender,
      religion: s.religion || '',
      birth_date: s.birth_date || '',
      phone: s.phone || '',
      guardian_name: s.guardian_name || '',
      guardian_phone: s.guardian_phone || '',
      guardian_phone_secondary: s.guardian_phone_secondary || '',
      address: s.address || '',
      residential_area_id: s.residential_area_id || '',
      pickup_landmark: s.pickup_landmark || '',
      transport_to_school: s.transport_to_school || 'unspecified',
      transport_from_school: s.transport_from_school || 'unspecified',
      transport_to_school_line_id: s.transport_to_school_line_id || '',
      transport_from_school_line_id: s.transport_from_school_line_id || '',
      private_driver_name: s.private_driver_name || '',
      private_driver_phone: s.private_driver_phone || '',
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

  function closeModal() {
    modalSessionRef.current += 1;
    setModalOpen(false);
  }

  async function handleAddArea() {
    if (schoolId == null || !newAreaName.trim() || addingArea || saving) return;
    const isCurrentRequest = captureSchoolRequest();
    const modalSession = modalSessionRef.current;
    setAddingArea(true);
    setFormError('');
    const response = await createResidentialArea(schoolId, newAreaName.trim());
    if (!isCurrentRequest() || modalSession !== modalSessionRef.current) return;
    if (response.error) setFormError(response.error);
    else if (response.data) {
      const area = response.data;
      setResidentialAreas(current => [...current.filter(item => item.id !== area.id), area].sort((a, b) => a.name.localeCompare(b.name, 'ar')));
      setForm(current => ({ ...current, residential_area_id: area.id }));
      setNewAreaName('');
    }
    setAddingArea(false);
  }

  async function handleSave() {
    if (saving || addingArea || !canManageSelectedSchool) return;
    setFormError('');
    if (schoolId == null) { setFormError('يجب اختيار المدرسة المستهدفة أولاً'); return; }
    if (!form.student_number.trim() || !form.full_name.trim() || !form.gender) {
      setFormError('رقم الطالب والاسم الكامل والجنس مطلوبة');
      return;
    }
    if (modalMode === 'create' && (!form.residential_area_id || !form.guardian_phone.trim())) {
      setFormError('منطقة السكن وهاتف ولي الأمر مطلوبان للطالب الجديد');
      return;
    }
    const isCurrentRequest = captureSchoolRequest();
    const modalSession = modalSessionRef.current;
    setSaving(true);
    const payload = {
      school_id: schoolId,
      student_number: form.student_number.trim(),
      full_name: form.full_name.trim(),
      father_name: form.father_name.trim() || null,
      mother_name: form.mother_name.trim() || null,
      gender: form.gender,
      religion: form.religion || null,
      birth_date: form.birth_date || null,
      phone: form.phone.trim() || null,
      guardian_name: form.guardian_name.trim() || null,
      guardian_phone: form.guardian_phone.trim() || null,
      guardian_phone_secondary: form.guardian_phone_secondary.trim() || null,
      address: form.address.trim() || null,
      residential_area_id: form.residential_area_id ? Number(form.residential_area_id) : null,
      pickup_landmark: form.pickup_landmark.trim() || null,
      transport_to_school: form.transport_to_school,
      transport_from_school: form.transport_from_school,
      transport_to_school_line_id: form.transport_to_school === 'school' && form.transport_to_school_line_id ? Number(form.transport_to_school_line_id) : null,
      transport_from_school_line_id: form.transport_from_school === 'school' && form.transport_from_school_line_id ? Number(form.transport_from_school_line_id) : null,
      private_driver_name: form.private_driver_name.trim() || null,
      private_driver_phone: form.private_driver_phone.trim() || null,
      class_id: form.class_id ? Number(form.class_id) : null,
      section_id: form.section_id ? Number(form.section_id) : null,
      notes: form.notes.trim() || null,
    };
    if (modalMode === 'create') {
      const res = await createStudent(payload);
      if (!isCurrentRequest() || modalSession !== modalSessionRef.current) return;
      if (res.error) setFormError(res.error);
      else { setModalOpen(false); loadData(); }
    } else if (editingId != null) {
      const res = await updateStudent(editingId, payload);
      if (!isCurrentRequest() || modalSession !== modalSessionRef.current) return;
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
  const activeFilterCount = [filterClass, filterSection, filterGender, filterStudyStatus, filterStatus !== 'active'].filter(Boolean).length;
  const resetFilters = () => { setFilterClass(''); setFilterSection(''); setFilterGender(''); setFilterStudyStatus(''); setFilterStatus('active'); };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isParent ? 'أبنائي' : isFinanceDirectory ? 'دليل الطلاب المالي' : 'الطلاب'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {isParent
              ? 'عرض ملفات الأبناء المرتبطين بحسابك'
              : isFinanceDirectory
                ? 'بيانات التعريف اللازمة لمتابعة الشؤون المالية'
                : 'إدارة بيانات الطلاب والشؤون الأكاديمية'}
          </p>
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
          <div className="relative w-full min-w-0 sm:w-auto sm:flex-1 sm:min-w-[220px]">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              aria-label="البحث عن الطلاب"
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isFinanceDirectory
                ? 'البحث بالاسم أو رقم الطالب...'
                : 'البحث بالاسم أو الرقم أو اسم الأب/ولي الأمر...'}
              className="w-full pr-10 pl-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            aria-expanded={showFilters}
            aria-controls="student-directory-filters"
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
              showFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Filter size={18} />
            <span>التصفية</span>
            {activeFilterCount > 0 && <span className="rounded-full bg-blue-100 px-1.5 text-xs text-blue-800" aria-label={`${activeFilterCount} مرشحات نشطة`}>{toArabicDigits(activeFilterCount)}</span>}
          </button>
          {canManage && <label className="flex items-center gap-2 text-sm text-gray-700">نوع الدراسة<select aria-label="تصفية نوع الدراسة" className="rounded-lg border border-gray-200 p-2 text-sm" disabled={!studyRoster.data} value={filterStudyStatus} onChange={event => setFilterStudyStatus(event.target.value as StudyStatus | '')}><option value="">الكل</option>{Object.entries(STUDY_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          {activeFilterCount > 0 && <button type="button" className="flex items-center gap-1 rounded-lg px-2 py-2 text-xs text-gray-600 hover:bg-gray-50" onClick={resetFilters}><X size={14} /> مسح التصفية</button>}
        </div>
        {showFilters && (
          <div id="student-directory-filters" className={`grid grid-cols-1 sm:grid-cols-2 ${isFinanceDirectory ? 'lg:grid-cols-3' : 'lg:grid-cols-4'} gap-3 mt-3 pt-3 border-t border-gray-100`}>
            <select
              aria-label="تصفية حالة الطالب"
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
              aria-label="تصفية الصف"
              value={filterClass}
              onChange={(e) => { setFilterClass(e.target.value); setFilterSection(''); }}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">كل الصفوف</option>
              {availableClasses.map((c) => (
                <option key={c.id} value={String(c.id)}>{c.name}</option>
              ))}
            </select>
            <select
              aria-label="تصفية الشعبة"
              value={filterSection}
              onChange={(e) => setFilterSection(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">كل الشعب</option>
              {availableSections
                .filter((s) => !filterClass || String(s.class_id) === filterClass)
                .map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.name}</option>
                ))}
            </select>
            {!isFinanceDirectory && (
              <select
                aria-label="تصفية الجنس"
                value={filterGender}
                onChange={(e) => setFilterGender(e.target.value)}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">كل الأجناس</option>
                <option value="male">ذكر</option>
                <option value="female">أنثى</option>
                <option value="unknown">غير محدد</option>
              </select>
            )}
          </div>
        )}
        {canManageSelectedSchool && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3 text-xs">
          <div className="text-gray-500"><p>نوع الدراسة في السنة الحالية {studyRoster.data && <bdi className="font-medium text-gray-700">{studyRoster.data.academic_year.name}</bdi>}</p>
            {studyRoster.loading && <p role="status" className="mt-1">جاري تحميل الوضع الدراسي…</p>}
            {studyRoster.error && <p role="alert" className="mt-1 text-red-700">{studyRoster.error} <button onClick={studyRoster.reload} className="underline">إعادة المحاولة</button></p>}
          </div>
          <nav aria-label="أدوات الطلاب" className="flex flex-wrap items-center gap-2">
            <Link to="/student-age-review" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 font-medium text-gray-600 hover:bg-gray-50 hover:text-blue-700"><CalendarSearch size={15} /> مراجعة أعمار الطلاب</Link>
            {studyRoster.data && <Link to={`/print/student-roster?${rosterQuery}`} title="تشمل التسجيلات السنوية النشطة والدرجات المخفية. يمكن اختيار سنة أخرى من المعاينة." className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 font-medium text-gray-700 hover:bg-gray-50"><Printer size={15} /><span>معاينة قائمة التوزيع</span></Link>}
          </nav>
        </div>}
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
                  {!isFinanceDirectory && <th className="px-4 py-3 text-xs font-semibold text-gray-600">#</th>}
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">{isFinanceDirectory ? 'رقم الطالب' : 'الرقم'}</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">{isFinanceDirectory ? 'الاسم' : 'الاسم الكامل'}</th>
                  {!isFinanceDirectory && <th className="px-4 py-3 text-xs font-semibold text-gray-600">الجنس</th>}
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">الصف</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">الشعبة</th>
                  {!isFinanceDirectory && <th className="px-4 py-3 text-xs font-semibold text-gray-600">ولي الأمر</th>}
                  {!isFinanceDirectory && <th className="px-4 py-3 text-xs font-semibold text-gray-600">منطقة السكن</th>}
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">الحالة</th>
                  {canManage && <th className="px-4 py-3 text-xs font-semibold text-gray-600">نوع الدراسة — السنة الحالية</th>}
                  {!isFinanceDirectory && <th className="px-4 py-3 text-xs font-semibold text-gray-600">الإجراءات</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredStudents.map((s, idx) => (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                    {!isFinanceDirectory && <td className="px-4 py-3 text-sm text-gray-500">{toArabicDigits(idx + 1)}</td>}
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      <bdi dir="ltr">{s.student_number}</bdi>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {isFinanceDirectory ? (
                        <Link to={`/students/${s.id}/finance`} className="text-blue-700 hover:text-blue-900 hover:underline">
                          {s.full_name}
                        </Link>
                      ) : (
                        <Link to={`/students/${s.id}`} className="text-blue-700 hover:text-blue-900 hover:underline">
                          {s.full_name}
                        </Link>
                      )}
                    </td>
                    {!isFinanceDirectory && <td className="px-4 py-3 text-sm text-gray-600">{s.gender === 'male' ? 'ذكر' : s.gender === 'female' ? 'أنثى' : 'غير محدد'}</td>}
                    <td className="px-4 py-3 text-sm text-gray-600">{s.class_name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.section_name || '—'}</td>
                    {!isFinanceDirectory && <td className="px-4 py-3 text-sm text-gray-600">
                      <p>{s.guardian_name || '—'}</p>
                      {s.guardian_phone ? <bdi dir="ltr" className="text-xs">{s.guardian_phone}</bdi> : <span className="text-xs text-amber-700">هاتف ولي الأمر غير مكتمل</span>}
                    </td>}
                    {!isFinanceDirectory && <td className="px-4 py-3 text-sm text-gray-600">
                      {s.residential_area_name || <span className="text-xs text-amber-700">منطقة السكن غير محددة</span>}
                    </td>}
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                        s.status === 'active' ? 'bg-green-100 text-green-700' :
                        s.status === 'archived' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {s.status === 'active' ? 'نشط' : s.status === 'archived' ? 'مؤرشف' : 'غير نشط'}
                      </span>
                    </td>
                    {canManage && <td className="px-4 py-3 text-sm"><span className="inline-flex rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">{studyRoster.data ? STUDY_STATUS_LABELS[studyStatuses.get(s.id)?.study_status || 'regular'] : 'غير متاح'}</span>{studyRoster.data && studyStatuses.get(s.id)?.grades_visible === false && <span className="mt-1 block text-xs text-gray-500">الدرجات مخفية</span>}</td>}
                    {!isFinanceDirectory && <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/students/${s.id}`}
                          className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                          title="عرض الملف"
                          aria-label={`عرض ملف ${s.full_name}`}
                        >
                          <Eye size={16} />
                        </Link>
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
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="student-editor-title">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 id="student-editor-title" className="text-xl font-bold text-gray-900">
                {modalMode === 'create' ? 'إضافة طالب جديد' : 'تعديل بيانات الطالب'}
              </h2>
              <button onClick={closeModal} disabled={saving || addingArea} aria-label="إغلاق نموذج الطالب" className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 disabled:opacity-50">
                <X size={20} />
              </button>
            </div>
            <fieldset disabled={saving} className="p-6 space-y-4">
              {modalMode === 'edit' && (!form.residential_area_id || !form.guardian_phone.trim()) && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  بيانات السكن والتواصل غير مكتملة. يرجى تحديد منطقة السكن وإضافة هاتف ولي الأمر لتجهيز قوائم النقل.
                </p>
              )}
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
                    onChange={(e) => setForm({ ...form, gender: e.target.value as 'male' | 'female' | 'unknown' })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="male">ذكر</option>
                    <option value="female">أنثى</option>
                    {modalMode === 'edit' && form.gender === 'unknown' && <option value="unknown">غير محدد</option>}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الديانة</label>
                  <select
                    value={form.religion}
                    onChange={(e) => setForm({ ...form, religion: e.target.value as '' | StudentReligion })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">غير محدد</option>
                    <option value="muslim">مسلم</option>
                    <option value="christian">مسيحي</option>
                    <option value="other">أخرى</option>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">هاتف ولي الأمر {modalMode === 'create' && <span className="text-red-500">*</span>}</label>
                  <input
                    value={form.guardian_phone}
                    onChange={(e) => setForm({ ...form, guardian_phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    type="tel"
                    dir="ltr"
                    aria-required={modalMode === 'create'}
                  />
                </div>
                <div>
                  <label htmlFor="guardian-phone-secondary" className="block text-sm font-medium text-gray-700 mb-1">هاتف إضافي لولي الأمر (اختياري)</label>
                  <input
                    id="guardian-phone-secondary"
                    type="tel"
                    dir="ltr"
                    value={form.guardian_phone_secondary}
                    onChange={(event) => setForm({ ...form, guardian_phone_secondary: event.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="residential-area" className="block text-sm font-medium text-gray-700 mb-1">منطقة السكن {modalMode === 'create' && <span className="text-red-500">*</span>}</label>
                  <select
                    id="residential-area"
                    value={form.residential_area_id}
                    onChange={(event) => setForm({ ...form, residential_area_id: event.target.value })}
                    disabled={loading || addingArea || !!transportOptionsError}
                    aria-required={modalMode === 'create'}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                  >
                    <option value="">— اختر منطقة السكن —</option>
                    {form.residential_area_id && !residentialAreas.some(area => area.id === Number(form.residential_area_id)) && (
                      <option value={form.residential_area_id}>{students.find(student => student.id === editingId)?.residential_area_name || 'منطقة الطالب الحالية'}</option>
                    )}
                    {residentialAreas.map(area => <option key={area.id} value={area.id}>{area.name}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="new-residential-area" className="block text-xs font-medium text-gray-500 mb-1">المنطقة غير موجودة؟ أضفها إلى قائمة المدرسة</label>
                  <div className="flex gap-2">
                    <input
                      id="new-residential-area"
                      value={newAreaName}
                      onChange={(event) => setNewAreaName(event.target.value)}
                      disabled={addingArea || loading || !!transportOptionsError}
                      placeholder="اسم منطقة السكن"
                      className="min-w-0 flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    />
                    <button type="button" onClick={() => void handleAddArea()} disabled={!newAreaName.trim() || addingArea || loading || !!transportOptionsError} className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                      {addingArea ? 'جاري الإضافة...' : 'إضافة المنطقة'}
                    </button>
                  </div>
                </div>
                {transportOptionsError && (
                  <div className="sm:col-span-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
                    <p>تعذر تحميل مناطق السكن أو خطوط النقل: {transportOptionsError}</p>
                    <button type="button" onClick={() => void loadData()} disabled={loading} className="mt-2 font-semibold underline">إعادة المحاولة</button>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">العنوان التفصيلي</label>
                  <input
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="pickup-landmark" className="block text-sm font-medium text-gray-700 mb-1">أقرب نقطة دالة / نقطة الالتقاء</label>
                  <input
                    id="pickup-landmark"
                    value={form.pickup_landmark}
                    onChange={(event) => setForm({ ...form, pickup_landmark: event.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="sm:col-span-2 border-t border-gray-100 pt-4">
                  <h3 className="font-semibold text-gray-900">طريقة النقل</h3>
                  <p className="mt-1 text-xs text-gray-500">حدد طريقة الذهاب والإياب بشكل مستقل، مثلاً الذهاب باشتراك المدرسة والإياب مع الأهل.</p>
                </div>
                {([
                  { mode: 'transport_to_school', line: 'transport_to_school_line_id', label: 'الذهاب إلى المدرسة' },
                  { mode: 'transport_from_school', line: 'transport_from_school_line_id', label: 'الإياب من المدرسة' },
                ] as const).map(direction => (
                  <div key={direction.mode} className="space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <div>
                      <label htmlFor={direction.mode} className="block text-sm font-medium text-gray-700 mb-1">{direction.label}</label>
                      <select
                        id={direction.mode}
                        value={form[direction.mode]}
                        onChange={(event) => setForm(current => ({ ...current, [direction.mode]: event.target.value as TransportMode, [direction.line]: event.target.value === 'school' ? current[direction.line] : '' }))}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {TRANSPORT_MODES.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                      </select>
                    </div>
                    {form[direction.mode] === 'school' && (
                      <div>
                        <label htmlFor={direction.line} className="block text-sm font-medium text-gray-700 mb-1">خط النقل / صاحب الاشتراك</label>
                        <select
                          id={direction.line}
                          value={form[direction.line]}
                          onChange={(event) => setForm({ ...form, [direction.line]: event.target.value })}
                          disabled={loading || !!transportOptionsError}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                        >
                          <option value="">لم يُحدد الخط بعد</option>
                          {form[direction.line] && !transportLines.some(line => line.id === Number(form[direction.line])) && <option value={form[direction.line]}>خط الطالب الحالي</option>}
                          {transportLines.map(line => <option key={line.id} value={line.id}>{line.name}{line.driver_name ? ` — ${line.driver_name}` : ''}</option>)}
                        </select>
                        {transportLines.length === 0 && !loading && !transportOptionsError && <p className="mt-1 text-xs text-gray-500">يمكن إنشاء خطوط النقل من صفحة اشتراكات النقل ثم ربط الطالب بها.</p>}
                      </div>
                    )}
                  </div>
                ))}
                {(form.transport_to_school === 'private' || form.transport_from_school === 'private') && (
                  <>
                    <div>
                      <label htmlFor="private-driver-name" className="block text-sm font-medium text-gray-700 mb-1">اسم سائق الاشتراك الخاص (اختياري)</label>
                      <input id="private-driver-name" value={form.private_driver_name} onChange={(event) => setForm({ ...form, private_driver_name: event.target.value })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label htmlFor="private-driver-phone" className="block text-sm font-medium text-gray-700 mb-1">هاتف سائق الاشتراك الخاص (اختياري)</label>
                      <input id="private-driver-phone" type="tel" dir="ltr" value={form.private_driver_phone} onChange={(event) => setForm({ ...form, private_driver_phone: event.target.value })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </>
                )}
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
            </fieldset>
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
                <button onClick={closeModal} disabled={saving || addingArea} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50">
                  إلغاء
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || addingArea || loading}
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
