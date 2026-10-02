import { useCallback, useState } from 'react';
import { Printer, Users } from 'lucide-react';
import { getStaffRegister } from '../../lib/employeeRecordsApi';
import type { StaffRegisterResponse } from '../../types/employees';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { useStaffDocument } from '../../components/staffDocuments/useStaffDocument';
import { StaffPhoto } from '../../components/staffDocuments/StaffRegisterDocument';
import { EMPLOYEE_ROLE_LABELS, EMPLOYEE_STATUS_LABELS, staffDate, staffDigits } from '../../components/staffDocuments/documentHelpers';

const fieldClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm';
export function StaffRegisterManager({schoolId, loadRegister = getStaffRegister}: {schoolId: number | null; loadRegister?: typeof getStaffRegister}) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active');
  const q = search.trim();
  const key = JSON.stringify([schoolId, q, role, status]);
  const load = useCallback(() => loadRegister(schoolId!, {q, role, status}), [loadRegister, schoolId, q, role, status]);
  const matches = useCallback((value: StaffRegisterResponse) => value.school.id === schoolId && value.filters.q === q && value.filters.role === role && value.filters.status === status, [schoolId, q, role, status]);
  const {data, loading, error, reload} = useStaffDocument({schoolId, requestKey: key, load, matches});
  const params = new URLSearchParams({school_id: String(schoolId), q, role, status});
  const ready = !!data?.employees.length && !loading && !error;
  return <section dir="rtl" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><Users/>سجل الكادر</h1><p className="mt-2 text-sm text-gray-600">موظفو المدرسة وبياناتهم الوظيفية. افتح الاسم لعرض الملف الكامل.</p></div><div className="flex gap-2"><a href="/employees" className="rounded-lg border px-4 py-2 text-sm">إدارة الموظفين</a>{ready && <a href={`/print/staff-register?${params}`} className="flex items-center gap-2 rounded-lg bg-primary-700 px-4 py-2 text-sm text-white"><Printer size={17}/>معاينة السجل وطباعته</a>}</div></div>
    <div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-3">
      <label className="space-y-1 text-sm">البحث بالاسم أو الرقم أو الوظيفة<input aria-label="البحث في سجل الكادر" value={search} onChange={event => setSearch(event.target.value)} maxLength={200} className={fieldClass}/></label>
      <label className="space-y-1 text-sm">الوظيفة<select aria-label="الوظيفة" value={role} onChange={event => setRole(event.target.value)} className={fieldClass}><option value="">جميع الوظائف</option>{Object.entries(EMPLOYEE_ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="space-y-1 text-sm">الحالة<select aria-label="حالة الموظف" value={status} onChange={event => setStatus(event.target.value as typeof status)} className={fieldClass}><option value="active">النشطون</option><option value="archived">المؤرشفون</option><option value="all">الجميع، بما فيهم المؤرشفون</option></select></label>
    </div>
    {schoolId == null && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4">اختر المدرسة لعرض سجل الكادر.</p>}
    {loading && <p role="status" className="p-6 text-center">جاري تحميل سجل الكادر…</p>}
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error} <button type="button" onClick={reload} className="underline">إعادة المحاولة</button></div>}
    {data && !loading && <>
      <p className="text-sm text-gray-600">عدد الموظفين: {staffDigits(data.employees.length, data.document_settings)} · تاريخ المعاينة: {staffDate(data.prepared_at, data.document_settings)}</p>
      {!data.employees.length && <p role="status" className="rounded-xl border border-dashed p-8 text-center text-gray-500">لا يوجد موظفون مطابقون للاختيارات الحالية.</p>}
      <div className="grid gap-4 lg:grid-cols-2">{data.employees.map(employee => <article className="rounded-xl border border-gray-200 bg-white p-4" data-employee-id={employee.id} key={employee.id}>
        <div className="flex gap-4">{data.can_view_private && <StaffPhoto employee={employee}/>}<div className="min-w-0 flex-1"><a href={`/employees/${employee.id}?school_id=${schoolId}`} className="break-words text-lg font-bold text-primary-700 hover:underline">{employee.full_name}</a><p className="mt-1 text-sm text-gray-600">{employee.job_title || EMPLOYEE_ROLE_LABELS[employee.role] || employee.role}</p><p className="mt-1 text-sm">الرقم الوظيفي: {staffDigits(employee.employee_number || 'غير مسجل', data.document_settings)}</p><span className={`mt-2 inline-block rounded px-2 py-1 text-xs ${employee.status === 'active' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>{EMPLOYEE_STATUS_LABELS[employee.status] || employee.status}</span>
          {data.can_view_private && <p className="mt-2 break-words text-sm text-gray-600">المؤهل: {employee.primary_qualification ? [employee.primary_qualification.degree, employee.primary_qualification.general_specialization, employee.primary_qualification.institution].filter(Boolean).join(' — ') : 'غير مسجل'}</p>}
        </div></div>
      </article>)}</div>
    </>}
  </section>;
}

export default function StaffRegisterPage() {
  const scope = useTenantSchool();
  return <><SystemAdminSchoolSelector {...scope}/><StaffRegisterManager key={scope.schoolId ?? 'none'} schoolId={scope.schoolId}/></>;
}
