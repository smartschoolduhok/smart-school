import { QRCodeSVG } from 'qrcode.react';
import { toArabicDigits } from '../../lib/arabicDigits';
import {
  displayGradeStatus,
  displayIndividualExemptionDetail,
} from '../../lib/gradePresentation';
import { formatUnixSecondsDate } from '../../lib/resultCardPrint';
import {
  isResultCardNumericColumnKey,
  normalizeResultCardGender,
  normalizeResultCardDisplaySettings,
  snapshotResultCardColumnAverages,
  snapshotResultCardColumns,
  type ResultCardColumnKey,
} from '../../lib/resultCardPresentation';

export interface ResultCardDocumentRecord {
  id?: number | null;
  card_number?: string | null;
  student_name_snapshot?: string | null;
  class_name_snapshot?: string | null;
  section_name_snapshot?: string | null;
  school_name_snapshot?: string | null;
  academic_year_snapshot?: string | null;
  general_exemption_status?: number | boolean | null;
  overall_result_status?: string | null;
  generated_at?: number | string | null;
  printed_at?: number | string | null;
  status?: string | null;
  verification_token?: string | null;
}

interface ResultCardDocumentProps {
  card: ResultCardDocumentRecord;
  data?: Record<string, any> | null;
  verificationUrl?: string | null;
  compact?: boolean;
}

interface StudentInfoItem {
  label: string;
  value: string;
  prominent?: boolean;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return toArabicDigits(String(value));
}

function renderSubjectCell(row: Record<string, any>, key: ResultCardColumnKey) {
  if (key === 'subject_name') return row.subject_name || row.name || '—';
  if (key === 'result_status') {
    return displayGradeStatus(row.result_status, row.exemption_status) ?? '—';
  }
  if (key === 'exemption_detail') {
    return displayIndividualExemptionDetail(row.exemption_status);
  }
  return displayValue(row[key]);
}

