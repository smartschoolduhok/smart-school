import { useCallback, useState } from 'react';
import { Printer, FileText } from 'lucide-react';
import { getSalaryReceipts } from '../../lib/employeeRecordsApi';
import { businessMonth } from '../../lib/businessTime';
import type { SalaryReceiptsResponse } from '../../types/employees';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { useStaffDocument } from '../../components/staffDocuments/useStaffDocument';
import { receiptTotals, SALARY_STATUS_LABELS, SALARY_ROW_LABELS, staffDate, staffDigits, staffMoney } from '../../components/staffDocuments/documentHelpers';

export function SalaryReceiptsManager({schoolId, loadReceipts = getSalaryReceipts}: {schoolId: number | null; loadReceipts?: typeof getSalaryReceipts}) {
  const [period, setPeriod] = useState(businessMonth);
  const [status, setStatus] = useState<SalaryReceiptsResponse['status']>('unpaid');
  const [year, month] = period.split('-').map(Number);
  const validPeriod = Number.isSafeInteger(year) && year >= 2000 && year <= 2200 && Number.isInteger(month) && month >= 1 && month <= 12;
  const key = JSON.stringify([schoolId, year, month, status]);
  const load = useCallback(() => loadReceipts(schoolId!, {month, year, status}), [loadReceipts, schoolId, month, year, status]);
  const matches = useCallback((value: SalaryReceiptsResponse) => value.school.id === schoolId && value.month === month && value.year === year && value.status === status, [schoolId, month, year, status]);
  const {data, loading, error, reload} = useStaffDocument({schoolId: validPeriod ? schoolId : null, requestKey: key, load, matches});
  const params = new URLSearchParams({school_id: String(schoolId), month: String(month), year: String(year), status});
  const totals = receiptTotals(data?.rows || []);
  return <section dir="rtl" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><FileText/>كشف استلام الرواتب</h1><p className="mt-2 text-sm text-gray-600">مبالغ الشهر المحفوظة، مع خانة للتوقيع الورقي. الطباعة لا تثبت الدفع.</p></div><div className="flex gap-2"><a href="/employees?tab=salaries" className="rounded-lg border px-4 py-2 text-sm">إدارة الرواتب</a>{data && data.rows.length > 0 && !loading && !error && <a href={`/print/salary-receipts?${params}`} className="flex items-center gap-2 rounded-lg bg-primary-700 px-4 py-2 text-sm text-white"><Printer size={17}/>معاينة الكشف وطباعته</a>}</div></div>
    <div className="flex flex-wrap gap-4 rounded-xl border bg-white p-4"><label className="space-y-1 text-sm">الشهر والسنة<input aria-label="شهر كشف الرواتب" type="month" min="2000-01" max="2200-12" value={period} onChange={event => setPeriod(event.target.value)} className="block rounded-lg border border-gray-300 px-3 py-2"/></label><label className="space-y-1 text-sm">حالة الرواتب<select aria-label="حالة الرواتب" value={status} onChange={event => setStatus(event.target.value as typeof status)} className="block rounded-lg border border-gray-300 px-3 py-2">{Object.entries(SALARY_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    {schoolId == null && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4">اختر المدرسة لعرض كشف الرواتب.</p>}
    {!validPeriod && <p role="alert" className="text-red-700">اختر شهراً وسنة صحيحين.</p>}
    {loading && <p role="status" className="p-6 text-center">جاري تحميل كشف الرواتب…</p>}
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error} <button type="button" onClick={reload} className="underline">إعادة المحاولة</button></div>}
    {data && !loading && <>
      {data.period_record_count === 0 ? <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-5">لم تُولّد رواتب لهذا الشهر. <a className="font-bold underline" href="/employees?tab=generate">الانتقال إلى توليد الرواتب</a></div>
        : <p className="text-sm text-gray-600">غير مدفوع: {staffDigits(data.status_counts.unpaid, data.document_settings)} · مدفوع: {staffDigits(data.status_counts.paid, data.document_settings)} · ملغى: {staffDigits(data.status_counts.cancelled, data.document_settings)}</p>}
      {data.missing_employee_count > 0 && <details className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><summary>لم تُولّد رواتب لـ {staffDigits(data.missing_employee_count, data.document_settings)} موظف نشط؛ لا تشملهم الإجماليات.</summary><ul className="mt-2 list-inside list-disc">{data.missing_employees.map(employee => <li key={employee.id}>{employee.full_name} {employee.employee_number && `(${staffDigits(employee.employee_number, data.document_settings)})`}</li>)}</ul><a className="mt-2 inline-block underline" href="/employees?tab=generate">توليد الرواتب</a></details>}
      {data.rows.length === 0 && data.period_record_count > 0 && <p role="status" className="rounded-xl border border-dashed p-8 text-center">لا توجد رواتب بهذه الحالة في الشهر المختار.</p>}
      {data.rows.length > 0 && <><div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[900px] text-sm"><thead className="bg-gray-50"><tr>{['الرقم', 'الموظف', 'الأساسي', 'الإضافات', 'الاستقطاعات', 'الصافي', 'الحالة', 'تاريخ الاستلام'].map(label => <th key={label} className="p-3 text-right">{label}</th>)}</tr></thead><tbody>{data.rows.map(row => <tr className="border-t" key={row.id} data-salary-id={row.id}><td className="p-3">{staffDigits(row.employee_number || 'غير مسجل', data.document_settings)}</td><th className="p-3 text-right font-medium"><a className="text-primary-700 underline" href={`/employees/${row.employee_id}?school_id=${schoolId}`}>{row.employee_name || 'غير مسجل'}</a>{row.employee_status === 'archived' && <small className="block text-amber-800">موظف مؤرشف</small>}</th>{[row.base_salary, row.bonus_amount, row.deduction_amount, row.net_salary].map((amount, i) => <td className="p-3" key={i}><bdi>{staffMoney(amount, data.document_settings)}</bdi></td>)}<td className="p-3">{SALARY_ROW_LABELS[row.status] || row.status}</td><td className="p-3">{row.status === 'paid' ? staffDate(row.payment_business_date || row.paid_at, data.document_settings) : '—'}</td></tr>)}</tbody></table></div><p className="rounded-xl border border-green-200 bg-green-50 p-4 font-bold text-green-900">إجمالي الصافي دون الرواتب الملغاة: <bdi>{staffMoney(totals.net_salary, data.document_settings)}</bdi> {data.document_settings.currency}</p></>}
    </>}
  </section>;
}

export default function SalaryReceiptsPage() {
  const scope = useTenantSchool();
  return <><SystemAdminSchoolSelector {...scope}/><SalaryReceiptsManager key={scope.schoolId ?? 'none'} schoolId={scope.schoolId}/></>;
}
