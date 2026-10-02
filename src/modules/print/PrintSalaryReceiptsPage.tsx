import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getSalaryReceipts } from '../../lib/employeeRecordsApi';
import type { SalaryReceiptsResponse } from '../../types/employees';
import { SalaryReceiptsDocument } from '../../components/staffDocuments/SalaryReceiptsDocument';
import { useStaffDocument } from '../../components/staffDocuments/useStaffDocument';
import { useStaffPrint } from '../../components/staffDocuments/useStaffPrint';
import { positiveDocumentId } from '../../components/staffDocuments/documentHelpers';
import { PrintLayout } from '../../components/print';

export function SalaryReceiptsPreview({schoolId, month, year, status = 'unpaid', loadReceipts = getSalaryReceipts}: {
  schoolId: number | null; month: number; year: number; status?: SalaryReceiptsResponse['status']; loadReceipts?: typeof getSalaryReceipts;
}) {
  const valid = Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(year) && year >= 2000 && year <= 2200 && ['unpaid', 'paid', 'cancelled', 'all'].includes(status);
  const key = JSON.stringify([schoolId, month, year, status]);
  const load = useCallback(() => loadReceipts(schoolId!, {month, year, status}), [schoolId, month, year, status, loadReceipts]);
  const matches = useCallback((value: SalaryReceiptsResponse) => value.school.id === schoolId && value.month === month && value.year === year && value.status === status, [schoolId, month, year, status]);
  const {data, loading, error, reload} = useStaffDocument({schoolId: valid ? schoolId : null, requestKey: key, load, matches});
  const ready = !loading && !error && !!data?.rows.length;
  const {handlePrint, error: printError} = useStaffPrint(ready ? data : null, '.salary-receipts-document', `كشف استلام الرواتب — ${data?.school.name || ''} — ${month}-${year}`);
  const back = <a href="/salary-receipts" className="rounded-lg border px-3 py-2 text-sm">كشف استلام الرواتب</a>;
  if (!ready || !data) return <main dir="rtl" className="mx-auto max-w-xl space-y-4 p-8 text-center"><h1 className="text-2xl font-bold">معاينة كشف استلام الرواتب</h1><p role={error || !valid || schoolId == null ? 'alert' : 'status'}>{loading ? 'جاري تحميل كشف الرواتب…' : schoolId == null || !valid ? 'اختر المدرسة والشهر والسنة والحالة من صفحة كشف الرواتب.' : error || (data?.period_record_count === 0 ? 'لم تُولّد رواتب للشهر المختار.' : 'لا توجد رواتب بالحالة المختارة.')}</p><div className="flex flex-wrap justify-center gap-3">{back}{data?.period_record_count === 0 && <a href="/employees?tab=generate" className="rounded-lg border px-3 py-2 text-sm">توليد الرواتب</a>}{!loading && <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={reload}>إعادة المحاولة</button>}</div></main>;
  return <><div dir="rtl" className="print-controls mx-auto max-w-4xl space-y-2 p-4 text-sm text-gray-600"><p>الكشف يعتمد رواتب الشهر المحفوظة. الرواتب الملغاة مستبعدة من الإجمالي، والتوقيع الورقي لا يغيّر حالة الدفع في النظام.</p>{data.missing_employee_count > 0 && <p role="status" className="text-amber-800">يوجد موظفون لم تُولّد رواتبهم لهذا الشهر. <a href="/employees?tab=generate" className="underline">مراجعة توليد الرواتب</a></p>}{printError && <p role="alert" className="text-red-700">{printError}</p>}</div><PrintLayout size={null} className="salary-receipts-print-sheet" onPrint={handlePrint} backButton={<>{back}<button type="button" onClick={reload} className="rounded-lg border px-3 py-2 text-sm">تحديث المعاينة</button></>}><SalaryReceiptsDocument summary={data}/></PrintLayout></>;
}

export default function PrintSalaryReceiptsPage() {
  const [params] = useSearchParams();
  return <SalaryReceiptsPreview schoolId={positiveDocumentId(params.get('school_id'))} month={Number(params.get('month'))} year={Number(params.get('year'))} status={(params.get('status') || 'unpaid') as SalaryReceiptsResponse['status']}/>;
}
