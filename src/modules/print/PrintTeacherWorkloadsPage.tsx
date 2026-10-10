import { TeacherWorkloadExtrasEditor } from './TeacherWorkloadExtrasEditor';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getTimetableTeacherWorkloadSummary } from '../../lib/api';
import type { TeacherWorkloadSummary } from '../../lib/teacherWorkloadSummary';
import { TeacherWorkloadDocument, type TeacherWorkloadDocumentHandle, type TeacherWorkloadMode } from '../../components/officialBooks/TeacherWorkloadDocument';
import { PrintLayout, usePrintExport } from '../../components/print';

function positiveId(value: string | null) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function TeacherWorkloadPreview({ schoolId, academicYearId, initialMode = 'summary', loadSummary = getTimetableTeacherWorkloadSummary }: {
  schoolId: number | null;
  academicYearId: number | null;
  initialMode?: TeacherWorkloadMode;
  loadSummary?: typeof getTimetableTeacherWorkloadSummary;
}) {
  const [result, setResult] = useState<{ summary: TeacherWorkloadSummary; issuedAt: Date; requestKey: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [extraSaving, setExtraSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [mode, setMode] = useState<TeacherWorkloadMode>(initialMode);
  const documentRef = useRef<TeacherWorkloadDocumentHandle>(null);
  useEffect(() => { setMode(initialMode); }, [initialMode]);
  const requestKey = `${schoolId}:${academicYearId}:${reload}`;
  const currentResult = result?.requestKey === requestKey && result?.summary.school.id === schoolId && result?.summary.academic_year.id === academicYearId ? result : null;
  const detailsUnavailable = mode === 'detailed' && currentResult?.summary.teachers.some(teacher => !Array.isArray(teacher.breakdown)
    || teacher.breakdown.reduce((total, assignment) => total + assignment.weekly_periods, 0) !== teacher.weekly_periods);
  const snapshot = useMemo(() => ({ result: currentResult, mode }), [currentResult, mode]);
  const printableResult = useRef<typeof snapshot | null>(snapshot);
  printableResult.current = loading || error || extraSaving ? null : snapshot;

  useEffect(() => {
    let active = true;
    setResult(null);
    setExtraSaving(false);
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
        setResult({ summary: response.data, issuedAt: new Date(), requestKey });
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'تعذر تحميل أنصبة المدرسين.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; printableResult.current = null; };
  }, [schoolId, academicYearId, loadSummary, reload, requestKey]);

  const { handlePrint, error: printError } = usePrintExport({
    documentTitle: currentResult ? `أنصبة المدرسين${mode === 'detailed' ? ' بالتفصيل' : ''} — ${currentResult.summary.school.name} — ${currentResult.summary.academic_year.name}` : 'أنصبة المدرسين',
    onBeforePrint: async () => {
      if (!currentResult || loading || error || extraSaving) throw new Error('انتظر اكتمال تحميل الكشف قبل الطباعة.');
      if (detailsUnavailable) throw new Error('تفاصيل الحصص غير مكتملة. حدّث الكشف وأعد المحاولة.');
      await documentRef.current?.prepareForPrint();
      if (printableResult.current !== snapshot) throw new Error('تغير الكشف أثناء تجهيز الطباعة. راجع البيانات الحالية وأعد الطباعة.');
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
      <p>الكشف يعرض جميع الأنصبة المعتمدة للمدرسين في السنة المختارة. يظهر المدرس دون حصص بالعدد صفر.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="تفاصيل كشف الحصص">
        <span>نوع الكشف:</span>
        {(['summary', 'detailed'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`rounded-md border px-3 py-2 ${mode === value ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-300 bg-white text-gray-700'}`}>
          {value === 'summary' ? 'ملخّص الحصص' : 'بالتفصيل حسب الصف والمادة'}
        </button>)}
      </div>
      <TeacherWorkloadExtrasEditor key={`${schoolId}:${academicYearId}`} summary={currentResult.summary} onChanged={() => setReload(value => value + 1)} onBusyChange={setExtraSaving} />
      {printError && <p role="alert" className="mt-2 text-red-700">{printError}</p>}
      {detailsUnavailable && <div className="mt-2"><p role="alert" className="text-red-700">تفاصيل الحصص غير مكتملة. حدّث الكشف وأعد المحاولة.</p><button type="button" onClick={() => setReload(value => value + 1)} className="mt-2 rounded-md border border-gray-300 px-3 py-2 text-sm">تحديث الكشف</button></div>}
    </div>
    {!detailsUnavailable && <PrintLayout size="A4" className="teacher-workload-print-sheet" onPrint={handlePrint} backButton={<>{back}<button type="button" onClick={() => setReload(value => value + 1)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">تحديث الكشف</button></>}>
      <TeacherWorkloadDocument ref={documentRef} summary={currentResult.summary} issuedAt={currentResult.issuedAt} mode={mode} />
    </PrintLayout>}
  </>;
}

export default function PrintTeacherWorkloadsPage() {
  const [params] = useSearchParams();
  return <TeacherWorkloadPreview schoolId={positiveId(params.get('school_id'))} academicYearId={positiveId(params.get('academic_year_id'))} initialMode={params.get('mode') === 'detailed' ? 'detailed' : 'summary'} />;
}
