import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getStaffRegister, type StaffRegisterFilters } from '../../lib/employeeRecordsApi';
import type { StaffRegisterResponse } from '../../types/employees';
import { StaffRegisterDocument } from '../../components/staffDocuments/StaffRegisterDocument';
import { useStaffDocument } from '../../components/staffDocuments/useStaffDocument';
import { useStaffPrint } from '../../components/staffDocuments/useStaffPrint';
import { positiveDocumentId } from '../../components/staffDocuments/documentHelpers';
import { PrintLayout } from '../../components/print';

export function StaffRegisterPreview({schoolId, filters = {}, loadRegister = getStaffRegister}: {
  schoolId: number | null; filters?: StaffRegisterFilters; loadRegister?: typeof getStaffRegister;
}) {
  const q = (filters.q || '').trim(), role = filters.role || '', status = filters.status || 'active';
  const valid = ['active', 'archived', 'all'].includes(status);
  const key = JSON.stringify([schoolId, q, role, status]);
  const load = useCallback(() => loadRegister(schoolId!, {q, role, status}), [schoolId, q, role, status, loadRegister]);
  const matches = useCallback((value: StaffRegisterResponse) => value.school.id === schoolId && value.filters.q === q && value.filters.role === role && value.filters.status === status, [schoolId, q, role, status]);
  const {data, loading, error, reload} = useStaffDocument({schoolId: valid ? schoolId : null, requestKey: key, load, matches});
  const ready = !loading && !error && !!data?.employees.length;
  const {handlePrint, error: printError} = useStaffPrint(ready ? data : null, '.staff-register-document', `سجل الكادر — ${data?.school.name || ''}`);
  const back = <a href="/staff-register" className="rounded-lg border px-3 py-2 text-sm">سجل الكادر</a>;
  if (!ready || !data) return <main dir="rtl" className="mx-auto max-w-xl space-y-4 p-8 text-center"><h1 className="text-2xl font-bold">معاينة سجل الكادر</h1><p role={error || !valid || schoolId == null ? 'alert' : 'status'}>{loading ? 'جاري تحميل سجل الكادر…' : schoolId == null || !valid ? 'اختر مدرسة وحالة صحيحتين من صفحة سجل الكادر.' : error || 'لا يوجد موظفون مطابقون للاختيارات الحالية.'}</p><div className="flex justify-center gap-3">{back}{!loading && <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={reload}>إعادة المحاولة</button>}</div></main>;
  return <><div dir="rtl" className="print-controls mx-auto max-w-4xl space-y-2 p-4 text-sm text-gray-600"><p>معاينة البيانات الحالية؛ لا تنشئ الطباعة إصداراً محفوظاً أو رقم كتاب. راجع الصور والمؤهلات قبل حفظ PDF.</p>{printError && <p role="alert" className="text-red-700">{printError}</p>}</div><PrintLayout size="A4" className="staff-register-print-sheet" onPrint={handlePrint} backButton={<>{back}<button type="button" onClick={reload} className="rounded-lg border px-3 py-2 text-sm">تحديث المعاينة</button></>}><StaffRegisterDocument summary={data}/></PrintLayout></>;
}

export default function PrintStaffRegisterPage() {
  const [params] = useSearchParams();
  return <StaffRegisterPreview schoolId={positiveDocumentId(params.get('school_id'))} filters={{q: params.get('q') || '', role: params.get('role') || '', status: (params.get('status') || 'active') as StaffRegisterFilters['status']}}/>;
}
