import { QRCodeSVG } from 'qrcode.react';
import { toArabicDigits } from '../../lib/arabicDigits';
import {
  displayGradeStatus,
  displayIndividualExemptionDetail,
} from '../../lib/gradePresentation';
import { formatUnixSecondsDate } from '../../lib/resultCardPrint';
import {
  normalizeResultCardGender,
  normalizeResultCardDisplaySettings,
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
  const contactItems = [
    displaySettings.show_phone && school.phone ? `الهاتف: ${school.phone}` : null,
    displaySettings.show_address && school.address ? `العنوان: ${school.address}` : null,
    displaySettings.show_email_website && school.email ? school.email : null,
    displaySettings.show_email_website && school.website ? school.website : null,
  ].filter(Boolean);

  return (
    <article
      dir="rtl"
      className={`result-card-document bg-white text-gray-950 ${compact ? 'p-5' : 'p-8'} space-y-5`}
      style={{ maxWidth: '210mm', minHeight: compact ? undefined : '277mm', margin: '0 auto' }}
    >
      <header className="relative rounded-2xl border-2 border-slate-800 px-5 py-4 text-center">
        {displaySettings.show_school_logo && documentSettings.logo_url && (
          <img
            src={documentSettings.logo_url}
            alt="شعار المدرسة"
            className="absolute right-5 top-4 h-20 w-20 object-contain"
          />
        )}
        <div className="px-20">
          <h1 className="text-2xl font-black tracking-tight">{schoolName}</h1>
          {displaySettings.show_school_subtitle && documentSettings.result_card_header_text && (
            <p className="mt-1 whitespace-pre-line text-sm text-slate-600">
              {documentSettings.result_card_header_text}
            </p>
          )}
          <div className="mt-3 inline-flex items-center rounded-full bg-slate-900 px-5 py-1.5 text-base font-bold text-white">
            كارت النتيجة
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-700">
            العام الدراسي: {displayValue(academicYear)}
            {displaySettings.show_class_section_in_header && className
              ? ` • ${className}${sectionName ? ` / ${sectionName}` : ''}`
              : ''}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
          {contactItems.map((item) => <span key={String(item)}>{item}</span>)}
        </div>
      </header>

      <section className="rounded-xl border border-slate-300 bg-slate-50 p-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <div><span className="font-bold">اسم الطالب:</span> {studentName}</div>
          {displaySettings.show_student_number && (
            <div><span className="font-bold">رقم الطالب:</span> {displayValue(student.student_number)}</div>
          )}
          {displaySettings.show_exam_number && student.exam_number && (
            <div><span className="font-bold">الرقم الامتحاني:</span> {displayValue(student.exam_number)}</div>
          )}
          {!displaySettings.show_class_section_in_header && className && (
            <div><span className="font-bold">الصف:</span> {className}</div>
          )}
          {!displaySettings.show_class_section_in_header && sectionName && (
            <div><span className="font-bold">الشعبة:</span> {sectionName}</div>
          )}
          {displaySettings.show_gender && studentGender && (
            <div><span className="font-bold">الجنس:</span> {studentGender}</div>
          )}
          {displaySettings.show_exam_round && data?.exam_round && (
            <div><span className="font-bold">الدور:</span> {data.exam_round}</div>
          )}
          <div><span className="font-bold">رقم الكارت:</span> {displayValue(card.card_number)}</div>
        </div>
      </section>

      {(card.status === 'preview' || isPartial || card.status === 'cancelled') && (
        <div className={`rounded-lg px-4 py-2 text-center text-sm font-bold ${
          card.status === 'cancelled'
            ? 'bg-red-100 text-red-800'
            : isPartial
              ? 'bg-amber-100 text-amber-800'
              : 'bg-blue-100 text-blue-800'
        }`}>
          {card.status === 'cancelled'
            ? 'كارت ملغى — غير صالح للاستخدام الرسمي'
            : isPartial
              ? 'كارت جزئي — بعض البيانات الأكاديمية غير مكتملة'
              : 'معاينة مباشرة غير محفوظة'}
        </div>
      )}

      <section className="overflow-x-auto rounded-xl border border-slate-400">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-slate-800 text-white">
              {columns.map((column) => (
                <th key={column.key} className="border-l border-slate-600 px-2 py-2 font-bold last:border-l-0">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {subjects.map((subject: Record<string, any>, index: number) => (
              <tr key={`${subject.subject_id ?? 'subject'}-${index}`} className="odd:bg-white even:bg-slate-50">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`border-l border-t border-slate-300 px-2 py-2 text-center last:border-l-0 ${
                      column.key === 'subject_name' ? 'text-right font-bold' : ''
                    }`}
                  >
                    {renderSubjectCell(subject, column.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border-2 border-slate-800 p-4">
          <h2 className="mb-3 text-sm font-black">الخلاصة العامة</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="font-bold">النتيجة العامة:</span> {overallStatus}</div>
            <div><span className="font-bold">الإعفاء العام:</span> {generalExemption ? 'معفى عام' : '—'}</div>
            {displaySettings.show_overall_average && (
              <div><span className="font-bold">المعدل:</span> {displayValue(summary.overall_average)}</div>
            )}
            {displaySettings.show_appreciation && (
              <div><span className="font-bold">التقدير:</span> {summary.appreciation || '—'}</div>
            )}
            {!isPartial && (
              <div className="col-span-2 text-xs text-slate-600">
                ناجح: {displayValue(summary.pass_count)} • مكمل: {displayValue(summary.completion_count)} • راسب: {displayValue(summary.fail_count)}
              </div>
            )}
          </div>
        </div>
        {displaySettings.show_notes_decisions && (
          <div className="rounded-xl border border-slate-300 p-4">
            <h2 className="mb-2 text-sm font-black">الملاحظات والقرارات</h2>
            <p className="min-h-12 whitespace-pre-line text-sm text-slate-700">{note || '—'}</p>
          </div>
        )}
      </section>

      <footer className="grid grid-cols-3 items-end gap-4 border-t-2 border-slate-800 pt-4 text-center text-xs">
        {displaySettings.show_signatures_block ? (
          <>
            <div>
              <p className="font-bold">إدارة المدرسة</p>
              <p className="mt-8 border-t border-slate-400 pt-1">التوقيع</p>
            </div>
            <div>
              {documentSettings.official_stamp_url ? (
                <img src={documentSettings.official_stamp_url} alt="الختم الرسمي" className="mx-auto h-20 w-20 object-contain" />
              ) : displaySettings.show_school_stamp_placeholder ? (
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-slate-400 text-[10px] text-slate-500">
                  الختم الرسمي
                </div>
              ) : null}
            </div>
          </>
        ) : <div className="col-span-2" />}
        <div className="justify-self-end">
          {displaySettings.show_qr_code && (
            verificationUrl ? (
              <QRCodeSVG value={verificationUrl} size={92} level="M" />
            ) : card.status === 'preview' ? (
              <div className="flex h-[92px] w-[92px] items-center justify-center rounded border border-dashed border-slate-300 text-[9px] text-slate-400">
                يُنشأ QR عند إصدار الكارت
              </div>
            ) : null
          )}
          {displaySettings.show_verification_code_text && card.verification_token && (
            <p dir="ltr" className="mt-1 max-w-[120px] break-all font-mono text-[8px] text-slate-500">
              {card.verification_token}
            </p>
          )}
        </div>
        <div className="col-span-3 space-y-1 text-[10px] text-slate-500">
          <p>تاريخ الإصدار: {toArabicDigits(formatUnixSecondsDate(card.generated_at))}</p>
          {documentSettings.result_card_footer_text && <p>{documentSettings.result_card_footer_text}</p>}
          {documentSettings.verification_note_text && <p>{documentSettings.verification_note_text}</p>}
        </div>
      </footer>
    </article>
  );
}
