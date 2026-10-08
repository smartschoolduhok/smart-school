import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getAcademicYears } from '../../lib/api';
import { getStudentStudyRoster } from '../../lib/studentStudyStatusApi';
import type { AcademicYearRecord } from '../../lib/academicYears';
import type { StudentStudyStatusList } from '../../lib/studentStudyStatus';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { PrintLayout } from '../../components/print';
import { positiveDocumentId } from '../../components/staffDocuments/documentHelpers';
import { useDocumentPagination } from '../../components/staffDocuments/useDocumentPagination';
import { useStaffDocument } from '../../components/staffDocuments/useStaffDocument';
import { useStaffPrint } from '../../components/staffDocuments/useStaffPrint';
import '../../components/staffDocuments/staffDocuments.css';
import './studentAttendancePrint.css';

const LESSON_COUNTS = Array.from({length: 8}, (_, index) => index + 1);
const validLessonCount = (value: number) => Number.isSafeInteger(value) && LESSON_COUNTS.includes(value) ? value : 6;
const sectionKey = (id: number | null) => id == null ? 'unassigned' : String(id);

interface StudentAttendanceDocumentProps {
  summary: StudentStudyStatusList;
  classId: number;
  sectionId: number | null;
  lessonCount?: number;
}

export function StudentAttendanceDocument({summary, classId, sectionId, lessonCount = 6}: StudentAttendanceDocumentProps) {
  const lessons = Array.from({length: validLessonCount(lessonCount)}, (_, index) => index + 1);
  const rows = useMemo(() => summary.roster.filter(row => row.class_id === classId && row.section_id === sectionId)
    .map((row, index) => ({...row, id: row.student_id, ordinal: index + 1})), [summary, classId, sectionId]);
  const {container, pages} = useDocumentPagination(rows, 26, 258, '.student-attendance-row', 32);
  const group = rows[0];

  return <div ref={container} dir="rtl" lang="ar" className="staff-document student-attendance-document">
    {pages.map((page, pageIndex) => <article className="staff-document-page student-attendance-page" key={pageIndex} aria-label={`سجل حضور الطلبة — صفحة ${pageIndex + 1}`}>
      <header className="staff-document-header">
        <p className="student-attendance-school">{summary.school.name}</p>
        <h1>سجل حضور الطلبة اليومي</h1>
        <p className="student-attendance-scope">السنة الدراسية: <bdi>{summary.academic_year.name}</bdi> · الصف: {group?.class_name} · الشعبة: {group?.section_name || 'بلا شعبة'}</p>
        <div className="student-attendance-day"><span>اليوم: <span aria-label="اليوم" className="student-attendance-write-line" /></span><span>التاريخ: <span aria-label="التاريخ" className="student-attendance-write-line" /></span><span>عدد الطلبة: {rows.length}</span></div>
      </header>
      <table className="student-attendance-table">
        <colgroup><col style={{width: '6%'}}/><col style={{width: '34%'}}/>{lessons.map(lesson => <col key={lesson} style={{width: `${60 / lessons.length}%`}}/>)}</colgroup>
        <thead><tr><th scope="col">ت</th><th scope="col">اسم الطالب</th>{lessons.map(lesson => <th key={lesson} scope="col">الدرس {lesson}</th>)}</tr></thead>
        <tbody>{page.map(row => <tr key={row.id} data-record-id={row.id} className="student-attendance-row">
          <td>{row.ordinal}</td><th scope="row">{row.full_name}</th>{lessons.map(lesson => <td key={lesson} className="student-attendance-mark" aria-label={`حضور ${row.full_name} في الدرس ${lesson}`} />)}
        </tr>)}</tbody>
        <tfoot>
          <tr><th scope="row" colSpan={2}>اسم المدرس</th>{lessons.map(lesson => <td key={lesson} className="student-attendance-teacher" aria-label={`اسم مدرس الدرس ${lesson}`} />)}</tr>
          <tr><th scope="row" colSpan={2}>توقيع المدرس</th>{lessons.map(lesson => <td key={lesson} className="student-attendance-signature" aria-label={`توقيع مدرس الدرس ${lesson}`} />)}</tr>
        </tfoot>
      </table>
      <p className="student-attendance-instructions">توضع علامة (✓) للطالب الحاضر في خانة الدرس، ويكتب مدرس كل درس اسمه ويوقّع أسفل العمود.</p>
      <footer className="staff-document-footer">الصفحة {pageIndex + 1} من {pages.length}</footer>
    </article>)}
  </div>;
}

