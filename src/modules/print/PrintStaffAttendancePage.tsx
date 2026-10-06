import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getAcademicYears, getEmployeeAttendanceSummary } from '../../lib/api';
import { getStaffRegister } from '../../lib/employeeRecordsApi';
import { BUSINESS_TIME_ZONE, businessDate } from '../../lib/businessTime';
import type { EmployeeAttendanceSummary } from '../../lib/staffAttendance';
import type { StaffRegisterResponse } from '../../types/employees';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { StaffDocumentFrame } from '../../components/staffDocuments/StaffDocumentFrame';
import { useDocumentPagination } from '../../components/staffDocuments/useDocumentPagination';
import { useStaffPrint } from '../../components/staffDocuments/useStaffPrint';
import { staffDigits } from '../../components/staffDocuments/documentHelpers';
import { PrintLayout } from '../../components/print';
import './staffAttendancePrint.css';

interface AttendancePrintData { roster: StaffRegisterResponse; date: string; rows: EmployeeAttendanceSummary[]; academicYearName?: string; }
export function validAttendancePrintDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function clockTime(value: number | null) {
  return value == null ? '—' : new Intl.DateTimeFormat('ar-IQ', { timeZone: BUSINESS_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value * 1000));
}
export function StaffAttendanceDocument({data, blank = false}: {data: AttendancePrintData; blank?: boolean}) {
  const rows = useMemo(() => data.rows.map(row => ({...row, id: row.employee_id})), [data.rows]);
  const {container, pages} = useDocumentPagination(rows, 13, 175, 'tbody tr[data-record-id]', 20);
  const people = new Map(data.roster.employees.map(person => [person.id, person]));
  const day = new Intl.DateTimeFormat('ar-IQ', {weekday: 'long', timeZone: BUSINESS_TIME_ZONE}).format(new Date(`${data.date}T12:00:00Z`));
  return <div ref={container} className="staff-document staff-attendance-document" dir="rtl">{pages.map((page, pageIndex) => <StaffDocumentFrame key={pageIndex} metadata={data.roster} title="سجل دخول ومغادرة الكادر" subtitle={`${data.academicYearName ? `${data.academicYearName} — ` : ''}${day} — ${data.date}${blank ? ' — نموذج للتعبئة اليدوية' : ' — أول دخول وآخر مغادرة مسجلين'}`} pageIndex={pageIndex} pageCount={pages.length} landscape>
    <table className="staff-attendance-print-table"><colgroup><col style={{width:'4%'}}/><col style={{width:'25%'}}/><col style={{width:'17%'}}/><col style={{width:'11%'}}/><col style={{width:'14%'}}/><col style={{width:'11%'}}/><col style={{width:'14%'}}/><col style={{width:'4%'}}/></colgroup>
      <thead><tr>{['ت','الاسم','الاختصاص / الوظيفة','وقت الدخول','التوقيع','وقت المغادرة','التوقيع','تنبيه'].map((label,index)=><th key={index} scope="col">{label}</th>)}</tr></thead>
      <tbody>{page.map((row,index) => <tr key={row.id} data-record-id={row.id}>
        <td>{staffDigits(pages.slice(0,pageIndex).reduce((sum,group)=>sum+group.length,0)+index+1,data.roster.document_settings)}</td>
        <th scope="row">{row.employee_name}</th><td>{people.get(row.id)?.primary_qualification?.general_specialization || row.job_title || 'غير مسجل'}</td>
        <td>{blank ? '' : clockTime(row.first_entry_at)}</td><td aria-label={`توقيع دخول ${row.employee_name}`} className="attendance-signature" />
        <td>{blank ? '' : clockTime(row.last_exit_at)}</td><td aria-label={`توقيع مغادرة ${row.employee_name}`} className="attendance-signature" />
        <td>{!blank && (row.entry_count > 1 || row.exit_count > 1 || row.day_state === 'exception' || row.day_state === 'incomplete') ? '*' : ''}</td>
      </tr>)}</tbody>
    </table>
    <div className="staff-attendance-print-notes"><p>القائمة للكادر النشط حاليًا. الأوقات بتوقيت بغداد. العلامة (*) تعني مراجعة الحركات التفصيلية؛ عدم وجود حركة لا يثبت الغياب.</p><p>اسم وتوقيع مسؤول السجل: ……………………………… اسم وتوقيع المدير: ………………………………</p></div>
  </StaffDocumentFrame>)}</div>;
}

