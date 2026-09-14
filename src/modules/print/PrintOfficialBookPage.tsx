import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getOfficialBook, printOfficialBook } from '../../lib/api';
import { PrintLayout, usePrintExport } from '../../components/print';
import {
  OfficialBookDocument,
  type OfficialBookDocumentRecord,
} from '../../components/officialBooks/OfficialBookDocument';

interface BookRecord extends OfficialBookDocumentRecord {
  school_id: number;
  paper_size: string;
  student_name?: string;
  employee_name?: string;
  created_by_name?: string;
  printed_at?: string | null;
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
      className={size === 'A4' ? 'official-book-print-sheet' : ''}
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
      <OfficialBookDocument book={book} verificationUrl={verificationUrl} />
    </PrintLayout>
  );
}
