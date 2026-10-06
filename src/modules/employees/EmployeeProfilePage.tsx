import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpen, Camera, FileText, GraduationCap, Pencil, RefreshCw, Trash2, UserRound } from 'lucide-react';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { useAuth } from '../../hooks/useAuth';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { updateEmployee } from '../../lib/api';
import { deleteEmployeePhoto, getEmployeePhotoUrl, getEmployeeProfile, uploadEmployeePhoto } from '../../lib/employeeRecordsApi';
import { EMPLOYEE_ACCESS_ROLES, EMPLOYEE_MANAGEMENT_ROLES, EMPLOYEE_SALARY_ROLES, hasRole } from '../../lib/rbac';
import type { EmployeeProfile as EmployeeProfileData } from '../../types/employees';
import type { RoleKey } from '../../types';
import { EmployeeFormFields, employeeDraftFrom, employeeDraftPayload, employeeTypeLabels, salaryTypeLabels, validateEmployeeDraft, type EmployeeDraft } from './EmployeeFormFields';

const panelClass = 'rounded-xl border border-gray-200 bg-white p-4 sm:p-6';
const absent = 'غير مسجل';
const positiveId = (value: string | null | undefined) => value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;

function Information({ label, value }: { label: string; value?: ReactNode }) {
  return <div className="min-w-0 rounded-lg bg-gray-50 p-3"><dt className="mb-1 text-xs text-gray-500">{label}</dt><dd className="break-words text-sm font-medium text-gray-900">{value === null || value === undefined || value === '' ? absent : value}</dd></div>;
}

