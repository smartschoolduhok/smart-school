import { useState } from 'react';
import { toArabicDigits } from '../../lib/arabicDigits';
import { resolvedOfficialBookLayout } from '../../lib/officialBookLayout';
import type { TeacherWorkloadSummary } from '../../lib/teacherWorkloadSummary';
import './teacherWorkloadDocument.css';

const TEACHERS_PER_PAGE = 28;

function SchoolLogo({ url, schoolName }: { url: string | null; schoolName: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!url || failedUrl === url) return <div className="teacher-workload-logo-space" aria-hidden="true" />;
  return <img className="teacher-workload-logo" src={url} alt={`شعار ${schoolName}`} onError={() => setFailedUrl(url)} />;
}

function HeaderLines({ lines, language }: { lines: string[]; language: 'ar' | 'en' }) {
  return <div className={`teacher-workload-header-${language}`} dir={language === 'ar' ? 'rtl' : 'ltr'} lang={language}>
    {lines.filter(Boolean).map((line, index) => <div key={`${index}:${line}`}>{line}</div>)}
  </div>;
}

export interface TeacherWorkloadDocumentProps {
  summary: TeacherWorkloadSummary;
  issuedAt: Date;
}

export function TeacherWorkloadDocument({ summary, issuedAt }: TeacherWorkloadDocumentProps) {
  const { school, academic_year: academicYear, document_settings: settings, teachers } = summary;
  const layout = resolvedOfficialBookLayout(settings.official_book_layout, school);
  const digits = (value: string | number) => settings.use_arabic_indic_digits ? toArabicDigits(value) : String(value);
  const dateText = Number.isNaN(issuedAt.getTime()) ? '—' : issuedAt.toLocaleDateString('en-GB');
  const pages = Array.from({ length: Math.max(1, Math.ceil(teachers.length / TEACHERS_PER_PAGE)) }, (_, index) => (
    teachers.slice(index * TEACHERS_PER_PAGE, (index + 1) * TEACHERS_PER_PAGE)
  ));

  return <div className="teacher-workload-document" dir="rtl" lang="ar">
    {pages.map((pageTeachers, pageIndex) => <article className="teacher-workload-page" key={pageIndex} aria-label={`كشف الحصص الأسبوعية — صفحة ${pageIndex + 1}`}>
      <header className="teacher-workload-header">
        <div className="teacher-workload-header-grid" dir="ltr">
          {layout.show_english_header ? <HeaderLines language="en" lines={[
            layout.country_en, layout.ministry_en, layout.directorate_en, layout.department_en, layout.school_name_en,
          ]} /> : <div />}
          <SchoolLogo url={school.logo_url} schoolName={school.name} />
          <HeaderLines language="ar" lines={[
            layout.country_ar, layout.ministry_ar, layout.directorate_ar, layout.department_ar, layout.school_name_ar,
          ]} />
        </div>
        {settings.header_text && <p className="teacher-workload-header-note">{settings.header_text}</p>}
      </header>

      <div className="teacher-workload-document-meta">
        <span>العدد: <span className="teacher-workload-blank-number">…………</span></span>
        <span>التاريخ: <bdi dir="ltr">{digits(dateText)}</bdi></span>
      </div>

      <h1>كشف الحصص الأسبوعية للهيئة التدريسية</h1>
      <p className="teacher-workload-intro">
        يبيّن الكشف أدناه عدد الحصص الأسبوعية لكل مدرس وفق الجدول الدراسي المحفوظ للعام الدراسي{' '}
        <bdi dir="ltr">{digits(academicYear.name)}</bdi>.
      </p>

      <table className="teacher-workload-table">
        <caption className="sr-only">أسماء المدرسين وعدد حصصهم الأسبوعية — {academicYear.name}</caption>
        <colgroup><col className="teacher-workload-index-column" /><col /><col className="teacher-workload-count-column" /></colgroup>
        <thead><tr><th scope="col">ت</th><th scope="col">اسم المدرس</th><th scope="col">عدد الحصص الأسبوعية</th></tr></thead>
        <tbody>
          {pageTeachers.map((teacher, index) => <tr key={teacher.employee_id}>
            <td><bdi dir="ltr">{digits(pageIndex * TEACHERS_PER_PAGE + index + 1)}</bdi></td>
            <th scope="row">{teacher.employee_name}</th>
            <td><bdi dir="ltr">{digits(teacher.weekly_periods)}</bdi></td>
          </tr>)}
          {pageTeachers.length === 0 && <tr><td colSpan={3}>لا يوجد مدرسون نشطون في المدرسة.</td></tr>}
          {pageIndex === pages.length - 1 && <tr className="teacher-workload-total">
            <th colSpan={2} scope="row">المجموع الكلي</th>
            <td><bdi dir="ltr">{digits(summary.total_weekly_periods)}</bdi></td>
          </tr>}
        </tbody>
      </table>

      <div className="teacher-workload-page-end">
        <div className="teacher-workload-signature">
          <strong>مدير المدرسة</strong>
          <span>{school.principal_name?.trim() || 'الاسم والتوقيع'}</span>
        </div>
        <footer className="teacher-workload-footer">
          {settings.footer_text && <p>{settings.footer_text}</p>}
          {pages.length > 1 && <p>الصفحة {digits(pageIndex + 1)} من {digits(pages.length)}</p>}
        </footer>
      </div>
    </article>)}
  </div>;
}

export default TeacherWorkloadDocument;
