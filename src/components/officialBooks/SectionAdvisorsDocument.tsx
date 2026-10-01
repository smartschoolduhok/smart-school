import { useState } from 'react';
import { toArabicDigits } from '../../lib/arabicDigits';
import { resolvedOfficialBookLayout } from '../../lib/officialBookLayout';
import type { SectionAdvisorsResponse } from '../../lib/sectionAdvisors';
import './sectionAdvisorsDocument.css';

const ADVISORS_PER_PAGE = 20;

function SchoolLogo({ url, schoolName }: { url: string | null; schoolName: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!url || failedUrl === url) return <div className="section-advisors-logo-space" aria-hidden="true" />;
  return <img className="section-advisors-logo" src={url} alt={`شعار ${schoolName}`} onError={() => setFailedUrl(url)} />;
}

function HeaderLines({ lines, language }: { lines: string[]; language: 'ar' | 'en' }) {
  return <div className={`section-advisors-header-${language}`} dir={language === 'ar' ? 'rtl' : 'ltr'} lang={language}>
    {lines.filter(Boolean).map((line, index) => <div key={`${index}:${line}`}>{line}</div>)}
  </div>;
}

export interface SectionAdvisorsDocumentProps {
  summary: SectionAdvisorsResponse;
  issuedAt: Date;
  documentNumber?: string;
}

export function SectionAdvisorsDocument({ summary, issuedAt, documentNumber = '' }: SectionAdvisorsDocumentProps) {
  const { school, academic_year: academicYear, document_settings: settings, placements } = summary;
  const layout = resolvedOfficialBookLayout(settings.official_book_layout, school);
  const digits = (value: string | number) => settings.use_arabic_indic_digits ? toArabicDigits(value) : String(value);
  const dateText = Number.isNaN(issuedAt.getTime()) ? '—' : issuedAt.toLocaleDateString('en-GB');
  const pages = Array.from({ length: Math.max(1, Math.ceil(placements.length / ADVISORS_PER_PAGE)) }, (_, index) => (
    placements.slice(index * ADVISORS_PER_PAGE, (index + 1) * ADVISORS_PER_PAGE)
  ));

  return <div className="section-advisors-document" dir="rtl" lang="ar">
    {pages.map((rows, pageIndex) => <article className="section-advisors-page" key={pageIndex} aria-label={`كتاب تكليف مرشدي الصفوف — صفحة ${pageIndex + 1}`}>
      <header className="section-advisors-header">
        <div className="section-advisors-header-grid" dir="ltr">
          {layout.show_english_header ? <HeaderLines language="en" lines={[
            layout.country_en, layout.ministry_en, layout.directorate_en, layout.department_en, layout.school_name_en,
          ]} /> : <div />}
          <SchoolLogo url={school.logo_url} schoolName={school.name} />
          <HeaderLines language="ar" lines={[
            layout.country_ar, layout.ministry_ar, layout.directorate_ar, layout.department_ar, layout.school_name_ar,
          ]} />
        </div>
        {settings.header_text && <p className="section-advisors-header-note">{settings.header_text}</p>}
      </header>

      <div className="section-advisors-document-meta">
        <span>العدد: <bdi>{documentNumber.trim() ? digits(documentNumber.trim()) : '…………'}</bdi></span>
        <span>التاريخ: <bdi dir="ltr">{digits(dateText)}</bdi></span>
      </div>
      <h1>م / تكليف مرشدي الصفوف</h1>
      <p className="section-advisors-intro">استناداً إلى متطلبات تنظيم العمل التربوي ومتابعة شؤون الطلبة، تقرر تكليف التدريسيين المدرجة أسماؤهم أدناه بمهام إرشاد الصفوف والشعب المبينة إزاء أسمائهم للعام الدراسي <bdi dir="ltr">{digits(academicYear.name)}</bdi>.</p>

      <table className="section-advisors-table">
        <caption className="sr-only">مرشدو الصفوف والشعب — {academicYear.name}</caption>
        <colgroup><col className="section-advisors-index-column" /><col className="section-advisors-class-column" /><col className="section-advisors-section-column" /><col /></colgroup>
        <thead><tr><th scope="col">ت</th><th scope="col">الصف</th><th scope="col">الشعبة</th><th scope="col">اسم المرشد</th></tr></thead>
        <tbody>{rows.map((placement, index) => <tr key={`${placement.class_id}:${placement.section_id ?? 'class'}`}>
          <td><bdi dir="ltr">{digits(pageIndex * ADVISORS_PER_PAGE + index + 1)}</bdi></td>
          <td>{placement.class_name}</td>
          <td>{placement.section_name || '—'}</td>
          <th scope="row">{placement.assignment?.employee_name || '—'}</th>
        </tr>)}</tbody>
      </table>

      {pageIndex === pages.length - 1 && <p className="section-advisors-responsibilities">يتولى المرشدون متابعة انتظام الطلبة ومواظبتهم، ورصد أوضاعهم الدراسية والسلوكية، والتنسيق مع إدارة المدرسة وأولياء الأمور بشأن ما يستدعي المتابعة، ورفع الملاحظات والتوصيات إلى الإدارة. يرجى العمل بموجبه.</p>}
      <div className="section-advisors-page-end">
        <div className="section-advisors-signature"><strong>مدير المدرسة</strong><span>{school.principal_name?.trim() || 'الاسم والتوقيع'}</span></div>
        <footer className="section-advisors-footer">
          {settings.footer_text && <p>{settings.footer_text}</p>}
          {pages.length > 1 && <p>الصفحة {digits(pageIndex + 1)} من {digits(pages.length)}</p>}
        </footer>
      </div>
    </article>)}
  </div>;
}

export default SectionAdvisorsDocument;
