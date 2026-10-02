import { useMemo } from 'react';
import { STUDY_STATUS_LABELS, type StudentStudyRosterRow, type StudentStudyStatusList, type StudyStatus } from '../../lib/studentStudyStatus';
import { useDocumentPagination } from '../staffDocuments/useDocumentPagination';
import '../staffDocuments/staffDocuments.css';
import './studentRoster.css';

export interface StudentRosterFilters { q?: string; class_id?: number | null; section_id?: number | null; study_status?: StudyStatus | ''; }
export function filterStudentRoster(rows: StudentStudyRosterRow[], filters: StudentRosterFilters) {
  const query = (filters.q || '').trim().toLocaleLowerCase('ar');
  return rows.filter(row => (!filters.class_id || row.class_id === filters.class_id) && (!filters.section_id || row.section_id === filters.section_id)
    && (!filters.study_status || row.study_status === filters.study_status) && (!query || `${row.full_name} ${row.student_number}`.toLocaleLowerCase('ar').includes(query)));
}
export function StudentRosterDocument({summary, filters = {}}: {summary: StudentStudyStatusList; filters?: StudentRosterFilters}) {
  const rows = useMemo(() => filterStudentRoster(summary.roster, filters).map((row, index) => ({...row, id: row.student_id, ordinal: index + 1})), [summary, filters.q, filters.class_id, filters.section_id, filters.study_status]);
  const {container, pages} = useDocumentPagination(rows, 26, 258, '.student-roster-row', 10);
  const className = summary.roster.find(row => row.class_id === filters.class_id)?.class_name;
  const sectionName = summary.roster.find(row => row.section_id === filters.section_id)?.section_name;
  return <div ref={container} dir="rtl" lang="ar" className="staff-document student-roster-document">
    {pages.map((page, pageIndex) => <article className="staff-document-page" key={pageIndex} aria-label={`قائمة توزيع الطلاب — صفحة ${pageIndex + 1}`}>
      <header className="staff-document-header">
        <p className="student-roster-school">{summary.school.name}</p>
        <h1>قائمة توزيع الطلاب</h1>
        <p className="student-roster-scope">السنة الدراسية: <bdi>{summary.academic_year.name}</bdi> · {className || 'كل الصفوف'} · {sectionName || 'كل الشعب'} · {filters.study_status ? STUDY_STATUS_LABELS[filters.study_status] : 'كل أنواع الدراسة'}</p>
        <p className="student-roster-caption">التسجيلات السنوية النشطة · عدد الطلاب: {rows.length}{filters.q && <> · البحث: {filters.q}</>}</p>
      </header>
      <table className="student-roster-table"><colgroup><col style={{width:'7%'}}/><col style={{width:'17%'}}/><col style={{width:'34%'}}/><col style={{width:'20%'}}/><col style={{width:'10%'}}/><col style={{width:'12%'}}/></colgroup><thead><tr><th>ت</th><th>رقم الطالب</th><th>اسم الطالب</th><th>الصف</th><th>الشعبة</th><th>نوع الدراسة</th></tr></thead>
        <tbody>{page.map(row => <tr key={row.student_id} data-record-id={row.student_id} className="student-roster-row"><td>{row.ordinal}</td><td><bdi>{row.student_number}</bdi></td><th scope="row">{row.full_name}</th><td>{row.class_name}</td><td>{row.section_name || '—'}</td><td>{STUDY_STATUS_LABELS[row.study_status]}</td></tr>)}</tbody>
      </table>
      <footer className="staff-document-footer"><span>الصفحة {pageIndex + 1} من {pages.length}</span></footer>
    </article>)}
  </div>;
}
