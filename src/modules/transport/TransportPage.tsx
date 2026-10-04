import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AlertTriangle, Bus, Check, Edit2, MapPin, Plus, Printer, RefreshCw, Search, Settings2, X } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import {
  assignTransportLine, createResidentialArea, createTransportLine, getResidentialAreas,
  getTransportLines, getTransportRoster, updateResidentialArea, updateTransportLine,
} from '../../lib/api';
import { TRANSPORT_MANAGEMENT_ROLES, hasRole } from '../../lib/rbac';
import {
  TRANSPORT_MODES, getTransportMissingFields, groupTransportStudents, matchesTransportFilter, schoolSubscriptionLabel, transportModeLabel,
  type ResidentialArea, type TransportLine, type TransportMode, type TransportRosterStudent,
} from '../../lib/transport';
import { toArabicDigits } from '../../lib/arabicDigits';
import './transportPrint.css';

type Direction = 'any' | 'to_school' | 'from_school';
type AssignmentDirection = Exclude<Direction, 'any'> | 'both';
type AreaGroup = { key: string; name: string; students: TransportRosterStudent[] };
type Editor = { kind: 'area' | 'line'; id: number | null; name: string; driver_name: string; driver_phone: string };
const PAGE_SIZE = 50;
const ASSIGNMENT_LIMIT = 100;
const inputClass = 'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';
const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50';

function areaKey(student: TransportRosterStudent): string {
  return student.residential_area_id == null ? 'unassigned' : String(student.residential_area_id);
}

function tripMode(student: TransportRosterStudent, direction: Exclude<Direction, 'any'>): TransportMode {
  return (direction === 'to_school' ? student.transport_to_school : student.transport_from_school) || 'unspecified';
}

function tripLineId(student: TransportRosterStudent, direction: Exclude<Direction, 'any'>): number | null {
  return (direction === 'to_school' ? student.transport_to_school_line_id : student.transport_from_school_line_id) ?? null;
}

function tripText(student: TransportRosterStudent, direction: Exclude<Direction, 'any'>): string {
  const mode = tripMode(student, direction);
  const lineName = direction === 'to_school' ? student.transport_to_school_line_name : student.transport_from_school_line_name;
  return `${transportModeLabel(mode)}${mode === 'school' ? ` — ${lineName || 'لم يُحدد الخط'}` : ''}`;
}

function ContactNumbers({ student }: { student: TransportRosterStudent }) {
  return <div className="space-y-1">
    <div><bdi dir="ltr">{student.guardian_phone || 'غير مسجل'}</bdi></div>
    {student.guardian_phone_secondary && <div><bdi dir="ltr">{student.guardian_phone_secondary}</bdi><span className="text-xs"> (إضافي)</span></div>}
  </div>;
}

