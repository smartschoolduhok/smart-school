import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getResultCard, markResultCardPrinted } from '../../lib/api';
import { toArabicDigits } from '../../lib/arabicDigits';
import { displayGradeStatus } from '../../lib/gradePresentation';
import {
  formatExemptionStatus,
  formatUnixSecondsDate,
  shouldRegisterResultCardPrint,
  type ExemptionStatus,
} from '../../lib/resultCardPrint';
import {
  hasRole,
  RESULT_CARD_PRINT_ROLES,
  RESULT_CARD_VIEW_ROLES,
} from '../../lib/rbac';
import type { RoleKey } from '../../types';
import {
  PrintLayout,
  DocumentHeader,
  DocumentFooter,
  QRBlock,
  PrintableTable,
  usePrintExport,
} from '../../components/print';
import type { PrintableTableColumn } from '../../components/print';

interface SubjectRow {
  subject_name: string;
  annual_effort: number | null;
  final_exam: number | null;
  effective_grade: number | null;
  result_status: string;
  exemption_status: ExemptionStatus;
}

interface CardSummary {
  annual_effort_average?: number | null;
  min_annual_effort?: number | null;
  overall_result_status?: string;
}

interface ResultCardDocumentSettings {
  result_card_header_text?: string | null;
  result_card_footer_text?: string | null;
  verification_note_text?: string | null;
  logo_url?: string | null;
  official_stamp_url?: string | null;
}

interface CardData {
  subjects?: SubjectRow[];
  summary?: CardSummary;
  document_settings?: ResultCardDocumentSettings;
}

interface CardRecord {
  id: number;
  school_id: number;
  card_number: string;
  student_name_snapshot: string;
  class_name_snapshot: string;
  section_name_snapshot: string;
  school_name_snapshot: string;
  academic_year_snapshot: string;
  general_exemption_status: ExemptionStatus;
  overall_result_status: string;
  generated_at: number | string;
  printed_at: number | string | null;
  status: string;
  verification_token: string;
  card_data_parsed?: CardData;
}

function canViewResultCards(roleKey?: RoleKey) {
  return hasRole(roleKey, RESULT_CARD_VIEW_ROLES);
}

export default function PrintResultCardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const [card, setCard] = useState<CardRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const documentSettings = card?.card_data_parsed?.document_settings ?? {};

  const base = typeof window !== 'undefined' ? window.location.origin : '';
  const verificationUrl = card?.verification_token
    ? `${base}/verify/result-card/${card.verification_token}`
    : '';

  const { handlePrint, isPrinting } = usePrintExport({
    documentTitle: card?.card_number ? `كارت نتيجة ${card.card_number}` : 'كارت نتيجة',
    onBeforePrint: async () => {
      if (!card || !shouldRegisterResultCardPrint(
        card.status,
        hasRole(user?.role_key, RESULT_CARD_PRINT_ROLES),
      )) return;
      try {
        await markResultCardPrinted(String(card.id), card.school_id);
      } catch {
        // Non-blocking: print record is best-effort
      }
    },
  });

  const fetchCard = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const res = await getResultCard(id);
    if (res.error) {
      setError(res.error);
    } else if (res.data) {
      setCard(res.data as CardRecord);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/login');
      return;
    }
    if (!canViewResultCards(user.role_key)) {
      setError('غير مسموح: لا تملك صلاحية تصدير PDF');
      setLoading(false);
      return;
    }
    fetchCard();
  }, [authLoading, user, navigate, fetchCard]);

  const subjects = card?.card_data_parsed?.subjects || [];
  const summary = card?.card_data_parsed?.summary || {};

  const subjectColumns: PrintableTableColumn<any>[] = [
    { key: 'subject_name', header: 'المادة', align: 'right' },
    { key: 'annual_effort', header: 'السعي السنوي', align: 'center', render: (r) => toArabicDigits(String(r.annual_effort ?? '-')) },
    { key: 'final_exam', header: 'النهائي', align: 'center', render: (r) => toArabicDigits(String(r.final_exam ?? '-')) },
    { key: 'effective_grade', header: 'الدرجة الفعّالة', align: 'center', render: (r) => toArabicDigits(String(r.effective_grade ?? '-')) },
    { key: 'result_status', header: 'الحالة', align: 'center', render: (r) => displayGradeStatus(r.result_status, r.exemption_status) ?? '-' },
    { key: 'exemption_status', header: 'إعفاء', align: 'center', render: (r) => formatExemptionStatus(r.exemption_status, 'individual') },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-gray-600">جاري التحميل...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="bg-white p-6 rounded-xl shadow text-center">
          <div className="text-red-600 font-bold mb-2">{error}</div>
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm"
          >
            رجوع
          </button>
        </div>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-gray-600">كارت النتيجة غير موجود</div>
      </div>
    );
  }

  return (
    <PrintLayout
      onPrint={handlePrint}
      backButton={
        <button
          onClick={() => navigate(-1)}
          className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm"
        >
          رجوع
        </button>
      }
    >
      <DocumentHeader
        schoolName={card.school_name_snapshot}
        logoUrl={documentSettings.logo_url ?? null}
        headerText={documentSettings.result_card_header_text ?? null}
        title="كارت النتيجة"
        subtitle={`العام الدراسي: ${toArabicDigits(card.academic_year_snapshot)}`}
      />

      <div className="grid grid-cols-2 gap-4 text-sm mb-4">
        <div><span className="font-semibold">رقم الكارت:</span> {toArabicDigits(card.card_number)}</div>
        <div><span className="font-semibold">الطالب:</span> {card.student_name_snapshot}</div>
        <div><span className="font-semibold">الصف:</span> {card.class_name_snapshot}</div>
        <div><span className="font-semibold">الفصل:</span> {card.section_name_snapshot}</div>
      </div>

      {card.status === 'cancelled' && (
        <div className="bg-red-100 text-red-700 text-center font-bold py-2 mb-4 rounded">
          كارت ملغى — غير صالح للاستخدام الرسمي
        </div>
      )}

      <div className="mb-4">
        <PrintableTable
          columns={subjectColumns}
          data={subjects}
          caption="تفاصيل الدرجات"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm mb-4">
        <div><span className="font-semibold">متوسط السعي السنوي:</span> {toArabicDigits(String(summary.annual_effort_average ?? '-'))}</div>
        <div><span className="font-semibold">أدنى سعي سنوي:</span> {toArabicDigits(String(summary.min_annual_effort ?? '-'))}</div>
        <div><span className="font-semibold">النتيجة العامة:</span> {summary.overall_result_status || card.overall_result_status || '-'}</div>
        <div><span className="font-semibold">حالة الإعفاء العام:</span> {formatExemptionStatus(card.general_exemption_status, 'general')}</div>
      </div>

      <div className="flex items-center justify-between mt-6">
        <QRBlock url={verificationUrl} label="امسح للتحقق من صحة الكارت" />
        <div className="text-sm text-gray-600">
          <div>تاريخ الإصدار: {toArabicDigits(formatUnixSecondsDate(card.generated_at))}</div>
          {card.printed_at && (
            <div>تاريخ أول طباعة: {toArabicDigits(formatUnixSecondsDate(card.printed_at))}</div>
          )}
        </div>
      </div>

      <DocumentFooter
        footerText={documentSettings.result_card_footer_text ?? null}
        stampUrl={documentSettings.official_stamp_url ?? null}
        verificationNote={documentSettings.verification_note_text ?? undefined}
      />
    </PrintLayout>
  );
}
