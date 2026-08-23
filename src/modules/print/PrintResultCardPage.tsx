import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PrintLayout, usePrintExport } from '../../components/print';
import {
  ResultCardDocument,
  type ResultCardDocumentRecord,
} from '../../components/resultCards/ResultCardDocument';
import { useAuth } from '../../hooks/useAuth';
import { getResultCard, markResultCardPrinted } from '../../lib/api';
import {
  hasRole,
  RESULT_CARD_PRINT_ROLES,
  RESULT_CARD_VIEW_ROLES,
} from '../../lib/rbac';
import { shouldRegisterResultCardPrint } from '../../lib/resultCardPrint';
import type { RoleKey } from '../../types';

interface CardRecord extends ResultCardDocumentRecord {
  id: number;
  school_id: number;
  card_number: string;
  status: string;
  verification_token: string;
  card_data_parsed?: Record<string, any>;
}

function canViewResultCards(roleKey?: RoleKey) {
  return hasRole(roleKey, RESULT_CARD_VIEW_ROLES);
}

export default function PrintResultCardPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const [card, setCard] = useState<CardRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestedSchoolId = Number(searchParams.get('school_id'));
  const explicitSchoolId = Number.isInteger(requestedSchoolId) && requestedSchoolId > 0
    ? requestedSchoolId
    : null;
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  const verificationUrl = card?.verification_token
    ? `${base}/verify/result-card/${card.verification_token}`
    : null;

  const { handlePrint } = usePrintExport({
    documentTitle: card?.card_number ? `كارت نتيجة ${card.card_number}` : 'كارت نتيجة',
    onBeforePrint: async () => {
      if (!card || !shouldRegisterResultCardPrint(
        card.status,
        hasRole(user?.role_key, RESULT_CARD_PRINT_ROLES),
      )) return;
      try {
        await markResultCardPrinted(String(card.id), card.school_id);
      } catch {
        // Printing remains available when the best-effort audit marker fails.
      }
    },
  });

  const fetchCard = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const res = await getResultCard(id, explicitSchoolId);
    if (res.error) setError(res.error);
    else if (res.data) setCard(res.data as CardRecord);
    setLoading(false);
  }, [explicitSchoolId, id]);

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
    if (user.role_key === 'system_admin' && explicitSchoolId == null) {
      setError('يجب فتح الكارت من مدرسة محددة');
      setLoading(false);
      return;
    }
    void fetchCard();
  }, [authLoading, explicitSchoolId, fetchCard, navigate, user]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-gray-100 text-gray-600">جاري التحميل...</div>;
  }

  if (error || !card) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <div className="rounded-xl bg-white p-6 text-center shadow">
          <div className="mb-2 font-bold text-red-600">{error || 'كارت النتيجة غير موجود'}</div>
          <button onClick={() => navigate(-1)} className="rounded bg-gray-100 px-4 py-2 text-sm hover:bg-gray-200">رجوع</button>
        </div>
      </div>
    );
  }

  return (
    <PrintLayout
      onPrint={handlePrint}
      backButton={
        <button onClick={() => navigate(-1)} className="rounded-md bg-gray-100 px-3 py-2 text-sm hover:bg-gray-200">
          رجوع
        </button>
      }
    >
      <ResultCardDocument
        card={card}
        data={card.card_data_parsed}
        verificationUrl={verificationUrl}
      />
    </PrintLayout>
  );
}
