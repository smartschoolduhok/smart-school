import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getSectionAdvisors } from '../../lib/api';
import type { SectionAdvisorsResponse } from '../../lib/sectionAdvisors';
import { SectionAdvisorsDocument } from '../../components/officialBooks/SectionAdvisorsDocument';
import { PrintLayout, usePrintExport } from '../../components/print';

function positiveId(value: string | null) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function today() {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function documentDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) return null;
  const [year, month, day] = value.split('-').map(Number);
  return parsed.getFullYear() === year && parsed.getMonth() + 1 === month && parsed.getDate() === day ? parsed : null;
}

export function SectionAdvisorsPreview({ schoolId, academicYearId, loadAdvisors = getSectionAdvisors }: {
  schoolId: number | null;
  academicYearId: number | null;
  loadAdvisors?: typeof getSectionAdvisors;
}) {
  const [summary, setSummary] = useState<SectionAdvisorsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [date, setDate] = useState(today);
  const [documentNumber, setDocumentNumber] = useState('');
  const currentSummary = summary?.school.id === schoolId && summary?.academic_year.id === academicYearId ? summary : null;
  const incomplete = currentSummary?.placements.filter(row => row.assignment?.employee_id == null
    || !row.candidates.some(candidate => candidate.employee_id === row.assignment?.employee_id)) || [];
  const ready = !loading && !error && !!currentSummary?.placements.length && incomplete.length === 0;
  const printSnapshot = useMemo(() => ready && currentSummary ? { summary: currentSummary, date, documentNumber } : null,
    [ready, currentSummary, date, documentNumber]);
  const printable = useRef(printSnapshot);
  printable.current = printSnapshot;

  useEffect(() => {
    setDate(today()); setDocumentNumber('');
  }, [schoolId, academicYearId]);

  useEffect(() => {
    let active = true;
    setSummary(null); setError('');
    if (schoolId == null || academicYearId == null) {
      setError('اختر المدرسة والسنة الدراسية من صفحة مرشدي الصفوف لعرض الكتاب.');
      setLoading(false);
      return () => { active = false; printable.current = null; };
    }
    setLoading(true);
    void (async () => {
      try {
        const response = await loadAdvisors(schoolId, academicYearId);
        if (!active) return;
        if (response.error) throw new Error(response.error);
        if (!response.data || response.data.school.id !== schoolId || response.data.academic_year.id !== academicYearId) {
          throw new Error('تعذر مطابقة بيانات المرشدين مع المدرسة والسنة المختارتين.');
        }
        setSummary(response.data);
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'تعذر تحميل كتاب المرشدين.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; printable.current = null; };
  }, [schoolId, academicYearId, loadAdvisors, reload]);

  const { handlePrint, error: printError } = usePrintExport({
    documentTitle: currentSummary ? `كتاب تكليف مرشدي الصفوف — ${currentSummary.school.name} — ${currentSummary.academic_year.name}` : 'كتاب تكليف مرشدي الصفوف',
    onBeforePrint: async () => {
      const snapshot = printSnapshot;
      if (!snapshot) throw new Error('يجب اكتمال تعيين المرشدين وتحميل الكتاب قبل الطباعة.');
      if (!documentDate(snapshot.date)) throw new Error('أدخل تاريخاً صحيحاً للكتاب قبل الطباعة.');
      if (document.fonts) await document.fonts.ready;
      await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>('.section-advisors-document img')).map(image => image.decode?.().catch(() => undefined)));
      if (printable.current !== snapshot) throw new Error('تغير الكتاب أثناء تجهيز الطباعة. راجع البيانات الحالية وأعد الطباعة.');
    },
  });

  const back = <a href="/section-advisors" className="rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200">مرشدو الصفوف</a>;
  if (!ready || !currentSummary) {
    return <main dir="rtl" className="mx-auto max-w-xl space-y-4 p-8 text-center">
      <h1 className="text-xl font-bold">كتاب تكليف مرشدي الصفوف</h1>
      {loading ? <p role="status">جاري تحميل مرشدي الصفوف...</p>
        : <p role={error || incomplete.length ? 'alert' : 'status'} className="text-red-700">{error || (incomplete.length ? 'أكمل تعيين مرشد مؤهل لكل شعبة واحفظ التعديلات قبل طباعة الكتاب.' : 'لا توجد صفوف أو شعب نشطة لعرض الكتاب.')}</p>}
      <div className="flex justify-center gap-3">{back}{!loading && <button type="button" className="rounded-md bg-primary-600 px-3 py-2 text-sm text-white" onClick={() => setReload(value => value + 1)}>إعادة المحاولة</button>}</div>
    </main>;
  }

  const unconfirmed = currentSummary.placements.filter(row => !row.assignment?.attendance_confirmed);
  return <>
    <div className="print-controls mx-auto max-w-4xl space-y-3 px-4 pt-5 text-right text-sm text-gray-600" dir="rtl">
      <div className="flex flex-wrap gap-4 rounded-lg border border-gray-200 bg-white p-4">
        <label className="space-y-1">تاريخ الكتاب<input aria-label="تاريخ الكتاب" type="date" value={date} onChange={event => setDate(event.target.value)} className="block rounded-md border border-gray-300 px-3 py-2" /></label>
        <label className="space-y-1">رقم الكتاب (اختياري)<input aria-label="رقم الكتاب" type="text" maxLength={80} value={documentNumber} onChange={event => setDocumentNumber(event.target.value)} className="block rounded-md border border-gray-300 px-3 py-2" placeholder="يُترك فارغاً عند عدم تخصيص رقم" /></label>
      </div>
      <p>الكتاب يعرض التكليفات المحفوظة للسنة المختارة. رقم الكتاب المدخل للطباعة لا ينشئ قيداً في سجل الكتب.</p>
      {unconfirmed.length > 0 && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">لم تؤكد الإدارة حضور جميع أيام الدوام لـ {unconfirmed.length} من المرشدين. راجع بياناتهم في صفحة المرشدين؛ هذا التنبيه لا يظهر في الكتاب المطبوع.</p>}
      {printError && <p role="alert" className="text-red-700">{printError}</p>}
    </div>
    <PrintLayout size="A4" className="section-advisors-print-sheet" onPrint={handlePrint}
      backButton={<>{back}<button type="button" onClick={() => setReload(value => value + 1)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">تحديث الكتاب</button></>}>
      <SectionAdvisorsDocument summary={currentSummary} issuedAt={documentDate(date) || new Date(Number.NaN)} documentNumber={documentNumber} />
    </PrintLayout>
  </>;
}

export default function PrintSectionAdvisorsPage() {
  const [params] = useSearchParams();
  return <SectionAdvisorsPreview schoolId={positiveId(params.get('school_id'))} academicYearId={positiveId(params.get('academic_year_id'))} />;
}
