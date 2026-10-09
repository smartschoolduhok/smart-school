import { useCallback, useMemo } from 'react';
import { getStaffRegister } from '../../lib/employeeRecordsApi';
import type { StaffRegisterResponse } from '../../types/employees';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { StaffDocumentFrame } from '../../components/staffDocuments/StaffDocumentFrame';
import { useDocumentPagination } from '../../components/staffDocuments/useDocumentPagination';
import { useStaffDocument } from '../../components/staffDocuments/useStaffDocument';
import { useStaffPrint } from '../../components/staffDocuments/useStaffPrint';
import { staffDigits } from '../../components/staffDocuments/documentHelpers';
import { PrintLayout } from '../../components/print';
import './staffAttendancePrint.css';

export function StaffAttendanceDocument({roster}: {roster: StaffRegisterResponse}) {
  const rows = useMemo(() => roster.employees.filter(person => person.status === 'active'), [roster]);
  const {container, pages} = useDocumentPagination(rows, 28, 267, 'tbody tr[data-record-id]', 14);
  return <div ref={container} className="staff-document staff-attendance-document" dir="rtl">{pages.map((page, pageIndex) => <StaffDocumentFrame key={pageIndex} metadata={roster} title="سجل حضور وتوقيع الكادر والموظفين" subtitle="اليوم: ............................          التاريخ: ........ / ........ / ................" pageIndex={pageIndex} pageCount={pages.length} showPreparedDate={false}>
    <table className="staff-attendance-print-table"><colgroup><col style={{width:'5%'}}/><col style={{width:'28%'}}/><col style={{width:'12%'}}/><col style={{width:'15%'}}/><col style={{width:'12%'}}/><col style={{width:'15%'}}/><col style={{width:'13%'}}/></colgroup>
      <thead><tr>{['ت','اسم الموظف','وقت الدخول','توقيع الدخول','وقت الخروج','توقيع الخروج','ملاحظات'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{page.map((person,index) => <tr key={person.id} data-record-id={person.id}>
        <td>{staffDigits(pages.slice(0,pageIndex).reduce((sum,group)=>sum+group.length,0)+index+1,roster.document_settings)}</td>
        <th scope="row">{person.full_name}</th>
        <td aria-label={`وقت دخول ${person.full_name}`} className="attendance-time"/><td aria-label={`توقيع دخول ${person.full_name}`} className="attendance-signature"/>
        <td aria-label={`وقت خروج ${person.full_name}`} className="attendance-time"/><td aria-label={`توقيع خروج ${person.full_name}`} className="attendance-signature"/>
        <td aria-label={`ملاحظات ${person.full_name}`} className="attendance-notes"/>
      </tr>)}</tbody>
    </table>
    <div className="staff-attendance-print-notes"><p>اسم وتوقيع مسؤول السجل: ....................................</p><p>اسم وتوقيع المدير: ....................................</p></div>
  </StaffDocumentFrame>)}</div>;
}

export function StaffAttendancePreview({schoolId, loadRoster = getStaffRegister}: {
  schoolId: number | null; loadRoster?: typeof getStaffRegister;
}) {
  const load = useCallback(() => loadRoster(schoolId!, {status:'active'}), [schoolId, loadRoster]);
  const matches = useCallback((value: StaffRegisterResponse) => value.school.id === schoolId && value.employees.every(person => person.school_id === schoolId), [schoolId]);
  const {data, loading, error, reload} = useStaffDocument({schoolId, requestKey:String(schoolId), load, matches});
  const ready = !!data && !loading && !error && data.employees.some(person => person.status === 'active');
  const {handlePrint,error:printError} = useStaffPrint(ready ? data : null,'.staff-attendance-document','سجل حضور وتوقيع الكادر والموظفين',267);
  return <main dir="rtl"><div className="print:hidden mx-auto max-w-5xl space-y-4 p-5">
    <div className="flex flex-wrap items-center gap-4"><a className="rounded-lg border bg-white px-4 py-2 text-sm" href="/school-registers">السجلات المدرسية</a><button type="button" className="rounded-lg border bg-white px-4 py-2 text-sm" onClick={reload} disabled={loading || schoolId == null}>تحديث الأسماء</button></div>
    <p className="text-sm text-gray-600">أسماء الكادر والموظفين في كشف واحد. اليوم والتاريخ وأوقات الدخول والخروج والتواقيع تُكتب يدويًا. حدد عدد النسخ من نافذة الطباعة لاستخدام النموذج في أيام متعددة.</p>
    {schoolId == null && <p role="status">اختر المدرسة لعرض سجل الحضور.</p>}
    {loading && <p role="status">جاري تحميل أسماء الكادر والموظفين…</p>}
    {(error || printError) && <p role="alert" className="text-red-700">{error || printError}</p>}
    {data && !loading && !error && !ready && <p role="status">لا يوجد كادر أو موظفون نشطون في المدرسة.</p>}
  </div>{ready && <PrintLayout size="A4" className="staff-attendance-print-sheet" onPrint={handlePrint}><StaffAttendanceDocument roster={data}/></PrintLayout>}</main>;
}

export default function PrintStaffAttendancePage() {
  const scope = useTenantSchool();
  return <><div className="print:hidden p-4"><SystemAdminSchoolSelector {...scope}/></div><StaffAttendancePreview key={scope.schoolId ?? 'none'} schoolId={scope.schoolId}/></>;
}
