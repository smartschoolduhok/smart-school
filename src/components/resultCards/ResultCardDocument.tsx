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
  omitUnusedResultCardDecisionColumns,
  RESULT_CARD_COLUMN_ENGLISH_LABELS,
  resultCardHasDecisionPoints,
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
  publication_status?: 'draft' | 'published' | 'withdrawn' | string | null;
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
  labelEn: string;
  value: string;
  prominent?: boolean;
}

function BilingualLabel({ ar, en, inverse = false }: { ar: string; en: string; inverse?: boolean }) {
  return (
    <span className="inline-flex flex-col leading-tight">
      <span>{ar}</span>
      <span
        dir="ltr"
        className={`text-[0.72em] font-semibold tracking-wide ${inverse ? 'text-blue-100' : 'text-slate-500'}`}
      >
        {en}
      </span>
    </span>
  );
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return toArabicDigits(String(value));
}

function bilingualAcademicStatus(value: unknown): string {
  const raw = String(value || '');
  const english = ({
    'ناجح': 'Pass',
    'مكمل': 'Supplementary',
    'راسب': 'Fail',
    'غير مكتمل': 'Incomplete',
    'معفو': 'Exempt',
    'معفى عام': 'Generally exempt',
  } as Record<string, string>)[raw];
  return english ? `${raw} / ${english}` : raw || '—';
}

function resultStatusTone(value: unknown): string {
  const status = String(value || '');
  if (status.includes('ناجح') || status.includes('معف')) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  }
  if (status.includes('مكمل')) return 'border-amber-200 bg-amber-50 text-amber-950';
  if (status.includes('راسب')) return 'border-rose-200 bg-rose-50 text-rose-950';
  return 'border-slate-200 bg-slate-50 text-slate-900';
}

const RESULT_CARD_GRADE_DETAIL_LABELS = {
  annual: 'سنوي مختصر / Annual summary',
  term: 'فصلي / Term details',
  monthly: 'شهري / Monthly details',
  custom: 'مخصص / Custom columns',
} as const;

