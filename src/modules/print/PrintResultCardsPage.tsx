import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  PrintLayout,
  ResultCardPrintFit,
  usePrintExport,
  type ResultCardPrintFitHandle,
} from '../../components/print';
import {
  ResultCardDocument,
  type ResultCardDocumentRecord,
} from '../../components/resultCards/ResultCardDocument';
import { useAuth } from '../../hooks/useAuth';
import { getResultCard, markResultCardPrinted } from '../../lib/api';
import {
  isResultCardPrintable,
  parseResultCardBatchIds,
  shouldRegisterResultCardPrint,
} from '../../lib/resultCardPrint';
import { hasRole, RESULT_CARD_PRINT_ROLES } from '../../lib/rbac';

interface CardRecord extends ResultCardDocumentRecord {
  id: number;
  school_id: number;
  card_number: string;
  status: string;
  publication_status: 'draft' | 'published' | 'withdrawn';
  verification_token: string;
  card_data_parsed?: Record<string, any>;
}

export default function PrintResultCardsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fitHandles = useRef(new Map<number, ResultCardPrintFitHandle>());
  const idsParam = searchParams.get('ids');
  const cardIds = useMemo(() => parseResultCardBatchIds(idsParam), [idsParam]);
  const requestedSchoolId = Number(searchParams.get('school_id'));
  const explicitSchoolId = Number.isInteger(requestedSchoolId) && requestedSchoolId > 0
    ? requestedSchoolId
    : null;
  const canPrint = hasRole(user?.role_key, RESULT_CARD_PRINT_ROLES);
  const base = typeof window !== 'undefined' ? window.location.origin : '';

  const { handlePrint, isPrinting, error: printError } = usePrintExport({
    documentTitle: cards.length > 0 ? `كارتات نتائج - ${cards.length}` : 'كارتات نتائج',
    onBeforePrint: async () => {
      for (const card of cards) fitHandles.current.get(card.id)?.fit();
      const publishPrintMarkers = cards
        .filter(card => shouldRegisterResultCardPrint(card.status, canPrint, card.publication_status))
        .map(card => markResultCardPrinted(card.id, card.school_id));
      await Promise.allSettled(publishPrintMarkers);
    },
  });

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/login');
      return;
    }
    if (!canPrint) {
      setError('غير مسموح: لا تملك صلاحية طباعة كارتات النتائج');
      setLoading(false);
      return;
    }
    if (user.role_key === 'system_admin' && explicitSchoolId == null) {
      setError('يجب فتح الكارتات من مدرسة محددة');
      setLoading(false);
      return;
    }
    if (cardIds.length === 0) {
      setError('لم تُحدد كارتات صالحة للطباعة');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all(cardIds.map(id => getResultCard(id, explicitSchoolId))).then((responses) => {
      if (cancelled) return;
      const failed = responses.find(response => response.error || !response.data);
      if (failed) {
        setCards([]);
        setError(failed.error || 'تعذر تحميل جميع الكارتات المحددة');
        setLoading(false);
        return;
      }
      const loaded = responses.map(response => response.data as CardRecord);
      const invalid = loaded.find(card =>
        !isResultCardPrintable(card.status, card.publication_status) ||
        (explicitSchoolId != null && card.school_id !== explicitSchoolId)
      );
      if (invalid) {
        setCards([]);
        setError('تتضمن المجموعة كارتًا ملغى أو مسحوبًا أو تابعًا لمدرسة أخرى');
      } else {
        setCards(loaded);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [authLoading, canPrint, cardIds, explicitSchoolId, navigate, user]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-gray-100 text-gray-600">جاري تحميل الكارتات...</div>;
  }

  if (error || cards.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <div className="rounded-xl bg-white p-6 text-center shadow">
          <div className="mb-2 font-bold text-red-600">{error || 'لا توجد كارتات للطباعة'}</div>
          <button onClick={() => navigate(-1)} className="rounded bg-gray-100 px-4 py-2 text-sm hover:bg-gray-200">رجوع</button>
        </div>
      </div>
    );
  }

  return (
    <PrintLayout
      size={null}
      onPrint={isPrinting ? undefined : handlePrint}
      className="result-card-batch-print"
      backButton={(
        <button onClick={() => navigate(-1)} className="rounded-md bg-gray-100 px-3 py-2 text-sm hover:bg-gray-200">
          رجوع
        </button>
      )}
    >
      {printError && <p role="alert" className="mb-3 text-red-700 print:hidden">{printError}</p>}
      {cards.map(card => (
        <section key={card.id} className="print-a4 result-card-print-sheet result-card-batch-sheet">
          <ResultCardPrintFit
            ref={(handle) => {
              if (handle) fitHandles.current.set(card.id, handle);
              else fitHandles.current.delete(card.id);
            }}
          >
            <ResultCardDocument
              card={card}
              data={card.card_data_parsed}
              verificationUrl={card.status === 'active' && card.verification_token
                ? `${base}/verify/result-card/${card.verification_token}`
                : null}
            />
          </ResultCardPrintFit>
        </section>
      ))}
    </PrintLayout>
  );
}