export function EmployeeProfile({ schoolId, employeeId, role, requestedAcademicYearId = null, onYearChange,
  loadProfile = getEmployeeProfile, saveEmployee = updateEmployee, uploadPhoto = uploadEmployeePhoto, removePhoto = deleteEmployeePhoto,
}: {
  schoolId: number | null;
  employeeId: number | null;
  role: RoleKey | null | undefined;
  requestedAcademicYearId?: number | null;
  onYearChange?: (id: number) => void;
  loadProfile?: typeof getEmployeeProfile;
  saveEmployee?: typeof updateEmployee;
  uploadPhoto?: typeof uploadEmployeePhoto;
  removePhoto?: typeof deleteEmployeePhoto;
}) {
  const [academicYearId, setAcademicYearId] = useState<number | null>(requestedAcademicYearId);
  const [data, setData] = useState<EmployeeProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<EmployeeDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const generation = useRef(0);
  const scope = useRef('');
  const canViewAcademic = hasRole(role, EMPLOYEE_MANAGEMENT_ROLES);
  const profileAcademicYearId = canViewAcademic ? academicYearId : null;
  const scopeKey = `${schoolId}:${employeeId}:${profileAcademicYearId}:${role}`;
  if (scope.current !== scopeKey) { scope.current = scopeKey; generation.current++; }
  const canAccess = hasRole(role, EMPLOYEE_ACCESS_ROLES);
  const current = data?.employee.school_id === schoolId && data.employee.id === employeeId
    && (profileAcademicYearId == null || data.academic_year?.id === profileAcademicYearId) ? data : null;
  const canManage = hasRole(role, EMPLOYEE_MANAGEMENT_ROLES) && current?.can_manage === true;
  const canViewPrivate = hasRole(role, EMPLOYEE_MANAGEMENT_ROLES) && current?.can_view_private === true;
  const canViewSalary = hasRole(role, EMPLOYEE_SALARY_ROLES);

  useEffect(() => { setAcademicYearId(requestedAcademicYearId); }, [requestedAcademicYearId, schoolId, employeeId]);
  useEffect(() => {
    let active = true;
    const request = ++generation.current;
    const isCurrent = () => active && request === generation.current;
    setData(null); setDraft(null); setError(''); setSuccess(''); setBusy(false); setPhotoFailed(false);
    if (schoolId == null || employeeId == null || !canAccess) { setLoading(false); return () => { active = false; }; }
    setLoading(true);
    void (async () => {
      try {
        const response = await loadProfile(employeeId, { school_id: schoolId, ...(canViewAcademic ? { academic_year_id: profileAcademicYearId } : {}) });
        if (!isCurrent()) return;
        if (response.error) throw new Error(response.error);
        if (!response.data || response.data.employee.id !== employeeId || response.data.employee.school_id !== schoolId
          || (profileAcademicYearId != null && response.data.academic_year?.id !== profileAcademicYearId)) {
          throw new Error('تعذر مطابقة ملف الموظف مع المدرسة والسنة المختارتين');
        }
        setData(response.data);
      } catch (failure) {
        if (isCurrent()) setError(failure instanceof Error ? failure.message : 'تعذر تحميل ملف الموظف');
      } finally { if (isCurrent()) setLoading(false); }
    })();
    return () => { active = false; generation.current++; };
  }, [schoolId, employeeId, profileAcademicYearId, role, canAccess, canViewAcademic, reload, loadProfile]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || !current || !canManage || busy || schoolId == null || employeeId == null) return;
    const validation = validateEmployeeDraft(draft);
    if (validation) { setError(validation); return; }
    const request = generation.current;
    setBusy(true); setError(''); setSuccess('');
    try {
      const response = await saveEmployee(employeeId, { ...employeeDraftPayload(draft), school_id: schoolId });
      if (request !== generation.current) return;
      if (response.error) throw new Error(response.error);
      setDraft(null); setReload(value => value + 1);
    } catch (failure) {
      if (request === generation.current) setError(failure instanceof Error ? failure.message : 'تعذر حفظ ملف الموظف');
    } finally { if (request === generation.current) setBusy(false); }
  }

  async function changePhoto(file: File | null) {
    if (!current || !canManage || busy || schoolId == null || employeeId == null) return;
    if (file && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('اختر صورة بصيغة JPEG أو PNG أو WebP'); return; }
    if (file && (file.size === 0 || file.size > 2 * 1024 * 1024)) { setError('يجب أن يكون حجم الصورة أكبر من صفر ولا يتجاوز 2 ميغابايت'); return; }
    const request = generation.current;
    setBusy(true); setError(''); setSuccess('');
    try {
      const response = file ? await uploadPhoto(employeeId, schoolId, file) : await removePhoto(employeeId, schoolId);
      if (request !== generation.current) return;
      if (response.error || !response.data) throw new Error(response.error || 'تعذر تحديث الصورة');
      setData(previous => previous ? { ...previous, employee: { ...previous.employee, ...response.data } } : previous);
      setPhotoFailed(false); setSuccess(file ? 'تم حفظ صورة الموظف' : 'تم حذف صورة الموظف');
    } catch (failure) {
      if (request === generation.current) setError(failure instanceof Error ? failure.message : 'تعذر تحديث صورة الموظف');
    } finally { if (request === generation.current) setBusy(false); }
  }

  const settings = current?.document_settings;
  const digits = (value: string | number) => settings?.use_arabic_indic_digits === false
    ? String(value) : String(value).replace(/\d/g, digit => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]);
  const date = (value: string | null | undefined) => {
    if (!value) return absent;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return digits(value);
    const [, year, month, day] = match;
    const format = settings?.date_format || 'dd/MM/yyyy';
    return digits(format.replace('yyyy', year).replace('MM', month).replace('dd', day));
  };
  const money = (value: number | null | undefined) => value == null ? absent : `${digits(value.toLocaleString('en-US'))} د.ع (IQD)`;
  const employee = current?.employee;

  return <div dir="rtl" className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <a className="flex items-center gap-1 text-sm text-gray-600 hover:text-primary-700" href={`/employees${schoolId == null ? '' : `?school_id=${schoolId}`}`}><ArrowRight size={16} /> العودة إلى الموظفين</a>
      {schoolId != null && <a href={`/staff-register?school_id=${schoolId}`} className="flex items-center gap-1 text-sm text-primary-700"><FileText size={16} /> سجل الكادر</a>}
      {canManage && <a href={`/employees/${employeeId}/dossier?school_id=${schoolId}`} className="flex items-center gap-1 rounded-lg border border-primary-200 px-3 py-2 text-sm text-primary-700"><FileText size={16} /> سجل جماعة المدرسين والطباعة</a>}
    </div>
    {schoolId == null && <p className={panelClass}>اختر المدرسة لعرض ملف الموظف.</p>}
    {employeeId == null && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">معرف الموظف غير صالح.</p>}
    {!canAccess && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">ليس لديك صلاحية لعرض ملف الموظف.</p>}
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><span>{error}</span>
      {!current && <button type="button" className="flex items-center gap-1 underline" onClick={() => setReload(value => value + 1)}><RefreshCw size={15} /> إعادة المحاولة</button>}</div>}
    {success && <p role="status" className="rounded-xl bg-green-50 p-4 text-sm text-green-700">{success}</p>}
    {loading && <p role="status" className="py-12 text-center text-gray-500">جارِ تحميل ملف الموظف...</p>}
    {current && employee && canAccess && <>
      <header className={`${panelClass} flex flex-col gap-5 sm:flex-row sm:items-center`}>
        <div className="flex shrink-0 flex-col items-center gap-2">
          {canViewPrivate && employee.has_photo && !photoFailed && schoolId != null
            ? <img className="h-32 w-28 rounded-xl border border-gray-200 object-cover" src={getEmployeePhotoUrl(employee.id, schoolId, employee.photo_updated_at)} alt={`صورة ${employee.full_name}`} onError={() => setPhotoFailed(true)} />
            : <div className="flex h-32 w-28 flex-col items-center justify-center gap-2 rounded-xl bg-gray-100 text-gray-400"><UserRound size={40} />{canViewPrivate && <span className="text-xs">{photoFailed ? 'تعذر تحميل الصورة' : 'الصورة غير مسجلة'}</span>}</div>}
          {canManage && <div className="flex max-w-48 flex-wrap justify-center gap-2">
            <label className={`flex cursor-pointer items-center gap-1 rounded-lg bg-primary-50 px-2 py-1 text-xs text-primary-700 ${busy ? 'pointer-events-none opacity-50' : ''}`}><Camera size={14} /> {employee.has_photo ? 'تغيير الصورة' : 'إضافة صورة'}
              <input aria-label="رفع صورة الموظف" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy}
                onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void changePhoto(file); }} />
            </label>
            {employee.has_photo && <button type="button" disabled={busy} className="flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700 disabled:opacity-50" onClick={() => void changePhoto(null)}><Trash2 size={13} /> حذف الصورة</button>}
            <span className="text-center text-xs text-gray-500">JPEG، PNG، WebP حتى 2 ميغابايت</span>
          </div>}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="break-words text-2xl font-bold text-gray-900">{employee.full_name}</h1>
          <p className="text-gray-600">{employee.job_title || employeeTypeLabels[employee.employee_type || ''] || absent}</p>
          <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-gray-500">الرقم الوظيفي: {employee.employee_number ? digits(employee.employee_number) : absent}</span>
            <span className={`rounded-full px-2 py-1 text-xs ${employee.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{employee.status === 'active' ? 'نشط' : 'مؤرشف'}</span></div>
        </div>
        {canManage && !draft && <button type="button" disabled={busy} onClick={() => { setDraft(employeeDraftFrom({ ...employee, qualifications: current.qualifications })); setError(''); setSuccess(''); }} className="flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white disabled:opacity-50"><Pencil size={16} /> تعديل البيانات</button>}
      </header>
      {draft && canManage ? <section className={panelClass}>
        <h2 className="mb-4 text-lg font-bold">تعديل بيانات الموظف</h2>
        <form onSubmit={save} className="space-y-4"><EmployeeFormFields value={draft} onChange={setDraft} disabled={busy} />
          <div className="flex gap-3"><button type="submit" disabled={busy} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? 'جارِ الحفظ...' : 'حفظ التعديلات'}</button>
            <button type="button" disabled={busy} className="rounded-lg bg-gray-100 px-4 py-2 text-sm" onClick={() => { setDraft(null); setError(''); }}>إلغاء</button></div>
        </form>
      </section> : <>
        <section className={panelClass} aria-label="المعلومات الشخصية والوظيفية">
          <h2 className="mb-4 text-lg font-bold">المعلومات الشخصية والوظيفية</h2>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {canViewPrivate && <Information label="الهاتف" value={employee.phone ? <bdi>{digits(employee.phone)}</bdi> : absent} />}
            {canViewPrivate && <Information label="البريد الإلكتروني" value={employee.email ? <bdi>{employee.email}</bdi> : absent} />}
            {canViewPrivate && <Information label="العنوان" value={employee.address} />}
            {canViewPrivate && <Information label="الجنس" value={employee.gender === 'male' ? 'ذكر' : employee.gender === 'female' ? 'أنثى' : employee.gender === 'other' ? 'آخر' : absent} />}
            <Information label="نوع الموظف" value={employeeTypeLabels[employee.employee_type || ''] || absent} />
            <Information label="تاريخ التعيين" value={date(employee.hire_date)} />
            <Information label="تاريخ المباشرة" value={date(employee.commencement_date)} />
          </dl>
          {canViewPrivate && <div className="mt-4 rounded-lg bg-gray-50 p-3"><h3 className="mb-1 text-xs text-gray-500">ملاحظات إدارية</h3><p className="whitespace-pre-wrap break-words text-sm">{employee.notes || absent}</p></div>}
        </section>
        {canViewPrivate && <section className={panelClass} aria-label="المؤهلات الدراسية">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold"><GraduationCap size={20} /> المؤهلات الدراسية</h2>
          {current.qualifications.length ? <div className="grid gap-4 lg:grid-cols-2">{current.qualifications.map(qualification => <article key={qualification.id} className="rounded-xl border border-gray-200 p-4">
            <h3 className="mb-3 flex flex-wrap items-center gap-2 font-semibold">{qualification.degree}{qualification.is_primary && <span className="rounded-full bg-primary-50 px-2 py-1 text-xs font-normal text-primary-700">المؤهل المعروض في السجل</span>}</h3>
            <dl className="grid gap-2 sm:grid-cols-2"><Information label="الاختصاص العام" value={qualification.general_specialization} /><Information label="الاختصاص الدقيق" value={qualification.specific_specialization} />
              <Information label="الجامعة أو المعهد" value={qualification.institution} /><Information label="الكلية أو القسم" value={qualification.college} /><Information label="تاريخ التخرج" value={date(qualification.graduation_date)} /></dl>
          </article>)}</div> : <p className="text-sm text-gray-500">لا توجد مؤهلات مسجلة.</p>}
        </section>}
      </>}
      {canViewPrivate && (employee.role === 'teacher' || employee.employee_type === 'teacher' || current.teaching_assignments.length > 0 || current.advisory_assignments.length > 0) && <section className={panelClass} aria-label="التكليف الدراسي">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-lg font-bold"><BookOpen size={20} /> التكليف الدراسي</h2>
          <label className="text-sm text-gray-700">السنة الدراسية<select className="mr-2 rounded-lg border border-gray-300 px-3 py-2" aria-label="السنة الدراسية" value={current.academic_year?.id ?? ''} disabled={busy || current.academic_years.length === 0}
            onChange={event => { const id = Number(event.target.value); setAcademicYearId(id); onYearChange?.(id); }}>
            {!current.academic_year && <option value="">لا توجد سنة دراسية</option>}{current.academic_years.map(year => <option key={year.id} value={year.id}>{digits(year.name)}{year.is_active ? ' — الحالية' : ''}</option>)}
          </select></label>
        </div>
        <p className="mb-4 text-sm text-gray-600">الحصص الأسبوعية المحفوظة في الجدول: <strong className="text-primary-700">{digits(current.total_saved_weekly_periods)}</strong></p>
        {current.teaching_assignments.length ? <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-right text-sm"><thead className="bg-gray-50"><tr>{['المادة', 'الصف', 'الشعبة', 'الحصص المحفوظة'].map(label => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">
          {current.teaching_assignments.map((assignment, index) => <tr key={`${assignment.teaching_load_id}-${index}`}><td className="px-3 py-3">{assignment.subject_name}</td><td className="px-3 py-3">{assignment.class_name}</td><td className="px-3 py-3">{assignment.section_name || 'الصف كاملاً'}</td><td className="px-3 py-3 font-semibold">{digits(assignment.saved_weekly_periods)}</td></tr>)}
        </tbody></table></div> : <p className="text-sm text-gray-500">لا توجد تكليفات تدريس مسجلة للسنة المختارة.</p>}
        <div className="mt-5 border-t border-gray-100 pt-4"><h3 className="mb-2 font-semibold">إرشاد الصفوف والشعب</h3>
          {current.advisory_assignments.length ? <ul className="space-y-2">{current.advisory_assignments.map(assignment => <li key={`${assignment.class_id}:${assignment.section_id}`} className="rounded-lg bg-primary-50 p-3 text-sm text-primary-900">{assignment.class_name} — {assignment.section_name || 'الصف كاملاً'}<span className="mr-2 text-xs">{assignment.attendance_confirmed ? 'الحضور مؤكد' : 'الحضور غير مؤكد'}</span></li>)}</ul>
            : <p className="text-sm text-gray-500">لا يوجد تكليف إرشاد مسجل للسنة المختارة.</p>}
        </div>
        <p className="mt-3 text-xs text-gray-500">تُقرأ هذه البيانات من الجدول وتكليفات المرشدين المحفوظة للسنة المختارة.</p>
      </section>}
      {canViewSalary && <section className={panelClass} aria-label="المعلومات المالية">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">المعلومات المالية</h2><a className="text-sm text-primary-700 hover:underline" href={`/salary-receipts?school_id=${schoolId}`}>كشف استلام الرواتب</a></div>
        <dl className="mb-4 grid gap-3 sm:grid-cols-2"><Information label="الراتب الأساسي الحالي" value={money(employee.salary_amount)} /><Information label="نوع الراتب" value={salaryTypeLabels[employee.salary_type || ''] || absent} /></dl>
        <h3 className="mb-2 font-semibold">سجل الرواتب الشهرية</h3>
        <p className="mb-3 text-xs text-gray-500">المبالغ أدناه هي السجلات المحفوظة لكل شهر، ولا تتغير عند تعديل الراتب الحالي.</p>
        {current.salary_history.length ? <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-right text-sm"><thead className="bg-gray-50"><tr>{['الشهر / السنة', 'الأساسي', 'الإضافات', 'الاستقطاعات', 'الصافي', 'الحالة', 'تاريخ الاستلام'].map(label => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">
          {current.salary_history.map(salary => <tr key={salary.id} className={salary.status === 'cancelled' ? 'bg-red-50/40' : ''}><td className="px-3 py-3">{digits(`${salary.month} / ${salary.year}`)}</td><td className="px-3 py-3 whitespace-nowrap">{money(salary.base_salary)}</td><td className="px-3 py-3 whitespace-nowrap">{money(salary.bonus_amount)}</td><td className="px-3 py-3 whitespace-nowrap">{money(salary.deduction_amount)}</td><td className="px-3 py-3 whitespace-nowrap font-semibold">{money(salary.net_salary)}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs ${salary.status === 'paid' ? 'bg-green-100 text-green-700' : salary.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{salary.status === 'paid' ? 'مدفوع' : salary.status === 'cancelled' ? 'ملغى' : 'غير مدفوع'}</span>{salary.cancel_reason && <p className="mt-1 text-xs text-gray-500">{salary.cancel_reason}</p>}</td><td className="px-3 py-3 whitespace-nowrap">{salary.status === 'paid' ? date(salary.payment_business_date) : '—'}</td></tr>)}
        </tbody></table></div> : <p className="text-sm text-gray-500">لا توجد رواتب شهرية محفوظة لهذا الموظف.</p>}
      </section>}
    </>}
  </div>;
}

export default function EmployeeProfilePage() {
  const { user } = useAuth();
  const schoolScope = useTenantSchool();
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const requestedSchool = positiveId(params.get('school_id'));
  const invalidSchool = params.has('school_id') && requestedSchool == null;
  const mismatch = requestedSchool != null && schoolScope.schoolId != null && requestedSchool !== schoolScope.schoolId;
  return <div className="space-y-5"><SystemAdminSchoolSelector {...schoolScope} />
    {invalidSchool || mismatch ? <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-800">رابط الموظف يخص مدرسة مختلفة أو غير صالحة. اختر المدرسة المطابقة للرابط أو <a className="underline" href="/employees">عد إلى قائمة الموظفين</a>.</div>
      : <EmployeeProfile schoolId={schoolScope.schoolId} employeeId={positiveId(id)} role={user?.role_key}
          requestedAcademicYearId={positiveId(params.get('academic_year_id'))} onYearChange={yearId => { const next = new URLSearchParams(params); next.set('academic_year_id', String(yearId)); if (schoolScope.schoolId != null) next.set('school_id', String(schoolScope.schoolId)); setParams(next, { replace: true }); }} />}
  </div>;
}