function renderSubjectCell(row: Record<string, any>, key: ResultCardColumnKey) {
  if (key === 'subject_name') return row.subject_name || row.name || '—';
  if (key === 'academic_status') {
    const raw = String(row.academic_status || row.result_status || '');
    return ({
      pass: 'ناجح / Pass',
      fail: 'راسب / Fail',
      completion: 'مكمل / Supplementary',
      incomplete: 'غير مكتمل / Incomplete',
      exempt_individual: 'معفى فرديًا / Individually exempt',
      exempt_general: 'معفى عامًا / Generally exempt',
    } as Record<string, string>)[raw] || displayGradeStatus(row.result_status, row.exemption_status) || '—';
  }
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
  const isModernDesign = Number(data?.schema_version || 0) >= 7;
  const subjects = Array.isArray(data?.subjects) ? data.subjects : [];
  const hasDecisionPoints = resultCardHasDecisionPoints(subjects, summary);
  const snapshotColumns = snapshotResultCardColumns(data?.visible_columns);
  const columns = omitUnusedResultCardDecisionColumns(snapshotColumns, hasDecisionPoints);
  const columnAverages = snapshotResultCardColumnAverages(
    data?.column_averages,
    columns,
  );
  const isPartial = data?.card_mode === 'partial' ||
    summary.overall_result_status === 'غير مكتمل' ||
    card.overall_result_status === 'غير مكتمل';
  const overallStatus = isPartial
    ? 'غير مكتمل'
    : summary.academic_status || summary.overall_result_status || card.overall_result_status || '—';
  const generalExemption = summary.general_exemption_eligible === true ||
    card.general_exemption_status === true || card.general_exemption_status === 1;
  const schoolName = school.name || card.school_name_snapshot || 'المدرسة';
  const className = classSnapshot.name || card.class_name_snapshot || null;
  const sectionName = section.name || card.section_name_snapshot || null;
  const academicYear = data?.academic_year?.name || card.academic_year_snapshot || null;
  const studentName = student.name || card.student_name_snapshot || '—';
  const studentGender = normalizeResultCardGender(student.gender);
  const templateKind = data?.template_kind || data?.academic_policy?.policy_kind || 'legacy';
  const note = typeof data?.decision_note === 'string' ? data.decision_note.trim() : '';
  const customHeaderText = typeof documentSettings.result_card_header_text === 'string'
    ? documentSettings.result_card_header_text.trim()
    : '';
  const showDecisionNote = displaySettings.show_notes_decisions && note.length > 0;
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
    { label: 'اسم الطالب', labelEn: 'Student name', value: studentName, prominent: true },
  ];
  if (
    displaySettings.show_student_number &&
    student.student_number !== null &&
    student.student_number !== undefined &&
    student.student_number !== ''
  ) {
    studentIdentityItems.push({ label: 'رقم الطالب', labelEn: 'Student number', value: displayValue(student.student_number) });
  }
  if (!isModernDesign && card.status !== 'preview' && card.card_number) {
    studentIdentityItems.push({ label: 'رقم الكارت', labelEn: 'Card number', value: displayValue(card.card_number) });
  }

  const academicPlacementItems: StudentInfoItem[] = [];
  if (className) academicPlacementItems.push({ label: 'الصف', labelEn: 'Grade', value: className });
  if (sectionName) academicPlacementItems.push({ label: 'الشعبة', labelEn: 'Section', value: sectionName });

  const optionalStudentInfoItems: StudentInfoItem[] = [];
  if (displaySettings.show_exam_number && student.exam_number) {
    optionalStudentInfoItems.push({ label: 'الرقم الامتحاني', labelEn: 'Exam number', value: displayValue(student.exam_number) });
  }
  if (displaySettings.show_gender && studentGender) {
    optionalStudentInfoItems.push({ label: 'الجنس', labelEn: 'Gender', value: studentGender });
  }

  const summaryItems = [
    { label: 'النتيجة العامة', labelEn: 'Overall result', value: bilingualAcademicStatus(overallStatus), primary: true },
    summary.academic_status && summary.academic_status !== overallStatus
      ? { label: 'حالة السعي والقرار', labelEn: 'Academic decision', value: String(summary.academic_status), primary: false }
      : null,
    displaySettings.show_overall_average && summary.overall_average !== null &&
      summary.overall_average !== undefined
      ? { label: 'المعدل', labelEn: 'Average', value: displayValue(summary.overall_average), primary: false }
      : null,
    generalExemption
      ? { label: 'الإعفاء العام', labelEn: 'General exemption', value: 'معفى عام / Generally exempt', primary: false }
      : null,
    summary.exemption_status === 'individual'
      ? { label: 'الإعفاء الفردي', labelEn: 'Individual exemption', value: 'يوجد إعفاء فردي / Applied', primary: false }
      : null,
    summary.ministerial_eligibility && summary.ministerial_eligibility_code !== 'not_applicable'
      ? { label: 'الدخول الوزاري', labelEn: 'Ministerial entry', value: String(summary.ministerial_eligibility), primary: false }
      : null,
    Number(summary.decision_points_used || 0) > 0
      ? { label: 'درجات القرار المستخدمة', labelEn: 'Decision points used', value: displayValue(summary.decision_points_used), primary: false }
      : null,
    displaySettings.show_appreciation && summary.appreciation
      ? { label: 'التقدير', labelEn: 'Appreciation', value: String(summary.appreciation), primary: false }
      : null,
  ].filter((item): item is { label: string; labelEn: string; value: string; primary: boolean } => item !== null);

  const countItems = isPartial
    ? []
    : [
        summary.pass_count !== null && summary.pass_count !== undefined
          ? `ناجح / Pass: ${displayValue(summary.pass_count)}`
          : null,
        summary.completion_count !== null && summary.completion_count !== undefined
          ? `مكمل / Supplementary: ${displayValue(summary.completion_count)}`
          : null,
        summary.fail_count !== null && summary.fail_count !== undefined
          ? `راسب / Fail: ${displayValue(summary.fail_count)}`
          : null,
      ].filter((item): item is string => item !== null);
  const outcomeSubjectNotes = [
    Array.isArray(summary.completion_subject_names) && summary.completion_subject_names.length > 0
      ? `مواد الإكمال / Supplementary subjects: ${summary.completion_subject_names.join('، ')}`
      : null,
    Array.isArray(summary.failed_subject_names) && summary.failed_subject_names.length > 0
      ? `مواد الرسوب / Failed subjects: ${summary.failed_subject_names.join('، ')}`
      : null,
    Array.isArray(summary.exempt_subject_names) && summary.exempt_subject_names.length > 0
      ? `مواد الإعفاء / Exempt subjects: ${summary.exempt_subject_names.join('، ')}`
      : null,
  ].filter((item): item is string => item !== null);

  const showStamp = displaySettings.show_signatures_block && (
    documentSettings.official_stamp_url || displaySettings.show_school_stamp_placeholder
  );
  const tableMinimumWidth = columns.length >= 12
    ? '66rem'
    : columns.length >= 10
      ? '58rem'
      : columns.length >= 8
        ? '48rem'
        : '36rem';
  const subjectColumnWidth = columns.length >= 12
    ? '18%'
    : columns.length >= 10
      ? '21%'
      : columns.length > 8
        ? '24%'
        : '28%';
  const gradeDetailLabel = RESULT_CARD_GRADE_DETAIL_LABELS[displaySettings.grade_detail_mode];
  const templateKindLabel = templateKind === 'terminal'
    ? 'صف منتهٍ / Terminal grade'
    : templateKind === 'non_terminal'
      ? 'صف غير منتهٍ / Non-terminal grade'
      : null;
  const examRound = typeof data?.exam_round === 'string' ? data.exam_round.trim() : '';
  const showExamRound = displaySettings.show_exam_round && examRound.length > 0 &&
    examRound !== 'الدور الأول';
  const allStudentInfoItems = [
    ...studentIdentityItems,
    ...academicPlacementItems,
    ...optionalStudentInfoItems,
  ];
  const schoolInitials = schoolName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0])
    .join('');
  const showQrSlot = displaySettings.show_qr_code && (
    Boolean(verificationUrl) || card.status === 'preview'
  );

  return (
    <article
      dir="rtl"
      data-result-card-schema={data?.schema_version || 'legacy'}
      data-grade-detail-mode={displaySettings.grade_detail_mode}
      className={`result-card-document flex flex-col gap-4 bg-white text-gray-950 ${
        isModernDesign ? 'result-card-modern overflow-hidden rounded-2xl border border-slate-300 shadow-lg shadow-slate-200/70' : ''
      } ${compact ? 'p-4 sm:p-5' : 'p-6 sm:p-8'}`}
      style={{ maxWidth: '210mm', minHeight: compact ? undefined : '277mm', margin: '0 auto' }}
    >
      <header className={`result-card-header px-4 py-3 sm:px-5 ${
        isModernDesign
          ? 'relative overflow-hidden rounded-xl border border-slate-300 bg-white pt-5 text-slate-950'
          : 'rounded-xl border-2 border-slate-700'
      }`}>
        {isModernDesign ? (
          <>
            <div aria-hidden="true" className="result-card-header-rule absolute inset-x-0 top-0 h-2 bg-blue-950" />
            <div aria-hidden="true" className="absolute inset-x-0 top-2 h-px bg-amber-500" />
            <div className="grid grid-cols-[3.75rem_minmax(0,1fr)_3.75rem] items-center gap-3 sm:grid-cols-[5.5rem_minmax(0,1fr)_5.5rem]">
              <div className="flex justify-center">
                <div className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-slate-300 bg-slate-50 text-lg font-black text-blue-950 sm:h-20 sm:w-20">
                  <span aria-hidden="true">{schoolInitials || 'م'}</span>
                  {logoUrl && (
                    <img
                      src={logoUrl}
                      alt=""
                      className="absolute inset-0 h-full w-full bg-white object-contain p-1.5"
                      onError={(event) => { event.currentTarget.style.display = 'none'; }}
                    />
                  )}
                </div>
              </div>
              <div className="min-w-0 text-center">
                {displaySettings.show_school_subtitle && customHeaderText && (
                  <p className="result-card-custom-heading whitespace-pre-line text-[10px] font-bold leading-relaxed text-slate-600 sm:text-xs">
                    {customHeaderText}
                  </p>
                )}
                <h1 className="mt-1 text-lg font-black leading-tight tracking-tight text-blue-950 sm:text-2xl">{schoolName}</h1>
                {school.name_en && (
                  <p dir="ltr" className="mt-0.5 text-[10px] font-bold tracking-wide text-slate-500 sm:text-xs">{school.name_en}</p>
                )}
                <div className="mt-2 inline-flex border-y border-blue-950 px-5 py-0.5 text-sm font-black tracking-wide text-blue-950 sm:text-base">
                  <BilingualLabel ar="كارت النتيجة" en="RESULT CARD" />
                </div>
              </div>
              <div className="space-y-2 text-center text-[9px] font-bold text-slate-600 sm:text-[10px]">
                {academicYear && (
                  <div aria-label={`السنة الدراسية ${academicYear}`} className="rounded-lg border border-slate-300 bg-slate-50 px-1.5 py-1">
                    <span className="block">السنة الدراسية</span>
                    <span dir="ltr" className="block text-[10px] font-black text-blue-950 sm:text-xs">{String(academicYear)}</span>
                  </div>
                )}
                {card.status !== 'preview' && card.card_number && (
                  <div className="break-all border-t border-slate-300 pt-1 font-mono text-[8px] text-slate-500">
                    {card.card_number}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className={`grid items-center gap-3 ${logoUrl ? 'grid-cols-1 sm:grid-cols-[6rem_1fr_6rem]' : 'grid-cols-1'}`}>
            {logoUrl && (
              <div className="flex h-20 w-20 justify-self-center items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5">
                <img src={logoUrl} alt="شعار المدرسة" className="h-full w-full object-contain" />
              </div>
            )}
            <div className="min-w-0 text-center">
              <h1 className="text-xl font-black leading-tight tracking-tight sm:text-2xl">{schoolName}</h1>
              {school.name_en && <p dir="ltr" className="mt-0.5 text-xs font-bold tracking-wide text-slate-600 sm:text-sm">{school.name_en}</p>}
              {displaySettings.show_school_subtitle && customHeaderText && (
                <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-slate-600 sm:text-sm">{customHeaderText}</p>
              )}
              <div className="mt-2 inline-flex items-center border-y-2 border-slate-700 px-6 py-0.5 text-base font-black tracking-wide">
                <BilingualLabel ar="كارت النتيجة" en="RESULT CARD" />
              </div>
              {!logoUrl && academicYear && <p dir="ltr" className="mt-2 whitespace-nowrap text-base font-black tracking-wide text-slate-800">{String(academicYear)}</p>}
            </div>
            {logoUrl && academicYear && <p dir="ltr" className="justify-self-center border-y border-slate-300 px-2 py-1 text-base font-black">{String(academicYear)}</p>}
          </div>
        )}
        {contactItems.length > 0 && (
          <div className="relative mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 border-t border-slate-200 pt-2 text-[9px] text-slate-500 sm:text-[10px]">
            {contactItems.map((item) => <span key={String(item)}>{item}</span>)}
          </div>
        )}
        <div className="relative mt-2 flex flex-wrap justify-center gap-2 text-[9px] font-bold uppercase tracking-wide text-slate-600">
          {!isModernDesign && templateKindLabel && (
            <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5">
              {templateKindLabel}
            </span>
          )}
          {showExamRound && (
            <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5">
              الدور / Round: {examRound}
            </span>
          )}
          {!isModernDesign && <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5">{gradeDetailLabel}</span>}
        </div>
      </header>

      <section className={`result-card-student-info rounded-xl px-3 py-2.5 ${
        isModernDesign ? 'border border-slate-300 bg-slate-50/60' : 'border border-slate-300 bg-slate-50/70'
      }`}>
        <div className={`grid gap-3 ${student.photo_url ? 'grid-cols-[1fr_4.5rem]' : ''}`}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {allStudentInfoItems.map((item, index) => (
              <div
                key={`${item.label}-${index}`}
                className={`min-w-0 border-r-2 pr-2 ${item.prominent ? 'col-span-2 sm:col-span-1' : ''} ${isModernDesign ? 'border-blue-900' : 'border-slate-400'}`}
              >
                <div className="text-[9px] font-bold text-slate-500 sm:text-[10px]"><BilingualLabel ar={item.label} en={item.labelEn} /></div>
                <div className={`break-words text-xs leading-snug text-slate-900 sm:text-sm ${item.prominent ? 'font-black' : 'font-bold'}`}>{item.value}</div>
              </div>
            ))}
          </div>
          {student.photo_url && (
            <div className="flex flex-col items-center justify-center gap-1">
              <img src={student.photo_url} alt="صورة الطالب" className="h-20 w-16 rounded border border-slate-300 bg-white object-cover" />
              <span className="text-[8px] font-bold text-slate-500">الصورة / Photo</span>
            </div>
          )}
        </div>
      </section>

      {card.status === 'cancelled' && (
        <div role="note" className="result-card-notice rounded-md border border-red-400 bg-red-50 px-3 py-1.5 text-center text-xs font-bold text-red-900 sm:text-sm">
          كارت ملغى — غير صالح للاستخدام الرسمي
        </div>
      )}

      <section className={`result-card-table-wrap overflow-x-auto rounded-lg border ${isModernDesign ? 'border-slate-400' : 'border-slate-500'}`}>
        <table
          aria-label="درجات مواد الطالب"
          data-column-count={columns.length}
          className={`result-card-table w-full table-fixed border-collapse leading-snug print:min-w-0 ${
            columns.length >= 12 ? 'result-card-table-extra-dense text-[9px]' : columns.length >= 9 ? 'result-card-table-dense text-[10px]' : 'text-[11px]'
          }`}
          style={{ minWidth: tableMinimumWidth }}
        >
          <colgroup>
            {columns.map((column) => (
              <col
                key={column.key}
                className={column.key === 'subject_name' ? 'result-card-subject-column' : undefined}
                style={column.key === 'subject_name' ? { width: subjectColumnWidth } : undefined}
              />
            ))}
          </colgroup>
          <thead>
            <tr className={isModernDesign ? 'border-t-[3px] border-blue-950 bg-slate-100 text-blue-950' : 'bg-slate-200 text-slate-950'}>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`border-l px-1.5 py-2 font-black last:border-l-0 ${isModernDesign ? 'border-slate-300' : 'border-slate-500'} ${
                    column.key === 'subject_name' ? 'text-right' : 'text-center'
                  }`}
                >
                  <BilingualLabel ar={column.label} en={column.label_en || RESULT_CARD_COLUMN_ENGLISH_LABELS[column.key]} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {subjects.map((subject: Record<string, any>, index: number) => (
              <tr
                key={`${subject.subject_id ?? 'subject'}-${index}`}
                className={`${isModernDesign ? 'odd:bg-white even:bg-slate-50/70' : 'odd:bg-white even:bg-slate-50'} ${
                  columnAverages && index === subjects.length - 1 ? 'result-card-last-subject-row' : ''
                }`}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className="break-words border-l border-t border-slate-200 px-1.5 py-1.5 text-center align-middle last:border-l-0"
                    style={column.key === 'subject_name' ? { textAlign: 'right', fontWeight: 700 } : undefined}
                  >
                    {renderSubjectCell(subject, column.key)}
                  </td>
                ))}
              </tr>
            ))}
            {columnAverages && (
              <tr className={`result-card-average-row border-t-2 font-black ${isModernDesign ? 'border-blue-950 bg-slate-100 text-blue-950' : 'border-slate-700 bg-slate-100'}`}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`border-l px-1.5 py-2 text-center last:border-l-0 ${isModernDesign ? 'border-slate-300' : 'border-slate-400'} ${
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

      <section className={`result-card-summary grid gap-3 ${showDecisionNote ? 'sm:grid-cols-2' : ''}`}>
        <div className={`rounded-xl p-3 ${isModernDesign ? 'border border-slate-300 bg-white' : 'border-2 border-slate-700'}`}>
          <h2 className={`mb-2 border-b pb-1.5 text-sm font-black ${isModernDesign ? 'border-slate-200 text-blue-950' : 'border-slate-200'}`}><BilingualLabel ar="الخلاصة العامة" en="Overall summary" /></h2>
          <div className="grid grid-cols-2 gap-2">
            {summaryItems.map((item) => (
              <div
                key={item.label}
                className={`${item.primary ? 'col-span-2' : ''} ${
                  item.primary && isModernDesign ? `rounded-lg border px-3 py-2 ${resultStatusTone(overallStatus)}` : ''
                }`}
              >
                <div className="text-[10px] font-bold text-slate-500"><BilingualLabel ar={item.label} en={item.labelEn} /></div>
                <div className={`text-sm ${item.primary ? 'font-black' : 'font-bold'}`}>{item.value}</div>
              </div>
            ))}
            {countItems.length > 0 && (
              <div className="col-span-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-200 pt-2 text-[10px] font-semibold text-slate-600">
                {countItems.map((item) => <span key={item}>{item}</span>)}
              </div>
            )}
            {outcomeSubjectNotes.length > 0 && (
              <div className="col-span-2 space-y-1 border-t border-slate-200 pt-2 text-[10px] font-bold leading-relaxed text-slate-700">
                {outcomeSubjectNotes.map(item => <p key={item}>{item}</p>)}
              </div>
            )}
            {summary.ministerial_reason && summary.ministerial_eligibility_code !== 'not_applicable' && (
              <div className="col-span-2 border-t border-slate-200 pt-2 text-[10px] leading-relaxed text-slate-600">
                <span className="font-bold">سبب قرار الدخول الوزاري / Ministerial-entry basis: </span>
                {String(summary.ministerial_reason)}
              </div>
            )}
          </div>
        </div>
        {showDecisionNote && (
          <div className={`rounded-xl border p-3 ${isModernDesign ? 'border-slate-300 bg-slate-50/50' : 'border-slate-400'}`}>
            <h2 className={`mb-2 border-b pb-1.5 text-sm font-black ${isModernDesign ? 'border-slate-200 text-blue-950' : 'border-slate-200'}`}><BilingualLabel ar="الملاحظات والقرارات" en="Notes and decisions" /></h2>
            <p className="result-card-note-body min-h-12 whitespace-pre-line text-sm leading-relaxed text-slate-700">{note}</p>
          </div>
        )}
      </section>

      <footer className={`result-card-footer mt-auto rounded-xl border-t-2 pt-3 text-center text-xs ${
        isModernDesign ? 'border-blue-950 bg-slate-50/70 px-3 pb-2' : 'border-slate-700'
      }`}>
        <div className={`result-card-footer-grid grid items-end gap-4 ${showQrSlot ? 'grid-cols-[1fr_auto]' : 'grid-cols-1'}`}>
          <div className={`grid items-end gap-4 ${showStamp ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <div className="min-h-20">
            {displaySettings.show_signatures_block && (
              <>
                <p className="font-black">إدارة المدرسة</p>
                <p dir="ltr" className="text-[9px] font-semibold text-slate-500">School administration</p>
                <p className="mx-auto mt-7 max-w-36 border-t border-slate-500 pt-1 text-[10px]">التوقيع / Signature</p>
              </>
            )}
          </div>
          {showStamp && <div className="flex min-h-20 flex-col items-center justify-end">
            {showStamp && (
              documentSettings.official_stamp_url ? (
                <>
                  <img src={documentSettings.official_stamp_url} alt="الختم الرسمي" className="h-20 w-20 object-contain" />
                  <p className="mt-1 text-[9px] text-slate-500">الختم الرسمي / Official stamp</p>
                </>
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-slate-400 px-2 text-[9px] font-semibold text-slate-500">
                  الختم الرسمي<br />Official stamp
                </div>
              )
            )}
          </div>}
          </div>
          {showQrSlot && <div className="flex min-h-20 flex-col items-center justify-end border-r border-slate-200 pr-4">
            {verificationUrl ? (
              <QRCodeSVG value={verificationUrl} size={92} level="M" />
            ) : (
              <div className="flex h-[92px] w-[92px] items-center justify-center rounded border border-dashed border-slate-300 px-2 text-[8px] font-semibold leading-relaxed text-slate-500">
                يُضاف QR عند إصدار الكارت<br />Added on issue
              </div>
            )}
            {verificationUrl && <p className="mt-1 text-[8px] font-bold text-slate-600">امسح للتحقق من صحة الكارت</p>}
            {displaySettings.show_verification_code_text && card.verification_token && (
              <p dir="ltr" className="mt-1 max-w-[125px] break-all font-mono text-[7px] leading-tight text-slate-500">
                {card.verification_token}
              </p>
            )}
          </div>}
        </div>
        <div className="result-card-footer-meta mt-3 space-y-1 border-t border-slate-200 pt-2 text-[9px] leading-relaxed text-slate-500">
          <p>تاريخ الإصدار / Issue date: {toArabicDigits(formatUnixSecondsDate(card.generated_at))}</p>
          {documentSettings.result_card_footer_text && <p className="whitespace-pre-line">{documentSettings.result_card_footer_text}</p>}
          {documentSettings.verification_note_text && <p className="whitespace-pre-line">{documentSettings.verification_note_text}</p>}
        </div>
      </footer>
    </article>
  );
}
