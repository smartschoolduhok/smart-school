import { useState, type ReactNode } from 'react';
import { resolvedOfficialBookLayout } from '../../lib/officialBookLayout';
import type { StaffDocumentMetadata } from '../../types/employees';
import { staffDate, staffDigits } from './documentHelpers';
import './staffDocuments.css';

function Logo({url, name}: {url: string | null; name: string}) {
  const [failed, setFailed] = useState<string | null>(null);
  return url && failed !== url ? <img className="staff-document-logo" src={url} alt={`شعار ${name}`} onError={() => setFailed(url)} /> : <span className="staff-document-logo" />;
}
export function StaffDocumentFrame({metadata, title, subtitle, pageIndex, pageCount, children, landscape = false}: {
  metadata: StaffDocumentMetadata; title: string; subtitle: string; pageIndex: number; pageCount: number; children: ReactNode; landscape?: boolean;
}) {
  const {school, document_settings: settings} = metadata;
  const layout = resolvedOfficialBookLayout(settings.official_book_layout, school);
  return <article className={`staff-document-page ${landscape ? 'staff-document-landscape' : ''}`} aria-label={`${title} — صفحة ${pageIndex + 1}`}>
    <header className="staff-document-header">
      <div className="staff-document-header-grid" dir="ltr">
        <div dir="ltr" lang="en">{layout.show_english_header && [layout.country_en, layout.ministry_en, layout.directorate_en, layout.department_en, layout.school_name_en].filter(Boolean).map((line, i) => <div key={i}>{line}</div>)}</div>
        <Logo url={school.logo_url} name={school.name} />
        <div dir="rtl" lang="ar">{[layout.country_ar, layout.ministry_ar, layout.directorate_ar, layout.department_ar, layout.school_name_ar].filter(Boolean).map((line, i) => <div key={i}>{line}</div>)}</div>
      </div>
      {settings.header_text && <p className="staff-document-note">{settings.header_text}</p>}
      <h1>{title}</h1>
      <div className="staff-document-meta"><span>{subtitle}</span><span>تاريخ الإعداد: <bdi>{staffDate(metadata.prepared_at, settings)}</bdi></span></div>
    </header>
    {children}
    <footer className="staff-document-footer">
      {settings.footer_text && <p>{settings.footer_text}</p>}
      <span>الصفحة {staffDigits(pageIndex + 1, settings)} من {staffDigits(pageCount, settings)}</span>
    </footer>
  </article>;
}
