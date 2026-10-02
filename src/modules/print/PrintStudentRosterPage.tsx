import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getAcademicYears } from '../../lib/api';
import { getStudentStudyRoster } from '../../lib/studentStudyStatusApi';
import { STUDY_STATUS_LABELS, type StudentStudyStatusList, type StudyStatus } from '../../lib/studentStudyStatus';
import type { AcademicYearRecord } from '../../lib/academicYears';
import { StudentRosterDocument, filterStudentRoster, type StudentRosterFilters } from '../../components/studentDocuments/StudentRosterDocument';
import { useStaffDocument } from '../../components/staffDocuments/useStaffDocument';
import { useStaffPrint } from '../../components/staffDocuments/useStaffPrint';
import { positiveDocumentId } from '../../components/staffDocuments/documentHelpers';
import { PrintLayout } from '../../components/print';

export function StudentRosterPreview({schoolId, academicYearId, filters = {}, loadRoster = getStudentStudyRoster}: {
  schoolId: number | null; academicYearId: number | null; filters?: StudentRosterFilters; loadRoster?: typeof getStudentStudyRoster;
}) {
  const valid = schoolId != null && academicYearId != null && (!filters.study_status || Object.prototype.hasOwnProperty.call(STUDY_STATUS_LABELS, filters.study_status));
  const key = JSON.stringify([schoolId, academicYearId, filters]);
  const load = useCallback(() => loadRoster({school_id: schoolId!, academic_year_id: academicYearId!}), [schoolId, academicYearId, loadRoster]);
  const matches = useCallback((value: StudentStudyStatusList) => value.school.id === schoolId && value.academic_year.id === academicYearId, [schoolId, academicYearId]);
  const {data, loading, error, reload} = useStaffDocument({schoolId: valid ? schoolId : null, requestKey: key, load, matches});
  const ready = !!data && !loading && !error && filterStudentRoster(data.roster, filters).length > 0;
  const {handlePrint, error: printError} = useStaffPrint(ready ? data : null, '.student-roster-document', `قائمة توزيع الطلاب — ${data?.school.name || ''} — ${data?.academic_year.name || ''}`);
  const back = <a href="/students" className="rounded-lg border px-3 py-2 text-sm">الطلاب</a>;
  if (!data || !ready) return <main dir="rtl" className="mx-auto max-w-xl space-y-4 p-6 text-center"><h1 className="text-xl font-bold">قائمة توزيع الطلاب</h1><p role={error || !valid ? 'alert' : 'status'}>{loading ? 'جاري تحميل قائمة التوزيع…' : !valid ? 'اختر مدرسة وسنة دراسية صحيحتين.' : error || 'لا توجد تسجيلات نشطة تطابق الاختيارات في هذه السنة.'}</p><div className="flex flex-wrap justify-center gap-3">{back}{valid && !loading && <button onClick={reload} className="rounded-lg border px-3 py-2 text-sm">إعادة المحاولة</button>}</div></main>;
  return <div className="student-roster-preview"><div dir="rtl" className="print-controls mx-auto max-w-4xl p-4 text-sm text-gray-600"><p>تتضمن القائمة الطلاب ذوي الدرجات المخفية. لا تتضمن الدرجات أو بيانات الاتصال أو تفاصيل استثناء العمر.</p>{printError && <p role="alert" className="text-red-700">{printError}</p>}</div><PrintLayout size="A4" className="staff-register-print-sheet" onPrint={handlePrint} backButton={<>{back}<button onClick={reload} className="rounded-lg border px-3 py-2 text-sm">تحديث المعاينة</button></>}><StudentRosterDocument summary={data} filters={filters}/></PrintLayout></div>;
}

export default function PrintStudentRosterPage() {
  const [params, setParams] = useSearchParams();
  const schoolId = positiveDocumentId(params.get('school_id')), yearId = positiveDocumentId(params.get('academic_year_id'));
  const [years, setYears] = useState<{schoolId: number; rows: AcademicYearRecord[]} | null>(null);
  useEffect(() => { let active = true; setYears(null); if (schoolId != null) void getAcademicYears(schoolId).then(result => { if (active && result.data) setYears({schoolId, rows: result.data.filter(year => year.school_id === schoolId)}); }); return () => { active = false; }; }, [schoolId]);
  return <><div dir="rtl" className="print-controls mx-auto max-w-4xl p-4"><label className="text-sm">سنة قائمة التوزيع<select aria-label="سنة قائمة التوزيع" className="mx-3 rounded-lg border p-2" value={yearId || ''} onChange={event => { const next = new URLSearchParams(params); next.set('academic_year_id', event.target.value); next.delete('class_id'); next.delete('section_id'); setParams(next); }}><option value="">اختر السنة</option>{years?.schoolId === schoolId && years.rows.map(year => <option key={year.id} value={year.id}>{year.name}</option>)}</select></label></div><StudentRosterPreview schoolId={schoolId} academicYearId={yearId} filters={{q: params.get('q') || '', class_id: positiveDocumentId(params.get('class_id')), section_id: positiveDocumentId(params.get('section_id')), study_status: (params.get('study_status') || '') as StudyStatus | ''}}/></>;
}