export default function TransportPage() {
  const { user } = useAuth();
  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const requestSequence = useRef(0);
  const [loadedSchoolId, setLoadedSchoolId] = useState<number | null>(null);
  const [loadedSchoolName, setLoadedSchoolName] = useState('');
  const [students, setStudents] = useState<TransportRosterStudent[]>([]);
  const [areas, setAreas] = useState<ResidentialArea[]>([]);
  const [lines, setLines] = useState<TransportLine[]>([]);
  const [academicYear, setAcademicYear] = useState<{ id: number; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedAreas, setSelectedAreas] = useState<Set<string>>(new Set());
  const [modeFilter, setModeFilter] = useState<TransportMode | 'all'>('school');
  const [directionFilter, setDirectionFilter] = useState<Direction>('any');
  const [lineFilter, setLineFilter] = useState('');
  const [search, setSearch] = useState('');
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [selectedStudents, setSelectedStudents] = useState<Set<number>>(new Set());
  const [assignmentLine, setAssignmentLine] = useState('');
  const [assignmentDirection, setAssignmentDirection] = useState<AssignmentDirection>('both');
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorError, setEditorError] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [page, setPage] = useState(1);
  const canManage = hasRole(user?.role_key, TRANSPORT_MANAGEMENT_ROLES);
  const ready = schoolId != null && loadedSchoolId === schoolId && !loading;
  const schoolName = (loadedSchoolId === schoolId ? loadedSchoolName : '') || schoolScope.schools.find((school) => school.id === schoolId)?.name || user?.school_name || 'المدرسة';

  useEffect(() => {
    setLoadedSchoolId(null);
    setLoadedSchoolName('');
    setStudents([]);
    setAreas([]);
    setLines([]);
    setAcademicYear(null);
    setSelectedAreas(new Set());
    setSelectedStudents(new Set());
    setModeFilter('school');
    setDirectionFilter('any');
    setLineFilter('');
    setSearch('');
    setIncompleteOnly(false);
    setAssignmentLine('');
    setAssignmentDirection('both');
    setEditor(null);
    setEditorError('');
    setManageOpen(false);
    setPreviewOpen(false);
    setSaving(false);
    setNotice('');
    setPage(1);
    void loadData();
    return () => { requestSequence.current += 1; };
  }, [schoolId]);

  useEffect(() => {
    setPage(1);
    setSelectedStudents(new Set());
    setNotice('');
  }, [selectedAreas, modeFilter, directionFilter, lineFilter, search, incompleteOnly]);

  useEffect(() => {
    if (!previewOpen || !ready) return;
    document.body.classList.add('transport-print-mode');
    const previousOverflow = document.body.style.overflow;
    const previousTitle = document.title;
    document.title = `قوائم النقل - ${schoolName}`;
    document.body.style.overflow = 'hidden';
    const escapePreview = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreviewOpen(false); };
    document.addEventListener('keydown', escapePreview);
    return () => {
      document.body.classList.remove('transport-print-mode');
      document.body.style.overflow = previousOverflow;
      document.title = previousTitle;
      document.removeEventListener('keydown', escapePreview);
    };
  }, [previewOpen, ready, schoolName]);

  async function loadData() {
    const isCurrentSchool = captureSchoolRequest();
    const sequence = ++requestSequence.current;
    setError('');
    if (schoolId == null) { setLoading(false); return; }
    setLoading(true);
    try {
      const [rosterResponse, areasResponse, linesResponse] = await Promise.all([
        getTransportRoster(schoolId), getResidentialAreas(schoolId), getTransportLines(schoolId),
      ]);
      if (!isCurrentSchool() || sequence !== requestSequence.current) return;
      const loadError = rosterResponse.error || areasResponse.error || linesResponse.error;
      if (loadError || !rosterResponse.data || !areasResponse.data || !linesResponse.data) {
        setLoadedSchoolId(null);
        setError(loadError || 'تعذر تحميل بيانات النقل. أعد المحاولة.');
        return;
      }
      setStudents(rosterResponse.data.students);
      setLoadedSchoolName(rosterResponse.data.school_name || '');
      setAcademicYear(rosterResponse.data.academic_year);
      setAreas(areasResponse.data);
      setLines(linesResponse.data);
      setLoadedSchoolId(schoolId);
    } catch {
      if (isCurrentSchool() && sequence === requestSequence.current) {
        setLoadedSchoolId(null);
        setError('تعذر الاتصال بالخادم. أعد المحاولة.');
      }
    } finally {
      if (isCurrentSchool() && sequence === requestSequence.current) setLoading(false);
    }
  }

  const areaGroups = useMemo(() => {
    const groups = new Map<string, AreaGroup>(areas.map((area) => [String(area.id), { key: String(area.id), name: area.name, students: [] }]));
    groups.set('unassigned', { key: 'unassigned', name: 'لم تُحدد منطقة السكن', students: [] });
    for (const student of students) {
      const key = areaKey(student);
      if (!groups.has(key)) groups.set(key, { key, name: student.residential_area_name || 'منطقة غير معروفة', students: [] });
      groups.get(key)!.students.push(student);
    }
    return [...groups.values()].sort((a, b) => a.key === 'unassigned' ? 1 : b.key === 'unassigned' ? -1 : a.name.localeCompare(b.name, 'ar'));
  }, [areas, students]);

  const filteredStudents = useMemo(() => students.filter((student) => {
    if (!selectedAreas.has(areaKey(student))) return false;
    if (incompleteOnly && getTransportMissingFields(student).length === 0) return false;
    const query = search.trim().toLocaleLowerCase('ar');
    if (query && ![student.full_name, student.guardian_phone, student.guardian_phone_secondary, student.address, student.pickup_landmark]
      .some((value) => value?.toLocaleLowerCase('ar').includes(query))) return false;
    return matchesTransportFilter(student, { mode: modeFilter, direction: directionFilter, lineId: lineFilter ? Number(lineFilter) : null });
  }).sort((a, b) => (a.residential_area_name || '').localeCompare(b.residential_area_name || '', 'ar') || a.full_name.localeCompare(b.full_name, 'ar')),
  [students, selectedAreas, incompleteOnly, search, modeFilter, directionFilter, lineFilter]);

  const printGroups = useMemo(() => groupTransportStudents(filteredStudents).map((area) => ({ ...area, key: area.areaId == null ? 'unassigned' : String(area.areaId) })), [filteredStudents]);
  const incompleteCount = filteredStudents.filter((student) => getTransportMissingFields(student).length > 0).length;
  const allIncompleteCount = students.filter((student) => getTransportMissingFields(student).length > 0).length;
  const pageCount = Math.max(1, Math.ceil(filteredStudents.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStudents = filteredStudents.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selectedLine = lines.find((line) => String(line.id) === lineFilter);

  function toggleArea(key: string) {
    setSelectedAreas((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleStudent(id: number) {
    setSelectedStudents((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else if (next.size < ASSIGNMENT_LIMIT) next.add(id);
      return next;
    });
  }

  async function saveEditor(event: React.FormEvent) {
    event.preventDefault();
    if (!editor || schoolId == null || !canManage || saving) return;
    const isCurrentSchool = captureSchoolRequest();
    const name = editor.name.trim();
    if (!name) { setEditorError('أدخل الاسم أولاً.'); return; }
    setSaving(true);
    setEditorError('');
    try {
      const payload = { name, driver_name: editor.driver_name.trim(), driver_phone: editor.driver_phone.trim() };
      const response = editor.kind === 'area'
        ? editor.id == null ? await createResidentialArea(schoolId, name) : await updateResidentialArea(editor.id, schoolId, name)
        : editor.id == null ? await createTransportLine(schoolId, payload) : await updateTransportLine(editor.id, schoolId, payload);
      if (!isCurrentSchool()) return;
      if (response.error) { setEditorError(response.error); return; }
      setEditor(null);
      setNotice('تم الحفظ.');
      await loadData();
    } catch {
      if (isCurrentSchool()) setEditorError('تعذر حفظ التغييرات. أعد المحاولة.');
    } finally {
      if (isCurrentSchool()) setSaving(false);
    }
  }

  async function assignSelected() {
    if (schoolId == null || !canManage || !assignmentLine || !selectedStudents.size || selectedStudents.size > ASSIGNMENT_LIMIT || saving) return;
    const isCurrentSchool = captureSchoolRequest();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await assignTransportLine(schoolId, [...selectedStudents], Number(assignmentLine), assignmentDirection);
      if (!isCurrentSchool()) return;
      if (result.error) { setError(result.error); return; }
      setNotice(`تم إسناد ${toArabicDigits(result.data?.updated ?? selectedStudents.size)} طالب إلى الخط المحدد.`);
      setSelectedStudents(new Set());
      await loadData();
    } catch {
      if (isCurrentSchool()) setError('تعذر إسناد الطلاب. أعد المحاولة.');
    } finally {
      if (isCurrentSchool()) setSaving(false);
    }
  }

  function printedTrip(student: TransportRosterStudent, direction: Exclude<Direction, 'any'>): string {
    if (lineFilter) {
      if (directionFilter !== 'any' && directionFilter !== direction) return 'خارج نطاق هذه القائمة';
      if (tripMode(student, direction) !== 'school' || String(tripLineId(student, direction)) !== lineFilter) return 'غير مسند إلى هذا الخط';
    }
    return tripText(student, direction);
  }

  return <div dir="rtl">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><Bus className="text-blue-600" /> اشتراكات النقل</h1>
        <p className="mt-1 text-sm text-gray-500">اختر المناطق، راجع طريقة الذهاب والإياب، واطبع قوائم الطلاب أو قائمة صاحب الخط.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { setSelectedStudents(new Set()); void loadData(); }} disabled={loading || saving || schoolId == null} className={secondaryButton}><RefreshCw size={16} /> تحديث</button>
        {canManage && <button type="button" disabled={!ready || saving} className={secondaryButton} onClick={() => setManageOpen(!manageOpen)}><Settings2 size={16} /> المناطق والخطوط</button>}
      </div>
    </div>
    <SystemAdminSchoolSelector {...schoolScope} />
    {error && <div role="alert" className="my-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {notice && <div role="status" className="my-4 flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800"><Check size={16} /> {notice}</div>}
    {schoolId == null ? <div className="mt-6 rounded-xl border border-gray-200 bg-white p-10 text-center text-gray-500">اختر المدرسة لعرض بيانات النقل.</div>
      : loading ? <div className="py-16 text-center text-gray-500" role="status">جارٍ تحميل بيانات النقل…</div>
        : ready && <>
          <div className="mb-5 mt-4 flex flex-wrap items-center gap-3 text-sm text-gray-600">
            <span>{academicYear ? <>العام الدراسي: <bdi dir="ltr">{academicYear.name}</bdi></> : 'لا يوجد عام دراسي نشط — تعرض القائمة بيانات الطلاب الحالية دون قيد سنوي.'}</span>
            <span>• {toArabicDigits(students.length)} طالب</span>
            {allIncompleteCount > 0 && <span className="text-amber-700">• {toArabicDigits(allIncompleteCount)} طالب ببيانات غير مكتملة</span>}
          </div>

          {manageOpen && canManage && <section className="mb-6 grid gap-4 rounded-xl border border-blue-100 bg-blue-50/40 p-4 md:grid-cols-2" aria-label="إدارة المناطق والخطوط">
            <div>
              <div className="mb-3 flex items-center justify-between"><h2 className="font-bold text-gray-900">مناطق السكن</h2><button className={secondaryButton} disabled={saving} onClick={() => { setEditorError(''); setEditor({ kind: 'area', id: null, name: '', driver_name: '', driver_phone: '' }); }}><Plus size={15} /> إضافة منطقة</button></div>
              <div className="max-h-60 space-y-2 overflow-auto">
                {areas.map((area) => <div key={area.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2"><span className="text-sm">{area.name}</span><button type="button" disabled={saving} aria-label={`تعديل منطقة ${area.name}`} className="rounded p-2 text-gray-500 hover:bg-gray-100" onClick={() => { setEditorError(''); setEditor({ kind: 'area', id: area.id, name: area.name, driver_name: '', driver_phone: '' }); }}><Edit2 size={15} /></button></div>)}
                {!areas.length && <p className="py-3 text-sm text-gray-500">أضف مناطق موحدة، ثم حدد منطقة كل طالب من ملفه.</p>}
              </div>
            </div>
            <div>
              <div className="mb-3 flex items-center justify-between"><h2 className="font-bold text-gray-900">خطوط اشتراك المدرسة</h2><button className={secondaryButton} disabled={saving} onClick={() => { setEditorError(''); setEditor({ kind: 'line', id: null, name: '', driver_name: '', driver_phone: '' }); }}><Plus size={15} /> إضافة خط</button></div>
              <div className="max-h-60 space-y-2 overflow-auto">
                {lines.map((line) => <div key={line.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2"><div><p className="text-sm font-medium">{line.name}</p><p className="text-xs text-gray-500">{line.driver_name || 'لم يُسجل اسم السائق'}{line.driver_phone && <> — <bdi dir="ltr">{line.driver_phone}</bdi></>}</p></div><button type="button" disabled={saving} aria-label={`تعديل خط ${line.name}`} className="rounded p-2 text-gray-500 hover:bg-gray-100" onClick={() => { setEditorError(''); setEditor({ kind: 'line', id: line.id, name: line.name, driver_name: line.driver_name || '', driver_phone: line.driver_phone || '' }); }}><Edit2 size={15} /></button></div>)}
                {!lines.length && <p className="py-3 text-sm text-gray-500">احفظ خطاً باسم السائق، ثم أسند إليه الطلاب في الاتجاه المناسب.</p>}
              </div>
            </div>
          </section>}

          <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="transport-areas-title">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 id="transport-areas-title" className="flex items-center gap-2 font-bold text-gray-900"><MapPin size={18} /> ١. حدد المناطق</h2><div className="flex gap-3 text-sm"><button type="button" className="text-blue-700" onClick={() => setSelectedAreas(new Set(areaGroups.map((area) => area.key)))}>تحديد جميع المناطق</button><button type="button" className="text-gray-500" onClick={() => setSelectedAreas(new Set())}>إلغاء التحديد</button></div></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {areaGroups.map((area) => {
                const subscribers = area.students.filter((student) => tripMode(student, 'to_school') === 'school' || tripMode(student, 'from_school') === 'school').length;
                return <label key={area.key} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${selectedAreas.has(area.key) ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}><input type="checkbox" checked={selectedAreas.has(area.key)} onChange={() => toggleArea(area.key)} className="mt-1 accent-blue-600" /><span><span className="block text-sm font-semibold text-gray-900">{area.name}</span><span className="mt-1 block text-xs text-gray-500">{toArabicDigits(area.students.length)} طالب • {toArabicDigits(subscribers)} اشتراك مدرسة</span></span></label>;
              })}
            </div>
          </section>

          <section className="mb-5 rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="transport-filter-title">
            <h2 id="transport-filter-title" className="mb-4 font-bold text-gray-900">٢. راجع قائمة الطلاب</h2>
            <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label htmlFor="transport-mode-filter" className="space-y-1 text-sm text-gray-600"><span>طريقة النقل</span><select id="transport-mode-filter" className={inputClass} value={modeFilter} onChange={(event) => { const value = event.target.value as TransportMode | 'all'; setModeFilter(value); if (value !== 'all' && value !== 'school') setLineFilter(''); }}><option value="all">جميع الطلاب</option>{TRANSPORT_MODES.map((mode) => <option value={mode.value} key={mode.value}>{mode.label}</option>)}</select></label>
              <label className="space-y-1 text-sm text-gray-600"><span>اتجاه الرحلة</span><select className={inputClass} value={directionFilter} onChange={(event) => setDirectionFilter(event.target.value as Direction)}><option value="any">الذهاب أو الإياب</option><option value="to_school">الذهاب إلى المدرسة</option><option value="from_school">الإياب من المدرسة</option></select></label>
              <label className="space-y-1 text-sm text-gray-600"><span>قائمة صاحب الخط</span><select className={inputClass} value={lineFilter} onChange={(event) => { setLineFilter(event.target.value); if (event.target.value) setModeFilter('school'); }}><option value="">جميع الخطوط</option>{lines.map((line) => <option value={line.id} key={line.id}>{line.name}</option>)}</select></label>
              <label className="space-y-1 text-sm text-gray-600"><span>بحث بالاسم أو الهاتف أو العنوان</span><span className="relative block"><Search size={16} className="absolute left-3 top-3 text-gray-400" /><input className={`${inputClass} pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث في المناطق المحددة" /></span></label>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={incompleteOnly} onChange={(event) => setIncompleteOnly(event.target.checked)} className="accent-blue-600" /> بيانات غير مكتملة فقط</label><p className="text-sm text-gray-500">{toArabicDigits(filteredStudents.length)} طالب ضمن المناطق والتصفية الحالية</p></div>
          </section>

          {incompleteCount > 0 && <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><p>توجد بيانات غير مكتملة لدى {toArabicDigits(incompleteCount)} طالب في القائمة. افتح ملف الطالب لاستكمالها؛ ستظهر السجلات الناقصة في الطباعة أيضاً.</p></div>}

          {canManage && <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-44 flex-1"><p className="mb-2 text-sm font-medium">إسناد الطلاب المحددين إلى خط</p><select aria-label="الخط المراد إسناد الطلاب إليه" className={inputClass} value={assignmentLine} disabled={saving} onChange={(event) => setAssignmentLine(event.target.value)}><option value="">اختر الخط</option>{lines.map((line) => <option value={line.id} key={line.id}>{line.name}</option>)}</select></div>
              <label className="min-w-40 space-y-2 text-sm"><span>الاتجاه المطلوب تغييره</span><select className={inputClass} value={assignmentDirection} disabled={saving} onChange={(event) => setAssignmentDirection(event.target.value as AssignmentDirection)}><option value="both">الذهاب والإياب</option><option value="to_school">الذهاب فقط</option><option value="from_school">الإياب فقط</option></select></label>
              <button className={primaryButton} disabled={saving || !assignmentLine || !selectedStudents.size} onClick={() => void assignSelected()}>{saving ? 'جارٍ الحفظ…' : `إسناد ${toArabicDigits(selectedStudents.size)} طالب`}</button>
              {selectedStudents.size > 0 && <button type="button" className={secondaryButton} disabled={saving} onClick={() => setSelectedStudents(new Set())}>إلغاء تحديد الطلاب</button>}
            </div>
            <p className="mt-2 text-xs text-gray-500">الإسناد يغيّر طريقة النقل إلى «اشتراك المدرسة» في الاتجاه المختار، ويستبدل الخط السابق فيه. الحد الأقصى {toArabicDigits(ASSIGNMENT_LIMIT)} طالب في العملية الواحدة.</p>
          </div>}

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-4"><p className="text-sm font-semibold text-gray-800">القائمة الحالية — {toArabicDigits(filteredStudents.length)} طالب</p><button type="button" disabled={!filteredStudents.length || saving} className={primaryButton} onClick={() => setPreviewOpen(true)}><Printer size={17} /> معاينة وطباعة القائمة</button></div>
            <p className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500">الطباعة تشمل جميع نتائج المناطق والتصفية الحالية، عبر كل صفحات الجدول. مربعات تحديد الطلاب مخصصة لإسناد الخط فقط.</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-right text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500"><tr>
                  {canManage && <th className="w-10 px-3 py-3"><input type="checkbox" aria-label="تحديد طلاب هذه الصفحة للإسناد" disabled={!pageStudents.length || saving} checked={pageStudents.length > 0 && pageStudents.every((student) => selectedStudents.has(student.id))} onChange={(event) => {
                    setSelectedStudents((previous) => { const next = new Set(previous); for (const student of pageStudents) { if (event.target.checked && next.size < ASSIGNMENT_LIMIT) next.add(student.id); else if (!event.target.checked) next.delete(student.id); } return next; });
                  }} className="accent-blue-600" /></th>}
                  <th className="px-3 py-3">الطالب / الصف</th><th className="px-3 py-3">منطقة السكن / العنوان</th><th className="px-3 py-3">هاتف ولي الأمر</th><th className="px-3 py-3">الذهاب إلى المدرسة</th><th className="px-3 py-3">الإياب من المدرسة</th><th className="px-3 py-3">اكتمال البيانات</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {pageStudents.map((student) => {
                    const missingFields = getTransportMissingFields(student);
                    return <tr key={student.id} className="align-top hover:bg-gray-50">
                      {canManage && <td className="px-3 py-3"><input type="checkbox" aria-label={`تحديد ${student.full_name}`} checked={selectedStudents.has(student.id)} disabled={saving || (!selectedStudents.has(student.id) && selectedStudents.size >= ASSIGNMENT_LIMIT)} onChange={() => toggleStudent(student.id)} className="accent-blue-600" /></td>}
                      <td className="px-3 py-3"><Link to={`/students/${student.id}`} className="font-semibold text-blue-700 hover:underline">{student.full_name}</Link><p className="mt-1 text-xs text-gray-500">{[student.class_name, student.section_name].filter(Boolean).join(' / ') || 'لم يُحدد الصف'}</p><p className="mt-1 text-xs text-gray-500">{schoolSubscriptionLabel(student)}</p></td>
                      <td className="max-w-56 px-3 py-3"><p>{student.residential_area_name || 'لم تُحدد المنطقة'}</p><p className="mt-1 text-xs text-gray-500">{student.address || 'لم يُسجل العنوان'}</p>{student.pickup_landmark && <p className="mt-1 text-xs text-gray-500">نقطة دالة: {student.pickup_landmark}</p>}</td>
                      <td className="px-3 py-3"><ContactNumbers student={student} /></td>
                      <td className="max-w-48 px-3 py-3">{tripText(student, 'to_school')}</td><td className="max-w-48 px-3 py-3">{tripText(student, 'from_school')}</td>
                      <td className="max-w-44 px-3 py-3">{missingFields.length ? <Link to={`/students/${student.id}`} className="text-xs text-amber-700 hover:underline">ناقص: {missingFields.join('، ')}</Link> : <span className="text-xs text-green-700">مكتملة</span>}</td>
                    </tr>;
                  })}
                  {!pageStudents.length && <tr><td colSpan={canManage ? 7 : 6} className="px-4 py-12 text-center text-gray-500">{selectedAreas.size ? 'لا يوجد طلاب يطابقون التصفية الحالية.' : 'حدد منطقة أو أكثر لعرض الطلاب.'}</td></tr>}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && <div className="flex items-center justify-between border-t border-gray-200 p-3 text-sm"><button type="button" className={secondaryButton} disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>السابق</button><span>صفحة {toArabicDigits(currentPage)} من {toArabicDigits(pageCount)}</span><button type="button" className={secondaryButton} disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>التالي</button></div>}
          </div>
        </>}

    {editor && ready && canManage && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="transport-editor-title">
      <form onSubmit={saveEditor} className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between"><h2 id="transport-editor-title" className="text-lg font-bold">{editor.id == null ? 'إضافة' : 'تعديل'} {editor.kind === 'area' ? 'منطقة سكن' : 'خط نقل'}</h2><button type="button" disabled={saving} aria-label="إغلاق" onClick={() => setEditor(null)}><X size={20} /></button></div>
        {editorError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{editorError}</p>}
        <label className="block space-y-1 text-sm"><span>{editor.kind === 'area' ? 'اسم المنطقة' : 'اسم الخط'}</span><input required autoFocus maxLength={120} className={inputClass} disabled={saving} value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} placeholder={editor.kind === 'area' ? 'مثال: حي الجامعة' : 'مثال: خط أبو أحمد'} /></label>
        {editor.kind === 'line' && <><label className="block space-y-1 text-sm"><span>اسم السائق (اختياري)</span><input maxLength={120} className={inputClass} disabled={saving} value={editor.driver_name} onChange={(event) => setEditor({ ...editor, driver_name: event.target.value })} /></label><label className="block space-y-1 text-sm"><span>هاتف السائق (اختياري)</span><input type="tel" dir="ltr" maxLength={30} className={inputClass} disabled={saving} value={editor.driver_phone} onChange={(event) => setEditor({ ...editor, driver_phone: event.target.value })} /></label></>}
        <div className="flex justify-end gap-2"><button type="button" disabled={saving} className={secondaryButton} onClick={() => setEditor(null)}>إلغاء</button><button type="submit" disabled={saving} className={primaryButton}>{saving ? 'جارٍ الحفظ…' : 'حفظ'}</button></div>
      </form>
    </div>}

    {previewOpen && ready && createPortal(<div className="transport-print-layer" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="transport-preview-title">
      <div className="transport-preview-toolbar"><div><h2 id="transport-preview-title">معاينة قوائم النقل</h2><p>{toArabicDigits(filteredStudents.length)} طالب في {toArabicDigits(printGroups.length)} مناطق — تبدأ كل منطقة بصفحة جديدة</p></div><div className="flex gap-2"><button type="button" className={primaryButton} onClick={() => window.print()}><Printer size={17} /> طباعة القوائم</button><button type="button" className={secondaryButton} onClick={() => setPreviewOpen(false)}><X size={17} /> إغلاق</button></div></div>
      <div className="transport-print-document">
        {printGroups.map((area) => <section className="transport-print-area" key={area.key}>
          <header className="transport-print-heading">
            <p>طريقة النقل: {modeFilter === 'all' ? 'الجميع' : transportModeLabel(modeFilter)} • الاتجاه: {directionFilter === 'any' ? 'الذهاب أو الإياب' : directionFilter === 'to_school' ? 'الذهاب إلى المدرسة' : 'الإياب من المدرسة'}{search.trim() && ` • البحث: ${search.trim()}`}{incompleteOnly && ' • البيانات غير المكتملة فقط'}</p>
            {area.students.some((student) => getTransportMissingFields(student).length > 0) && <p className="transport-print-warning">تتضمن القائمة بيانات غير مكتملة؛ يرجى مراجعة الحقول غير المسجلة قبل بدء النقل.</p>}
          </header>
          <table className="transport-print-table"><colgroup><col style={{ width: '4%' }} /><col style={{ width: '19%' }} /><col style={{ width: '12%' }} /><col style={{ width: '23%' }} /><col style={{ width: '16%' }} /><col style={{ width: '13%' }} /><col style={{ width: '13%' }} /></colgroup><thead>
            <tr><th colSpan={7} className="transport-print-identity">
              <div className="transport-print-identity-title"><strong>{schoolName}</strong><span>{selectedLine ? `قائمة ${selectedLine.name}` : 'قائمة نقل الطلاب'} — {area.name}</span></div>
              <div className="transport-print-meta"><span>{academicYear ? <>العام الدراسي: <bdi dir="ltr">{academicYear.name}</bdi></> : 'لا يوجد عام دراسي نشط — بيانات الطلاب الحالية'}</span><span>التاريخ: {new Date().toLocaleDateString('ar-IQ')}</span><span>عدد طلاب المنطقة في القائمة: {toArabicDigits(area.students.length)}</span></div>
              {selectedLine && <p>السائق: {selectedLine.driver_name || 'غير مسجل'}{selectedLine.driver_phone && <> — الهاتف: <bdi dir="ltr">{selectedLine.driver_phone}</bdi></>}</p>}
            </th></tr>
            <tr><th scope="col">ت</th><th scope="col">اسم الطالب</th><th scope="col">الصف / الشعبة</th><th scope="col">محل السكن والنقطة الدالة</th><th scope="col">هاتف ولي الأمر</th><th scope="col">الذهاب</th><th scope="col">الإياب</th></tr></thead><tbody>
            {area.students.map((student, index) => <tr key={student.id}><td>{toArabicDigits(index + 1)}</td><td>{student.full_name}</td><td>{[student.class_name, student.section_name].filter(Boolean).join(' / ') || 'غير مسجل'}</td><td><p>{student.address || 'العنوان غير مسجل'}</p>{student.pickup_landmark && <p>نقطة دالة: {student.pickup_landmark}</p>}</td><td><ContactNumbers student={student} /></td><td>{printedTrip(student, 'to_school')}</td><td>{printedTrip(student, 'from_school')}</td></tr>)}
          </tbody></table>
        </section>)}
      </div>
    </div>, document.body)}
  </div>;
}
