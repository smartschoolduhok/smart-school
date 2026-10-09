import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { toArabicDigits } from '../../lib/arabicDigits';
import { resolvedOfficialBookLayout } from '../../lib/officialBookLayout';
import type { TeacherWorkloadSummary } from '../../lib/teacherWorkloadSummary';
import './teacherWorkloadDocument.css';

const TEACHERS_PER_PAGE = 28;
export type TeacherWorkloadMode = 'summary' | 'detailed';
type Teacher = TeacherWorkloadSummary['teachers'][number];
interface DetailRow {
  key: string;
  kind: 'teacher' | 'assignment' | 'empty' | 'subtotal' | 'total';
  teacher?: Teacher;
  teacherIndex?: number;
  assignment?: Teacher['breakdown'][number];
  continued?: boolean;
}
interface DetailGroup { heading: DetailRow; assignments: DetailRow[]; tail: DetailRow[] }

function detailGroups(teachers: Teacher[]): DetailGroup[] {
  return teachers.map((teacher, teacherIndex) => ({
    heading: { key: `teacher:${teacher.employee_id}`, kind: 'teacher', teacher, teacherIndex },
    assignments: teacher.breakdown.length ? teacher.breakdown.map((assignment, index) => ({
      key: `assignment:${teacher.employee_id}:${index}`, kind: 'assignment' as const, teacher, assignment,
    })) : [{ key: `empty:${teacher.employee_id}`, kind: 'empty', teacher }],
    tail: [
      { key: `subtotal:${teacher.employee_id}`, kind: 'subtotal', teacher },
      ...(teacherIndex === teachers.length - 1 ? [{ key: 'total', kind: 'total' as const }] : []),
    ],
  }));
}

/** Keep small teacher groups intact; split large groups with repeated identity and
 * keep the final assignment with its subtotal (and the final report total). */
export function paginateWorkloadDetails(groups: DetailGroup[], heights: ReadonlyMap<string, number>, capacity: number): DetailRow[][] {
  const pages: DetailRow[][] = [[]];
  let used = 0;
  const height = (row: DetailRow) => heights.get(row.key) || 26;
  const sum = (rows: DetailRow[]) => rows.reduce((total, row) => total + height(row), 0);
  const nextPage = () => { if (pages[pages.length - 1].length) { pages.push([]); used = 0; } };
  const append = (rows: DetailRow[]) => { pages[pages.length - 1].push(...rows); used += sum(rows); };
  for (const group of groups) {
    const all = [group.heading, ...group.assignments, ...group.tail];
    if (sum(all) <= capacity) {
      if (used + sum(all) > capacity) nextPage();
      append(all);
      continue;
    }
    const firstCluster = [group.heading, group.assignments[0], ...(group.assignments.length === 1 ? group.tail : [])];
    if (used + sum(firstCluster) > capacity) nextPage();
    append([group.heading]);
    group.assignments.forEach((row, index) => {
      const cluster = [row, ...(index === group.assignments.length - 1 ? group.tail : [])];
      if (used + sum(cluster) > capacity && pages[pages.length - 1].length > 1) {
        nextPage();
        append([{ ...group.heading, continued: true }]);
      }
      append(cluster);
    });
  }
  return pages;
}

export interface TeacherWorkloadDocumentHandle { prepareForPrint: () => Promise<void> }

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
  mode?: TeacherWorkloadMode;
  ref?: Ref<TeacherWorkloadDocumentHandle>;
}