export function ResultCardDocument({
  card,
  data = {},
  verificationUrl = null,
  compact = false,
}: ResultCardDocumentProps) {
  const school = data?.school || {};
  const student = data?.student || {};
  const classSnapshot = data?.class || {};
  const section = data?.section || {};
  const summary = data?.summary || {};
  const documentSettings = data?.document_settings || {};
  const displaySettings = normalizeResultCardDisplaySettings(
    documentSettings.result_card_display_settings,
  );
  const columns = snapshotResultCardColumns(data?.visible_columns);
  const columnAverages = snapshotResultCardColumnAverages(
    data?.column_averages,
    columns,
  );
  const subjects = Array.isArray(data?.subjects) ? data.subjects : [];
  const isPartial = data?.card_mode === 'partial' ||
    summary.overall_result_status === 'غير مكتمل' ||
    card.overall_result_status === 'غير مكتمل';
  const overallStatus = isPartial
    ? 'غير مكتمل'
    : summary.overall_result_status || card.overall_result_status || '—';
  const generalExemption = summary.general_exemption_eligible === true ||
    card.general_exemption_status === true || card.general_exemption_status === 1;
  const schoolName = school.name || card.school_name_snapshot || 'المدرسة';
  const className = classSnapshot.name || card.class_name_snapshot || null;
  const sectionName = section.name || card.section_name_snapshot || null;
  const academicYear = data?.academic_year?.name || card.academic_year_snapshot || null;
  const studentName = student.name || card.student_name_snapshot || '—';
  const studentGender = normalizeResultCardGender(student.gender);
  const note = typeof data?.decision_note === 'string' ? data.decision_note.trim() : '';
  const logoUrl = displaySettings.show_school_logo && documentSettings.logo_url
    ? documentSettings.logo_url
    : null;
  const contactItems = [
    displaySettings.show_phone && school.phone ? `الهاتف: ${school.phone}` : null,
    displaySettings.show_address && school.address ? `العنوان: ${school.address}` : null,
    displaySettings.show_email_website && school.email ? school.email : null,
    displaySettings.show_email_website && school.website ? school.website : null,
  ].filter(Boolean);
  const studentIdentityItems: StudentInfoItem[] = [
    { label: 'اسم الطالب', value: studentName, prominent: true },
  ];
  if (
    displaySettings.show_student_number &&
    student.student_number !== null &&
    student.student_number !== undefined &&
    student.student_number !== ''
  ) {
    studentIdentityItems.push({ label: 'رقم الطالب', value: displayValue(student.student_number) });
  }
  if (card.card_number) {
    studentIdentityItems.push({ label: 'رقم الكارت', value: displayValue(card.card_number) });
  }

  const academicPlacementItems: StudentInfoItem[] = [];
  if (className) academicPlacementItems.push({ label: 'الصف', value: className });
  if (sectionName) academicPlacementItems.push({ label: 'الشعبة', value: sectionName });

  const optionalStudentInfoItems: StudentInfoItem[] = [];
  if (displaySettings.show_exam_number && student.exam_number) {
    optionalStudentInfoItems.push({ label: 'الرقم الامتحاني', value: displayValue(student.exam_number) });
  }
  if (displaySettings.show_gender && studentGender) {
    optionalStudentInfoItems.push({ label: 'الجنس', value: studentGender });
  }

  const summaryItems = [
    { label: 'النتيجة العامة', value: overallStatus, primary: true },
    displaySettings.show_overall_average && summary.overall_average !== null &&
      summary.overall_average !== undefined
      ? { label: 'المعدل', value: displayValue(summary.overall_average), primary: false }
      : null,
    generalExemption
      ? { label: 'الإعفاء العام', value: 'معفى عام', primary: false }
      : null,
    displaySettings.show_appreciation && summary.appreciation
      ? { label: 'التقدير', value: String(summary.appreciation), primary: false }
      : null,
  ].filter((item): item is { label: string; value: string; primary: boolean } => item !== null);

  const countItems = isPartial
    ? []
    : [
        summary.pass_count !== null && summary.pass_count !== undefined
          ? `ناجح: ${displayValue(summary.pass_count)}`
          : null,
        summary.completion_count !== null && summary.completion_count !== undefined
          ? `مكمل: ${displayValue(summary.completion_count)}`
          : null,
        summary.fail_count !== null && summary.fail_count !== undefined
          ? `راسب: ${displayValue(summary.fail_count)}`
          : null,
      ].filter((item): item is string => item !== null);

  const showStamp = displaySettings.show_signatures_block && (
    documentSettings.official_stamp_url || displaySettings.show_school_stamp_placeholder
  );

  return (
    <article
      dir="rtl"
      className={`result-card-document flex flex-col gap-4 bg-white text-gray-950 ${compact ? 'p-4 sm:p-5' : 'p-6 sm:p-8'}`}
      style={{ maxWidth: '210mm', minHeight: compact ? undefined : '277mm', margin: '0 auto' }}
    >
      <header className="result-card-header rounded-xl border-2 border-slate-700 px-4 py-3 sm:px-5">
        <div className={`grid items-center gap-3 ${logoUrl ? 'grid-cols-[6rem_1fr_6rem]' : 'grid-cols-1'}`}>
          {logoUrl && (
            <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5">
              <img
                src={logoUrl}
                alt="شعار المدرسة"
                className="h-full w-full object-contain"
              />
            </div>
          )}
          <div className="min-w-0 text-center">
            <h1 className="text-xl font-black leading-tight tracking-tight sm:text-2xl">{schoolName}</h1>
            {displaySettings.show_school_subtitle && documentSettings.result_card_header_text && (
              <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-slate-600 sm:text-sm">
                {documentSettings.result_card_header_text}
              </p>
            )}
            <div className="mt-2 inline-flex items-center border-y-2 border-slate-700 px-6 py-0.5 text-base font-black tracking-wide">
              كارت النتيجة
            </div>
            {!logoUrl && academicYear && (
              <p
                dir="ltr"
                aria-label={`السنة الدراسية ${academicYear}`}
                className="mt-2 whitespace-nowrap text-base font-black tracking-wide text-slate-800"
              >
                {String(academicYear)}
              </p>
            )}
          </div>
          {logoUrl && (
            <div className="justify-self-center text-center">
              {academicYear && (
                <p
                  dir="ltr"
                  aria-label={`السنة الدراسية ${academicYear}`}
                  className="whitespace-nowrap border-y border-slate-300 px-1 py-1 text-base font-black tracking-wide text-slate-800"
                >
                  {String(academicYear)}
                </p>
              )}
            </div>
          )}
        </div>
        {contactItems.length > 0 && (
          <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 border-t border-slate-200 pt-2 text-[10px] text-slate-500 sm:text-[11px]">
            {contactItems.map((item) => <span key={String(item)}>{item}</span>)}
          </div>
        )}
      </header>

      <section className="result-card-student-info rounded-lg border border-slate-300 bg-slate-50/70 px-3 py-2.5">
        <div className={`grid gap-3 ${academicPlacementItems.length > 0 ? 'sm:grid-cols-2' : ''}`}>
          <div className="space-y-2 sm:pl-3">
            {studentIdentityItems.map((item) => (
              <div key={item.label} className="min-w-0 border-r-2 border-slate-300 pr-2">
                <div className="text-[9px] font-bold text-slate-500 sm:text-[10px]">{item.label}</div>
                <div className={`break-words text-xs leading-snug text-slate-900 sm:text-sm ${item.prominent ? 'font-black' : 'font-bold'}`}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>
          {academicPlacementItems.length > 0 && (
            <div className="space-y-2 border-t border-slate-300 pt-3 sm:border-r sm:border-t-0 sm:pr-4 sm:pt-0">
              {academicPlacementItems.map((item) => (
                <div key={item.label} className="min-w-0 border-r-2 border-slate-300 pr-2">
                  <div className="text-[9px] font-bold text-slate-500 sm:text-[10px]">{item.label}</div>
                  <div className="break-words text-xs font-bold leading-snug text-slate-900 sm:text-sm">
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {optionalStudentInfoItems.length > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-200 pt-2">
            {optionalStudentInfoItems.map((item) => (
              <div key={item.label} className="min-w-0">
                <span className="text-[9px] font-bold text-slate-500 sm:text-[10px]">{item.label}: </span>
                <span className="text-xs font-bold text-slate-800 sm:text-sm">{item.value}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {(card.status === 'preview' || card.status === 'cancelled') && (
        <div role="note" className={`result-card-notice rounded-md border px-3 py-1.5 text-center text-xs font-bold sm:text-sm ${
          card.status === 'cancelled'
            ? 'border-red-400 bg-red-50 text-red-900'
            : 'border-slate-400 bg-slate-50 text-slate-800'
        }`}>
          {card.status === 'cancelled'
            ? 'كارت ملغى — غير صالح للاستخدام الرسمي'
            : 'معاينة مباشرة غير محفوظة'}
        </div>
      )}

      <section className="result-card-table-wrap overflow-x-auto rounded-lg border border-slate-500">
        <table aria-label="درجات مواد الطالب" className="result-card-table w-full table-fixed border-collapse text-[11px] leading-snug">
          <colgroup>
            {columns.map((column) => (
              <col
                key={column.key}
                className={column.key === 'subject_name' ? 'result-card-subject-column' : undefined}
                style={column.key === 'subject_name' ? { width: columns.length > 8 ? '24%' : '28%' } : undefined}
              />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-slate-200 text-slate-950">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`border-l border-slate-500 px-1.5 py-2 font-black last:border-l-0 ${
                    column.key === 'subject_name' ? 'text-right' : 'text-center'
                  }`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {subjects.map((subject: Record<string, any>, index: number) => (
              <tr
                key={`${subject.subject_id ?? 'subject'}-${index}`}
                className={`odd:bg-white even:bg-slate-50 ${
                  columnAverages && index === subjects.length - 1 ? 'result-card-last-subject-row' : ''
                }`}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`break-words border-l border-t border-slate-300 px-1.5 py-1.5 text-center align-middle last:border-l-0 ${
                      column.key === 'subject_name' ? 'text-right font-bold' : ''
                    }`}
                  >
                    {renderSubjectCell(subject, column.key)}
                  </td>
                ))}
              </tr>
            ))}
            {columnAverages && (
              <tr className="result-card-average-row border-t-2 border-slate-700 bg-slate-100 font-black">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`border-l border-slate-400 px-1.5 py-2 text-center last:border-l-0 ${
                      column.key === 'subject_name' ? 'text-right' : ''
                    }`}
                  >
                    {column.key === 'subject_name'
                      ? 'المعدل'
                      : isResultCardNumericColumnKey(column.key)
                        ? displayValue(columnAverages[column.key])
                        : '—'}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className={`result-card-summary grid gap-3 ${displaySettings.show_notes_decisions ? 'sm:grid-cols-2' : ''}`}>
        <div className="rounded-lg border-2 border-slate-700 p-3">
          <h2 className="mb-2 border-b border-slate-200 pb-1.5 text-sm font-black">الخلاصة العامة</h2>
          <div className="grid grid-cols-2 gap-2">
            {summaryItems.map((item) => (
              <div key={item.label} className={item.primary ? 'col-span-2 sm:col-span-1' : ''}>
                <div className="text-[10px] font-bold text-slate-500">{item.label}</div>
                <div className={`text-sm ${item.primary ? 'font-black' : 'font-bold'}`}>{item.value}</div>
              </div>
            ))}
            {countItems.length > 0 && (
              <div className="col-span-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-200 pt-2 text-[10px] font-semibold text-slate-600">
                {countItems.map((item) => <span key={item}>{item}</span>)}
              </div>
            )}
          </div>
        </div>
        {displaySettings.show_notes_decisions && (
          <div className="rounded-lg border border-slate-400 p-3">
            <h2 className="mb-2 border-b border-slate-200 pb-1.5 text-sm font-black">الملاحظات والقرارات</h2>
            {note ? (
              <p className="result-card-note-body min-h-12 whitespace-pre-line text-sm leading-relaxed text-slate-700">{note}</p>
            ) : (
              <p className="text-xs text-slate-400">لا توجد ملاحظات أو قرارات مسجلة.</p>
            )}
          </div>
        )}
      </section>

      <footer className="result-card-footer mt-auto border-t-2 border-slate-700 pt-3 text-center text-xs">
        <div className="grid grid-cols-3 items-end gap-3">
          <div className="min-h-24">
            {displaySettings.show_signatures_block && (
              <>
                <p className="font-black">إدارة المدرسة</p>
                <p className="mx-auto mt-12 max-w-32 border-t border-slate-500 pt-1 text-[10px]">التوقيع</p>
              </>
            )}
          </div>
          <div className="flex min-h-24 flex-col items-center justify-end">
            {showStamp && (
              documentSettings.official_stamp_url ? (
                <>
                  <img src={documentSettings.official_stamp_url} alt="الختم الرسمي" className="h-20 w-20 object-contain" />
                  <p className="mt-1 text-[9px] text-slate-500">الختم الرسمي</p>
                </>
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-slate-400 px-2 text-[9px] font-semibold text-slate-500">
                  موضع الختم الرسمي
                </div>
              )
            )}
          </div>
          <div className="flex min-h-24 flex-col items-center justify-end">
            {displaySettings.show_qr_code && (
              verificationUrl ? (
                <QRCodeSVG value={verificationUrl} size={100} level="M" />
              ) : card.status === 'preview' ? (
                <div className="flex h-[100px] w-[100px] items-center justify-center rounded border-2 border-dashed border-slate-300 px-2 text-[9px] font-semibold leading-relaxed text-slate-500">
                  يُنشأ رمز QR عند إصدار الكارت
                </div>
              ) : null
            )}
            {displaySettings.show_verification_code_text && card.verification_token && (
              <p dir="ltr" className="mt-1 max-w-[125px] break-all font-mono text-[7px] leading-tight text-slate-500">
                {card.verification_token}
              </p>
            )}
          </div>
        </div>
        <div className="result-card-footer-meta mt-3 space-y-1 border-t border-slate-200 pt-2 text-[9px] leading-relaxed text-slate-500">
          <p>تاريخ الإصدار: {toArabicDigits(formatUnixSecondsDate(card.generated_at))}</p>
          {documentSettings.result_card_footer_text && <p className="whitespace-pre-line">{documentSettings.result_card_footer_text}</p>}
          {documentSettings.verification_note_text && <p className="whitespace-pre-line">{documentSettings.verification_note_text}</p>}
        </div>
      </footer>
    </article>
  );
}