interface StudentAttendancePreviewProps {
  schoolId: number | null;
  initialAcademicYearId?: number | null;
  initialClassId?: number | null;
  initialSectionId?: number | null;
  initialLessonCount?: number;
  loadYears?: typeof getAcademicYears;
  loadRoster?: typeof getStudentStudyRoster;
}

function StudentAttendancePreviewContent({schoolId, initialAcademicYearId = null, initialClassId = null, initialSectionId,
  initialLessonCount = 6, loadYears = getAcademicYears, loadRoster = getStudentStudyRoster}: StudentAttendancePreviewProps) {
  const [yearChoice, setYearChoice] = useState<number | null | undefined>(initialAcademicYearId ?? undefined);
  const [classId, setClassId] = useState<number | null>(initialClassId);
  const [sectionChoice, setSectionChoice] = useState(initialSectionId === undefined ? '' : sectionKey(initialSectionId));
  const [lessonCount, setLessonCount] = useState(validLessonCount(initialLessonCount));
  const yearsLoad = useCallback(() => loadYears(schoolId!), [loadYears, schoolId]);
  const yearsMatch = useCallback((rows: AcademicYearRecord[]) => rows.every(year => year.school_id === schoolId), [schoolId]);
  const years = useStaffDocument({schoolId, requestKey: `student-attendance-years:${schoolId}`, load: yearsLoad, matches: yearsMatch});
  const yearId = yearChoice === undefined ? years.data?.find(year => year.is_active)?.id ?? null : yearChoice;
  const validYear = years.data?.some(year => year.id === yearId) ?? false;
  const rosterLoad = useCallback(() => loadRoster({school_id: schoolId!, academic_year_id: yearId!}), [loadRoster, schoolId, yearId]);
  const rosterMatch = useCallback((data: StudentStudyStatusList) => data.school.id === schoolId && data.academic_year.id === yearId, [schoolId, yearId]);
  const roster = useStaffDocument({schoolId: validYear ? schoolId : null, requestKey: `student-attendance:${schoolId}:${yearId}:${validYear}`, load: rosterLoad, matches: rosterMatch});
  const data = roster.data;
  const classes = [...new Map((data?.roster || []).map(row => [row.class_id, row.class_name])).entries()];
  const classRows = data?.roster.filter(row => row.class_id === classId) || [];
  const sections = [...new Map(classRows.map(row => [sectionKey(row.section_id), row.section_name || 'بلا شعبة'])).entries()];
  const selectedSection = sectionChoice === 'unassigned' ? null : positiveDocumentId(sectionChoice);
  const hasSection = !!sectionChoice && sections.some(([id]) => id === sectionChoice);
  const ready = !!data && !roster.loading && !roster.error && !!classId && hasSection;
  const snapshot = useMemo(() => ready ? {data, classId, sectionId: selectedSection, lessonCount} : null, [ready, data, classId, selectedSection, lessonCount]);
  const {handlePrint, error: printError} = useStaffPrint(snapshot, '.student-attendance-document', `سجل حضور الطلبة — ${data?.school.name || ''}`);
  const error = years.error || roster.error || printError;

  return <main dir="rtl" className="student-attendance-preview">
    <div className="print-controls mx-auto max-w-5xl space-y-4 p-5">
      <h1 className="text-xl font-bold">سجل حضور الطلبة الورقي</h1>
      <p className="text-sm text-gray-600">اختر الصف والشعبة وعدد الدروس، ثم اطبع نسخًا للاستخدام اليومي. اليوم والتاريخ وخانات الحضور واسم المدرس وتوقيعه تبقى فارغة للتعبئة بالقلم.</p>
      <div className="flex flex-wrap items-end gap-4">
        <a href="/attendance" className="rounded-lg border bg-white px-4 py-2 text-sm">حضور الطلبة</a>
        <label className="text-sm">السنة الدراسية<select aria-label="السنة الدراسية" className="mt-1 block rounded-lg border p-2" value={yearId ?? ''} disabled={years.loading || !years.data?.length} onChange={event => {setYearChoice(positiveDocumentId(event.target.value)); setClassId(null); setSectionChoice('');}}><option value="">اختر السنة</option>{years.data?.map(year => <option key={year.id} value={year.id}>{year.name}</option>)}</select></label>
        <label className="text-sm">الصف<select aria-label="الصف" className="mt-1 block rounded-lg border p-2" value={classId ?? ''} disabled={!data} onChange={event => {setClassId(positiveDocumentId(event.target.value)); setSectionChoice('');}}><option value="">اختر الصف</option>{classes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="text-sm">الشعبة<select aria-label="الشعبة" className="mt-1 block rounded-lg border p-2" value={sectionChoice} disabled={!classRows.length} onChange={event => setSectionChoice(event.target.value)}><option value="">اختر الشعبة</option>{sections.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="text-sm">عدد الدروس<select aria-label="عدد الدروس" className="mt-1 block rounded-lg border p-2" value={lessonCount} onChange={event => setLessonCount(validLessonCount(Number(event.target.value)))}>{LESSON_COUNTS.map(count => <option key={count} value={count}>{count}</option>)}</select></label>
        <button type="button" className="rounded-lg border bg-white px-4 py-2 text-sm" onClick={() => {years.reload(); roster.reload();}} disabled={schoolId == null}>تحديث المعاينة</button>
      </div>
      {schoolId == null && <p role="status">اختر المدرسة لعرض سجل حضور الطلبة.</p>}
      {schoolId != null && (years.loading || roster.loading) && <p role="status">جاري تحميل أسماء الطلبة…</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {schoolId != null && !years.loading && !years.error && !validYear && <p role="status">اختر سنة دراسية متاحة لهذه المدرسة.</p>}
      {data && !data.roster.length && <p role="status">لا توجد تسجيلات طلاب نشطة في السنة المختارة.</p>}
      {data && data.roster.length > 0 && !ready && <p role="status">اختر الصف والشعبة لعرض سجل الحضور.</p>}
    </div>
    {ready && data && classId != null && <PrintLayout size="A4" className="staff-register-print-sheet student-attendance-print-sheet" onPrint={handlePrint}><StudentAttendanceDocument summary={data} classId={classId} sectionId={selectedSection} lessonCount={lessonCount}/></PrintLayout>}
  </main>;
}

/** Remount school-specific choices as well as requests whenever the tenant changes. */
export function StudentAttendancePreview(props: StudentAttendancePreviewProps) {
  return <StudentAttendancePreviewContent key={props.schoolId ?? 'none'} {...props}/>;
}

export default function PrintStudentAttendancePage() {
  const scope = useTenantSchool();
  const [params] = useSearchParams();
  return <><div className="print-controls p-4"><SystemAdminSchoolSelector {...scope}/></div><StudentAttendancePreview schoolId={scope.schoolId}
    initialAcademicYearId={positiveDocumentId(params.get('academic_year_id'))} initialClassId={positiveDocumentId(params.get('class_id'))}
    initialSectionId={params.get('section_id') === 'unassigned' ? null : positiveDocumentId(params.get('section_id')) ?? undefined}
    initialLessonCount={validLessonCount(Number(params.get('lesson_count')))}/></>;
}
