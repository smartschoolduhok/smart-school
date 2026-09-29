import { useEffect, useRef, useState } from 'react';
import { Archive, LoaderCircle } from 'lucide-react';
import { archiveAndClearTimetable, previewTimetableClear } from '../../lib/api';
import type { TimetableClearPreview } from '../../lib/timetableAdoption';

interface Props {
  schoolId: number;
  academicYearId: number;
  onCleared: (versionId: number | null) => Promise<void>;
}

export function ClearTimetableButton({ schoolId, academicYearId, onCleared }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const generationRef = useRef(0);
  const scopeRef = useRef({ schoolId, academicYearId });
  scopeRef.current = { schoolId, academicYearId };
  const [preview, setPreview] = useState<TimetableClearPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);

  useEffect(() => () => { generationRef.current += 1; }, [schoolId, academicYearId]);

  function requestIsCurrent(generation: number) {
    return generation === generationRef.current
      && scopeRef.current.schoolId === schoolId && scopeRef.current.academicYearId === academicYearId;
  }

  async function openPreview() {
    const generation = ++generationRef.current;
    setPreview(null);
    setError('');
    setLoading(true);
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    const response = await previewTimetableClear(schoolId, academicYearId);
    if (!requestIsCurrent(generation)) return;
    setLoading(false);
    if (response.error || !response.data) setError(response.error || 'تعذر تحميل المعاينة');
    else setPreview(response.data);
  }

  function close() {
    if (submittingRef.current) return;
    generationRef.current += 1;
    dialogRef.current?.close();
    setPreview(null);
  }

  async function clear() {
    if (!preview || preview.entry_count === 0 || preview.pending_attendance_count > 0 || submittingRef.current) return;
    submittingRef.current = true;
    setClearing(true);
    setError('');
    const generation = ++generationRef.current;
    const response = await archiveAndClearTimetable({
      school_id: schoolId, academic_year_id: academicYearId,
      expected_revision: preview.revision, confirm_clear: true,
    });
    if (!requestIsCurrent(generation)) return;
    submittingRef.current = false;
    setClearing(false);
    if (response.error || !response.data) {
      setError(response.error || 'تعذر تأكيد نتيجة التفريغ. أعد تحميل المعاينة.');
      setPreview(null);
      return;
    }
    close();
    await onCleared(response.data.previous_version?.id ?? null);
  }

  return <>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 no-print">
      <p className="text-sm text-gray-600">لبدء توزيع جديد، يمكنك حفظ الجدول الحالي في الأرشيف ثم تفريغه.</p>
      <button type="button" onClick={() => void openPreview()} className="flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50">
        <Archive size={18} />أرشفة وتفريغ الجدول الحالي
      </button>
    </div>
    <dialog ref={dialogRef} aria-labelledby="clear-timetable-title" aria-describedby="clear-timetable-description"
      onCancel={(event) => { event.preventDefault(); close(); }}
      className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-gray-200 p-6 shadow-xl backdrop:bg-black/40" dir="rtl">
      <h2 id="clear-timetable-title" className="text-xl font-bold text-gray-900">أرشفة وتفريغ الجدول الحالي</h2>
      <p id="clear-timetable-description" className="mt-3 text-sm leading-7 text-gray-700">
        يشمل التفريغ جميع الصفوف والشعب في المدرسة والسنة المحددتين، بما فيها الدروس المثبتة.
        تبقى أيام الدوام والأوقات والنصاب وتوفر المدرسين والقيود محفوظة.
      </p>
      {loading && <p role="status" className="mt-4 flex items-center gap-2 text-gray-600"><LoaderCircle size={18} className="animate-spin" />جاري تحميل المعاينة...</p>}
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {preview && <div className="mt-4 space-y-3 text-sm">
        <p className="font-semibold">{preview.school_name} — <bdi>{preview.academic_year_name}</bdi></p>
        <p>الدروس التي ستؤرشف وتُفرّغ: <b>{preview.entry_count}</b>، منها مثبتة: <b>{preview.locked_entry_count}</b>.</p>
        {preview.entry_count === 0 ? <p className="rounded-lg bg-blue-50 p-3 text-blue-800">الجدول فارغ بالفعل؛ يمكنك البدء بالتوليد مباشرة.</p>
          : <p className="rounded-lg bg-amber-50 p-3 leading-6 text-amber-900">ستُحفظ نسخة قبل التفريغ. يمكنك مراجعتها واستعادتها من «السجل والإصدارات» ← «إصدارات الجدول».</p>}
        {preview.pending_attendance_count > 0 && <p role="alert" className="text-red-700">توجد {preview.pending_attendance_count} مسودة حضور مرتبطة بالدروس. أكملها أو ألغها ثم أعد المعاينة.</p>}
      </div>}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button type="button" autoFocus disabled={clearing} onClick={close} className="rounded-lg border border-gray-300 px-4 py-2 disabled:opacity-50">إلغاء</button>
        {!loading && (!preview || preview.pending_attendance_count > 0) && <button type="button" onClick={() => void openPreview()} className="rounded-lg border border-gray-300 px-4 py-2">إعادة المعاينة</button>}
        {preview && preview.entry_count > 0 && preview.pending_attendance_count === 0 && <button type="button" disabled={clearing} onClick={() => void clear()} className="flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 font-semibold text-white hover:bg-red-800 disabled:opacity-50">
          {clearing && <LoaderCircle size={16} className="animate-spin" />}{clearing ? 'جاري الأرشفة والتفريغ...' : 'تأكيد الأرشفة والتفريغ'}
        </button>}
      </div>
    </dialog>
  </>;
}