export function TeacherWorkloadDocument({ summary, issuedAt, mode = 'summary', ref }: TeacherWorkloadDocumentProps) {
  const { school, academic_year: academicYear, document_settings: settings, teachers } = summary;
  const layout = resolvedOfficialBookLayout(settings.official_book_layout, school);
  const digits = (value: string | number) => settings.use_arabic_indic_digits ? toArabicDigits(value) : String(value);
  const dateText = Number.isNaN(issuedAt.getTime()) ? '—' : issuedAt.toLocaleDateString('en-GB');
  const summaryPages = Array.from({ length: Math.max(1, Math.ceil(teachers.length / TEACHERS_PER_PAGE)) }, (_, index) => (
    teachers.slice(index * TEACHERS_PER_PAGE, (index + 1) * TEACHERS_PER_PAGE)
  ));
  const documentRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => mode === 'detailed' ? detailGroups(teachers) : [], [teachers, mode]);
  const fallbackPages = useMemo(() => paginateWorkloadDetails(groups, new Map(), 650), [groups]);
  const [measured, setMeasured] = useState<{ groups: DetailGroup[]; pages: DetailRow[][] } | null>(null);
  const [layoutError, setLayoutError] = useState('');
  const detailPages = measured?.groups === groups ? measured.pages : fallbackPages;
  const pageCount = mode === 'detailed' ? detailPages.length : summaryPages.length;

  const measurePages = useCallback(() => {
    const source = documentRef.current;
    if (!source || mode !== 'detailed') return;
    // Measure at the actual printable width, including wrapped Arabic names and
    // configured school headers/footers. The temporary clone never gets printed.
    const probe = source.cloneNode(false) as HTMLDivElement;
    probe.style.cssText = 'position:fixed;left:-10000px;top:0;width:180mm;visibility:hidden;pointer-events:none';
    const page = source.querySelector('.teacher-workload-page')!.cloneNode(true) as HTMLElement;
    page.style.cssText = 'min-height:0;height:auto;margin:0;padding:0;border:0';
    const tbody = page.querySelector('tbody')!;
    tbody.replaceChildren();
    const originals = new Map(Array.from(source.querySelectorAll<HTMLTableRowElement>('tr[data-row-key]')).map(row => [row.dataset.rowKey!, row]));
    for (const row of groups.flatMap(group => [group.heading, ...group.assignments, ...group.tail])) {
      const original = originals.get(row.key);
      if (!original) continue;
      const clone = original.cloneNode(true) as HTMLTableRowElement;
      if (row.kind === 'teacher') clone.querySelector('.teacher-workload-continuation')!.textContent = ' (تابع)';
      tbody.append(clone);
    }
    page.querySelector<HTMLElement>('.teacher-workload-page-end')!.style.marginTop = '0';
    probe.append(page);
    document.body.append(probe);
    try {
      const table = page.querySelector('table')!;
      const bodyHeight = tbody.getBoundingClientRect().height;
      const fullHeight = page.getBoundingClientRect().height;
      if (fullHeight === 0 || table.getBoundingClientRect().width === 0) return; // DOM-only environments.
      const overhead = fullHeight - bodyHeight;
      const capacity = 260 * 96 / 25.4 - overhead - 4;
      const heights = new Map(Array.from(tbody.rows).map(row => [row.dataset.rowKey!, row.getBoundingClientRect().height]));
      const pages = paginateWorkloadDetails(groups, heights, capacity);
      const oversized = pages.some(rows => rows.reduce((total, row) => total + (heights.get(row.key) || 26), 0) > capacity + 1);
      const error = oversized ? 'تعذر احتواء أحد صفوف الكشف في صفحة الطباعة. اختصر النص الطويل في بيانات الصف أو المادة أو ترويسة المدرسة ثم أعد المحاولة.' : '';
      setLayoutError(error);
      setMeasured({ groups, pages });
      return error;
    } finally { probe.remove(); }
  }, [groups, mode]);

  useLayoutEffect(() => { measurePages(); }, [measurePages]);
  useEffect(() => {
    let active = true;
    void document.fonts?.ready.then(() => { if (active) measurePages(); });
    return () => { active = false; };
  }, [measurePages]);
  useImperativeHandle(ref, () => ({ prepareForPrint: async () => {
    if (document.fonts) await document.fonts.ready;
    await Promise.all(Array.from(documentRef.current?.querySelectorAll('img') || []).map(image => image.decode?.().catch(() => undefined)));
    let error = '';
    flushSync(() => { error = measurePages() || ''; });
    if (error) throw new Error(error);
    documentRef.current?.getBoundingClientRect();
  } }), [measurePages]);

  const renderDetailRow = (row: DetailRow) => {
    const common = { 'data-row-key': row.key, 'data-teacher-id': row.teacher?.employee_id };
    if (row.kind === 'teacher') return <tr key={row.key} {...common} className="teacher-workload-teacher"><th colSpan={4} scope="rowgroup">
      {digits(row.teacherIndex! + 1)}. المدرّس: {row.teacher!.employee_name}<span className="teacher-workload-continuation">{row.continued ? ' (تابع)' : ''}</span>
    </th></tr>;
    if (row.kind === 'assignment') return <tr key={row.key} {...common} className="teacher-workload-assignment">
      <td>{row.assignment!.class_name || '—'}</td><td>{row.assignment!.section_name || '—'}</td><td>{row.assignment!.subject_name || '—'}</td><td><bdi dir="ltr">{digits(row.assignment!.weekly_periods)}</bdi></td>
    </tr>;
    if (row.kind === 'empty') return <tr key={row.key} {...common}><td colSpan={3}>لا توجد حصص في الجدول المحفوظ</td><td>{digits(0)}</td></tr>;
    return <tr key={row.key} {...common} className={row.kind === 'total' ? 'teacher-workload-total' : 'teacher-workload-subtotal'}>
      <th colSpan={3} scope="row">{row.kind === 'total' ? 'المجموع الكلي' : `مجموع حصص ${row.teacher!.employee_name}`}</th>
      <td><bdi dir="ltr">{digits(row.kind === 'total' ? summary.total_weekly_periods : row.teacher!.weekly_periods)}</bdi></td>
    </tr>;
  };

  return <div className="teacher-workload-document" ref={documentRef} data-mode={mode} data-pagination-ready={mode === 'summary' || measured?.groups === groups} dir="rtl" lang="ar">
    {mode === 'detailed' && layoutError && <p role="alert" className="print-controls text-red-700">{layoutError}</p>}
    {Array.from({ length: pageCount }, (_, pageIndex) => <article className="teacher-workload-page" key={pageIndex} aria-label={`كشف الحصص الأسبوعية — صفحة ${pageIndex + 1}`}>
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

      <h1>كشف الحصص الأسبوعية للهيئة التدريسية{mode === 'detailed' ? ' — بالتفصيل' : ''}</h1>
      <p className="teacher-workload-intro">
        يبيّن الكشف أدناه عدد الحصص الأسبوعية لكل مدرس{mode === 'detailed' ? ' حسب الصف والشعبة والمادة' : ''} وفق الجدول الدراسي المحفوظ للعام الدراسي{' '}
        <bdi dir="ltr">{digits(academicYear.name)}</bdi>.
      </p>

      {mode === 'detailed' ? <table className="teacher-workload-table teacher-workload-detail-table">
        <caption className="sr-only">تفصيل حصص المدرسين حسب الصف والشعبة والمادة — {academicYear.name}</caption>
        <colgroup><col /><col className="teacher-workload-section-column" /><col /><col className="teacher-workload-detail-count-column" /></colgroup>
        <thead><tr><th scope="col">الصف</th><th scope="col">الشعبة</th><th scope="col">المادة</th><th scope="col">الحصص الأسبوعية</th></tr></thead>
        <tbody>{detailPages[pageIndex].map(renderDetailRow)}</tbody>
      </table> : <table className="teacher-workload-table">
        <caption className="sr-only">أسماء المدرسين وعدد حصصهم الأسبوعية — {academicYear.name}</caption>
        <colgroup><col className="teacher-workload-index-column" /><col /><col className="teacher-workload-count-column" /></colgroup>
        <thead><tr><th scope="col">ت</th><th scope="col">اسم المدرس</th><th scope="col">عدد الحصص الأسبوعية</th></tr></thead>
        <tbody>
          {summaryPages[pageIndex].map((teacher, index) => <tr key={teacher.employee_id}>
            <td><bdi dir="ltr">{digits(pageIndex * TEACHERS_PER_PAGE + index + 1)}</bdi></td>
            <th scope="row">{teacher.employee_name}</th>
            <td><bdi dir="ltr">{digits(teacher.weekly_periods)}</bdi></td>
          </tr>)}
          {summaryPages[pageIndex].length === 0 && <tr><td colSpan={3}>لا يوجد مدرسون نشطون في المدرسة.</td></tr>}
          {pageIndex === pageCount - 1 && <tr className="teacher-workload-total">
            <th colSpan={2} scope="row">المجموع الكلي</th>
            <td><bdi dir="ltr">{digits(summary.total_weekly_periods)}</bdi></td>
          </tr>}
        </tbody>
      </table>}

      <div className="teacher-workload-page-end">
        <div className="teacher-workload-signature">
          <strong>مدير المدرسة</strong>
          <span>{school.principal_name?.trim() || 'الاسم والتوقيع'}</span>
        </div>
        <footer className="teacher-workload-footer">
          {settings.footer_text && <p>{settings.footer_text}</p>}
          {(mode === 'detailed' || pageCount > 1) && <p>الصفحة {digits(pageIndex + 1)} من {digits(pageCount)}</p>}
        </footer>
      </div>
    </article>)}
  </div>;
}

export default TeacherWorkloadDocument;
