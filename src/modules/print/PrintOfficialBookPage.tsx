import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getOfficialBook, printOfficialBook } from '../../lib/api';
import { toArabicDigits } from '../../lib/arabicDigits';
import {
  PrintLayout,
  DocumentHeader,
  DocumentFooter,
  QRBlock,
  usePrintExport,
} from '../../components/print';

interface BookRecord {
  id: number;
  school_id: number;
  document_number: string;
  title: string;
  body_text: string;
  paper_size: string;
  status: string;
  student_name?: string;
  employee_name?: string;
  created_by_name?: string;
  created_at: string;
  verification_token: string;
  printed_at?: string | null;
  settings_snapshot_json?: string;
  school_name_snapshot?: string;
  principal_name_snapshot?: string;
  logo_url_snapshot?: string;
  stamp_url_snapshot?: string;
  use_logo_snapshot?: number;
  use_stamp_snapshot?: number;
  header_text_snapshot?: string;
  footer_text_snapshot?: string;
  verification_note_snapshot?: string;
}

function canViewOfficialBooks(roleKey?: string) {
  return ['system_admin', 'school_owner', 'principal', 'vice_principal', 'registrar', 'teacher'].includes(roleKey || '');
}

function canManageOfficialBooks(roleKey?: string) {
  return ['system_admin', 'school_owner', 'principal', 'vice_principal', 'registrar'].includes(roleKey || '');
}

export default function PrintOfficialBookPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const [book, setBook] = useState<BookRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const snapshot = book?.settings_snapshot_json
    ? (() => {
        try { return JSON.parse(book.settings_snapshot_json); } catch { return {}; }
      })()
    : {};

  const base = typeof window !== 'undefined' ? window.location.origin : '';
  const verificationUrl = book?.verification_token
    ? `${base}/verify/official-book/${book.verification_token}`
    : '';

  const { handlePrint, isPrinting } = usePrintExport({
    documentTitle: book?.document_number ? `كتاب رسمي ${book.document_number}` : 'كتاب رسمي',
    onBeforePrint: async () => {
      if (!book || book.status === 'cancelled') return;
      if (canManageOfficialBooks(user?.role_key)) {
        try {
          await printOfficialBook(book.id, book.school_id);
        } catch {
          // Non-blocking: print record is best-effort
        }
      }
    },
  });

  const fetchBook = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getOfficialBook(id);
      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        setBook(res.data as BookRecord);
      } else {
        setError('الكتاب الرسمي غير موجود');
      }
    } catch (err: any) {
      setError(err.message || 'فشل في جلب البيانات');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/login');
      return;
    }
    if (!canViewOfficialBooks(user.role_key)) {
      setError('غير مسموح: لا تملك صلاحية تصدير PDF');
      setLoading(false);
      return;
    }
    fetchBook();
  }, [authLoading, user, navigate, fetchBook]);

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

  if (!book) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-gray-600">الكتاب الرسمي غير موجود</div>
      </div>
    );
  }

  const size = book.paper_size === 'A5' ? 'A5' : 'A4';

  return (
    <PrintLayout
      size={size}
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
        schoolName={book.school_name_snapshot || snapshot.school_name || 'المدرسة'}
        principalName={book.principal_name_snapshot || snapshot.principal_name}
        logoUrl={book.use_logo_snapshot ? (book.logo_url_snapshot || snapshot.logo_url) : null}
        headerText={book.header_text_snapshot || snapshot.header_text || null}
        title={book.title}
        subtitle={`رقم الكتاب: ${toArabicDigits(book.document_number)}`}
      />

      {book.status === 'cancelled' && (
        <div className="bg-red-100 text-red-700 text-center font-bold py-2 mb-4 rounded">
          كتاب ملغى — غير صالح للاستخدام الرسمي
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 text-sm mb-4">
        {book.student_name && (
          <div><span className="font-semibold">الطالب:</span> {book.student_name}</div>
        )}
        {book.employee_name && (
          <div><span className="font-semibold">الموظف:</span> {book.employee_name}</div>
        )}
        <div><span className="font-semibold">تاريخ الإنشاء:</span> {toArabicDigits(new Date(book.created_at).toLocaleDateString('ar-SA'))}</div>
        {book.created_by_name && (
          <div><span className="font-semibold">أنشئ بواسطة:</span> {book.created_by_name}</div>
        )}
      </div>

      <div className="print-body mb-6">
        {book.body_text}
      </div>

      <div className="flex items-center justify-between mt-6">
        <QRBlock url={verificationUrl} label="امسح للتحقق من صحة الكتاب" />
        <div className="text-sm text-gray-600">
          <div>تاريخ الإصدار: {toArabicDigits(new Date(book.created_at).toLocaleDateString('ar-SA'))}</div>
          {book.printed_at && (
            <div>تاريخ آخر طباعة: {toArabicDigits(new Date(book.printed_at).toLocaleDateString('ar-SA'))}</div>
          )}
        </div>
      </div>

      <DocumentFooter
        footerText={book.footer_text_snapshot || snapshot.footer_text || null}
        stampUrl={book.use_stamp_snapshot ? (book.stamp_url_snapshot || snapshot.stamp_url) : null}
        verificationNote={book.verification_note_snapshot || snapshot.verification_note || null}
      />
    </PrintLayout>
  );
}