export function StaffAttendancePreview({schoolId, initialDate = businessDate(), loadRoster = getStaffRegister, loadSummary = getEmployeeAttendanceSummary, loadYears = getAcademicYears}: {
  schoolId: number | null; initialDate?: string; loadRoster?: typeof getStaffRegister; loadSummary?: typeof getEmployeeAttendanceSummary; loadYears?: typeof getAcademicYears;
}) {
  const [date,setDate] = useState(initialDate), [blank,setBlank] = useState(false), [refresh,setRefresh] = useState(0);
  const [state,setState] = useState<{key:string;data?:AttendancePrintData;error?:string;loading:boolean}>({key:'',loading:false});
  const requestKey = `${schoolId}:${date}:${refresh}`;
  useEffect(() => {
    let cancelled = false;
    if (schoolId == null || !validAttendancePrintDate(date)) return;
    setState({key:requestKey,loading:true});
    void Promise.all([loadRoster(schoolId,{status:'active'}),loadSummary(schoolId,date),loadYears(schoolId)]).then(([roster,summary,years]) => {
      if (cancelled) return;
      const error = roster.error || summary.error || years.error;
      if (error || !roster.data || !summary.data || !years.data || years.data.some(year=>year.school_id !== schoolId) || roster.data.school.id !== schoolId || summary.data.some(row=>row.attendance_date !== date)) {
        setState({key:requestKey,loading:false,error:error || 'تعذر التحقق من بيانات المدرسة والتاريخ. أعد تحميل المعاينة.'}); return;
      }
      const matchingYears = years.data.filter(year=>year.starts_at<=date && year.ends_at>=date);
      setState({key:requestKey,loading:false,data:{roster:roster.data,date,rows:summary.data,academicYearName:matchingYears.length === 1 ? matchingYears[0].name : undefined}});
    }).catch(() => {if (!cancelled) setState({key:requestKey,loading:false,error:'تعذر تحميل سجل الحضور.'});});
    return () => {cancelled=true;};
  },[schoolId,date,refresh,requestKey,loadRoster,loadSummary,loadYears]);
  const current = state.key === requestKey ? state : null;
  const data = current?.data;
  const snapshot = useMemo(()=>data ? {data,blank} : null,[data,blank]);
  const {handlePrint,error:printError} = useStaffPrint(snapshot,'.staff-attendance-document','سجل دخول ومغادرة الكادر');
  return <main dir="rtl"><div className="print:hidden mx-auto max-w-5xl space-y-4 p-5">
    <div className="flex flex-wrap items-end gap-4"><a className="rounded-lg border bg-white px-4 py-2 text-sm" href="/school-registers">السجلات المدرسية</a><label className="text-sm">تاريخ السجل<input type="date" value={date} onChange={event=>setDate(event.target.value)} className="mt-1 block rounded-lg border p-2"/></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={blank} onChange={event=>setBlank(event.target.checked)}/> ترك الأوقات فارغة للتعبئة اليدوية</label><button className="rounded-lg border bg-white px-4 py-2 text-sm" onClick={()=>setRefresh(value=>value+1)}>تحديث</button></div>
    {schoolId == null && <p role="status">اختر المدرسة لعرض سجل الحضور.</p>}
    {!validAttendancePrintDate(date) && <p role="alert">اختر تاريخًا صالحًا.</p>}
    {schoolId != null && validAttendancePrintDate(date) && (!current || current.loading) && <p role="status">جاري تحميل سجل الحضور…</p>}
    {(current?.error || printError) && <p role="alert" className="text-red-700">{current?.error || printError}</p>}
    {data && !data.rows.length && <p role="status">لا يوجد كادر مطابق للتاريخ المحدد.</p>}
  </div>{data && data.rows.length > 0 && <PrintLayout size={null} className="staff-attendance-print-sheet" onPrint={handlePrint}><StaffAttendanceDocument data={data} blank={blank}/></PrintLayout>}</main>;
}

export default function PrintStaffAttendancePage() {
  const scope = useTenantSchool();
  const [params] = useSearchParams();
  return <><div className="print:hidden p-4"><SystemAdminSchoolSelector {...scope}/></div><StaffAttendancePreview key={scope.schoolId ?? 'none'} schoolId={scope.schoolId} initialDate={params.get('date') || businessDate()}/></>;
}
