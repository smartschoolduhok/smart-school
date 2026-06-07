import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getFeeReceipt } from '../../lib/api';
import { toArabicDigits } from '../../lib/arabicDigits';
import {
  PrintLayout,
  DocumentHeader,
  DocumentFooter,
  QRBlock,
  usePrintExport,
} from '../../components/print';

interface PaymentSnapshot {
  fee_type?: string;
  payment_method?: string;
  amount?: number;
  payment_date?: number;
  notes?: string | null;
}

interface ReceiptRecord {
  id: number;
  receipt_number: string;
  student_name_snapshot: string;
  class_name_snapshot?: string;
  section_name_snapshot?: string;
  school_name_snapshot: string;
  academic_year_snapshot?: string;
  total_amount: number;
  currency?: string;
  status: string;
  verification_token: string;
  created_at: string;
  payments_snapshot?: PaymentSnapshot[];
  settings_snapshot?: Record<string, any>;
  settings_snapshot_json?: string;
}

function canViewFees(roleKey?: string) {
  return ['system_admin', 'school_owner', 'principal', 'vice_principal', 'accountant', 'registrar', 'parent'].includes(roleKey || '');
}

export default function PrintReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const [receipt, setReceipt] = useState<ReceiptRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const snapshot = receipt?.settings_snapshot_json
    ? (() => {
        try { return JSON.parse(receipt.settings_snapshot_json); } catch { return {}; }
      })()
    : (receipt?.settings_snapshot || {});

  const base = typeof window !== 'undefined' ? window.location.origin : '';
  const verificationUrl = receipt?.verification_token
    ? `${base}/verify/receipt/${receipt.verification_token}`
    : '';

  const { handlePrint, isPrinting } = usePrintExport({
    documentTitle: receipt?.receipt_number ? `إيصال ${receipt.receipt_number}` : 'إيصال مالي',
  });

  const fetchReceipt = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const res = await getFeeReceipt(id);
    if (res.error) {
      setError(res.error);
    } else if (res.data) {
      setReceipt(res.data as ReceiptRecord);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/login');
      return;
    }
    if (!canViewFees(user.role_key)) {
      setError('غير مسموح: لا تملك صلاحية تصدير PDF');
      setLoading(false);
      return;
    }
    fetchReceipt();
  }, [authLoading, user, navigate, fetchReceipt]);

  const payments = receipt?.payments_snapshot || [];
  const currencyLabel = receipt?.currency === 'EGP' ? 'جنيه' : (receipt?.currency || 'EGP');

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

  if (!receipt) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-gray-600">الإيصال غير موجود</div>
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
        schoolName={snapshot.school_name || receipt.school_name_snapshot}
        principalName={snapshot.principal_name}
        logoUrl={snapshot.use_logo ? snapshot.logo_url : null}
        headerText={snapshot.receipt_header_text || snapshot.official_book_header_text || null}
        title="إيصال مالي"
        subtitle={`العام الدراسي: ${toArabicDigits(receipt.academic_year_snapshot || '')}`}
      />

      <div className="grid grid-cols-2 gap-4 text-sm mb-4">
        <div><span className="font-semibold">رقم الإيصال:</span> {toArabicDigits(receipt.receipt_number)}</div>
        <div><span className="font-semibold">الطالب:</span> {receipt.student_name_snapshot}</div>
        <div><span className="font-semibold">الصف:</span> {receipt.class_name_snapshot || '-'}</div>
        <div><span className="font-semibold">الفصل:</span> {receipt.section_name_snapshot || '-'}</div>
      </div>

      {receipt.status === 'cancelled' && (
        <div className="bg-red-100 text-red-700 text-center font-bold py-2 mb-4 rounded">
          إيصال ملغى — غير صالح للاستخدام الرسمي
        </div>
      )}

      <div className="mb-4">
        <h3 className="font-bold text-sm mb-2">تفاصيل المدفوعات</h3>
        <table className="print-table">
          <thead>
            <tr>
              <th>#</th>
              <th>نوع القسط</th>
              <th>طريقة الدفع</th>
              <th>المبلغ</th>
              <th>التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && (
              <tr><td colSpan={5} className="text-center text-gray-500">لا توجد مدفوعات</td></tr>
            )}
            {payments.map((p, idx) => (
              <tr key={idx}>
                <td>{toArabicDigits(String(idx + 1))}</td>
                <td>{p.fee_type || '-'}</td>
                <td>{p.payment_method || '-'}</td>
                <td className="font-mono">{toArabicDigits(String(p.amount?.toFixed(2) ?? '0.00'))} {currencyLabel}</td>
                <td>{p.payment_date ? toArabicDigits(new Date(p.payment_date * 1000).toLocaleDateString('ar-SA')) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-gray-50 p-3 rounded mb-4 text-center">
        <div className="font-bold text-lg">
          المبلغ الإجمالي: {toArabicDigits(receipt.total_amount.toFixed(2))} {currencyLabel}
        </div>
      </div>

      <div className="flex items-center justify-between mt-6">
        <QRBlock url={verificationUrl} label="امسح للتحقق من صحة الإيصال" />
        <div className="text-sm text-gray-600">
          <div>تاريخ الإصدار: {toArabicDigits(new Date(receipt.created_at).toLocaleDateString('ar-SA'))}</div>
        </div>
      </div>

      <DocumentFooter
        footerText={snapshot.receipt_footer_text || snapshot.official_book_footer_text || null}
        stampUrl={snapshot.use_stamp ? snapshot.stamp_url : null}
        verificationNote={snapshot.verification_note || null}
      />
    </PrintLayout>
  );
}
