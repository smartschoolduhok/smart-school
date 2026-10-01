import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getTimetableTeacherWorkloadSummary } from '../../lib/api';
import type { TeacherWorkloadSummary } from '../../lib/teacherWorkloadSummary';
import { TeacherWorkloadDocument } from '../../components/officialBooks/TeacherWorkloadDocument';
import { PrintLayout, usePrintExport } from '../../components/print';

function positiveId(value: string | null) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function TeacherWorkloadPreview({ schoolId, academicYearId, loadSummary = getTimetableTeacherWorkloadSummary }: {
  schoolId: number | null;
  academicYearId: number | null;
  loadSummary?: typeof getTimetableTeacherWorkloadSummary;
}) {
  const [result, setResult] = useState<{ summary: TeacherWorkloadSummary; issuedAt: Date } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const currentResult = result?.summary.school.id === schoolId && result?.summary.academic_year.id === academicYearId ? result : null;
  const printableResult = useRef(currentResult);
  printableResult.current = loading || error ? null : currentResult;

  useEffect(() => {
    let active = true;
    setResult(null);
    setError('');
    if (schoolId == null || academicYearId == null) {
      setError('اختر المدرسة والسنة الدراسية من صفحة الجدول لعرض الكتاب.');
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    void (async () => {
      try {
        const response = await loadSummary(schoolId, academicYearId);
        if (!active) return;
        if (response.error) throw new Error(response.error);
        if (!response.data || response.data.school.id !== schoolId || response.data.academic_year.id !== academicYearId) {
          throw new Error('تعذر مطابقة بيانات الكشف مع المدرسة والسنة المختارتين.');
        }
        setResult({ summary: response.data, issuedAt: new Date() });
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'تعذر تحميل أنصبة المدرسين.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; printableResult.current = null; };
  }, [schoolId, academicYearId, loadSummary, reload]);

  const { handlePrint, error: printError } = usePrintExport({
    documentTitle: currentResult ? `أنصبة المدرسين — ${currentResult.summary.school.name} — ${currentResult.summary.academic_year.name}` : 'أنصبة المدرسين',
    onBeforePrint: async () => {
      if (!currentResult || loading || error) throw new Error('انتظر اكتمال تحميل الكشف قبل الطباعة.');
      if (document.fonts) await document.fonts.ready;
      await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>('.teacher-workload-document img')).map(image => image.decode?.().catch(() => undefined)));
      if (printableResult.current !== currentResult) throw new Error('تغير الكشف أثناء تجهيز الطباعة. راجع البيانات الحالية وأعد الطباعة.');
    },
  });

  const back = <a href="/timetable" className="rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200">الجدول الدراسي</a>;
  if (loading || error || !currentResult || currentResult.summary.teachers.length === 0) {
    return <main dir="rtl" className="mx-auto max-w-xl space-y-4 p-8 text-center">
      <h1 className="text-xl font-bold">كتاب أنصبة المدرّسين</h1>
      {loading ? <p role="status">جاري تحميل حصص المدرسين...</p>
        : <p role={error ? 'alert' : 'status'} className={error ? 'text-red-700' : 'text-gray-600'}>{error || 'لا يوجد مدرسون فعّالون في المدرسة لعرض الكشف.'}</p>}
      <div className="flex justify-center gap-3">{back}{!loading && <button type="button" className="rounded-md bg-primary-600 px-3 py-2 text-sm text-white" onClick={() => setReload(value => value + 1)}>إعادة المحاولة</button>}</div>
    </main>;
  }

  return <>
    <div className="print-controls mx-auto max-w-4xl px-4 pt-5 text-right text-sm text-gray-600" dir="rtl">
      <p>الكشف يعرض الحصص الأسبوعية الموجودة في الجدول المحفوظ للسنة المختارة. يظهر المدرس دون حصص بالعدد صفر.</p>
      {printError && <p role="alert" className="mt-2 text-red-700">{printError}</p>}
    </div>
    <PrintLayout size="A4" className="teacher-workload-print-sheet" onPrint={handlePrint} backButton={<>{back}<button type="button" onClick={() => setReload(value => value + 1)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">تحديث الكشف</button></>}>
      <TeacherWorkloadDocument summary={currentResult.summary} issuedAt={currentResult.issuedAt} />
    </PrintLayout>
  </>;
}

export default function PrintTeacherWorkloadsPage() {
  const [params] = useSearchParams();
  return <TeacherWorkloadPreview schoolId={positiveId(params.get('school_id'))} academicYearId={positiveId(params.get('academic_year_id'))} />;
}
