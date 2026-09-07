import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { FINANCE_ACCESS_ROLES, hasRole } from '../../lib/rbac';
import { getFeeReceipt, markReceiptPrinted } from '../../lib/api';
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
  school_id: number;
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
  created_at: number;
  payments_snapshot?: PaymentSnapshot[];
  settings_snapshot?: Record<string, any>;
  settings_snapshot_json?: string;
}

export default function PrintReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [loadedReceipt, setReceipt] = useState<ReceiptRecord | null>(null);
  const receipt = loadedReceipt?.school_id === schoolId && loadedReceipt?.id === Number(id) ? loadedReceipt : null;
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

  const { handlePrint, isPrinting, error: printError } = usePrintExport({
    documentTitle: receipt?.receipt_number ? `إيصال ${receipt.receipt_number}` : 'إيصال مالي',
    onBeforePrint: async () => {
      if (!receipt || receipt.status === 'cancelled' || schoolId !== receipt.school_id) throw new Error('الإيصال غير متاح للطباعة');
      const result = await markReceiptPrinted(receipt.id, schoolId);
      if (result.error) throw new Error(result.error);
    },
  });

  useEffect(() => {
    setReceipt(null);
    if (authLoading) return;
    if (!user) {
      navigate('/login');
      return;
    }
    if (!hasRole(user.role_key, FINANCE_ACCESS_ROLES)) {
      setError('غير مسموح: لا تملك صلاحية تصدير PDF');
      setLoading(false);
      return;
    }
    if (!id || schoolId == null) { setLoading(false); return; }
    const isCurrent = captureSchoolRequest();
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getFeeReceipt(id, schoolId).then(res => {
      // An older receipt ID in the same school must not overwrite a newer route.
      if (cancelled || !isCurrent()) return;
      if (res.error) setError(res.error);
      else if (res.data) setReceipt(res.data as ReceiptRecord);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [authLoading, user, navigate, id, schoolId, captureSchoolRequest]);

  const payments = receipt?.payments_snapshot || [];
  // New documents snapshot IQD. Do not relabel legacy documents with unknown currency.
  const currencyLabel = snapshot.currency === 'IQD' ? 'د.ع' : (receipt?.currency || 'عملة السجل الأصلي');

  if (!authLoading && schoolId == null) return <div className="p-6"><SystemAdminSchoolSelector {...schoolScope} /><p>اختر المدرسة لعرض الإيصال.</p></div>;

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
      {printError && <p role="alert" className="text-red-700 print:hidden">{printError}</p>}
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
                <td className="font-mono">{toArabicDigits(String(p.amount ?? 0))} {currencyLabel}</td>
                <td>{p.payment_date ? toArabicDigits(new Date(p.payment_date * 1000).toLocaleDateString('ar-SA')) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-gray-50 p-3 rounded mb-4 text-center">
        <div className="font-bold text-lg">
          المبلغ الإجمالي: {toArabicDigits(String(receipt.total_amount))} {currencyLabel}
        </div>
      </div>

      <div className="flex items-center justify-between mt-6">
        <QRBlock url={verificationUrl} label="امسح للتحقق من صحة الإيصال" />
        <div className="text-sm text-gray-600">
          <div>تاريخ الإصدار: {toArabicDigits(new Date(Number(receipt.created_at) * 1000).toLocaleDateString('ar-SA'))}</div>
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
