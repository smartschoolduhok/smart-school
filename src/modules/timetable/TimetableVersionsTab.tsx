import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, History, LoaderCircle, RotateCcw } from 'lucide-react';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import {
  getTimetableVersion,
  getTimetableVersions,
  previewTimetableVersionRestore,
  restoreTimetableVersion,
} from '../../lib/api';
import type {
  TimetableRestorePreview,
  TimetableScheduleVersion,
  TimetableScheduleVersionDetails,
} from '../../lib/timetableAdoption';

interface TimetableVersionsTabProps {
  schoolId: number;
  academicYearId: number;
  dataVersion: number;
  onRestored: () => Promise<void>;
}

const SOURCE_LABELS: Record<TimetableScheduleVersion['source'], string> = {
  automatic_adoption: 'اعتماد تلقائي',
  manual_restore: 'استعادة يدوية',
};

function formatTimestamp(value: number) {
  return new Date(Number(value) * 1000).toLocaleString('ar-IQ');
}

export function TimetableVersionsTab({
  schoolId,
  academicYearId,
  dataVersion,
  onRestored,
}: TimetableVersionsTabProps) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const generationRef = useRef(0);
  const [versions, setVersions] = useState<TimetableScheduleVersion[]>([]);
  const [details, setDetails] = useState<TimetableScheduleVersionDetails | null>(null);
  const [restorePreview, setRestorePreview] = useState<TimetableRestorePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const generation = ++generationRef.current;
    const isCurrentSchool = captureSchoolRequest();
    setVersions([]);
    setDetails(null);
    setRestorePreview(null);
    setLoading(true);
    setError('');
    setSuccess('');
    void getTimetableVersions(schoolId, academicYearId).then((response) => {
      if (generation !== generationRef.current || !isCurrentSchool()) return;
      setLoading(false);
      if (response.error) return setError(response.error);
      setVersions(response.data || []);
    });
    return () => { generationRef.current += 1; };
  }, [academicYearId, captureSchoolRequest, dataVersion, schoolId]);

  async function viewVersion(versionId: number) {
    const generation = ++generationRef.current;
    setLoading(true);
    setError('');
    setRestorePreview(null);
    const response = await getTimetableVersion(versionId, schoolId, academicYearId);
    if (generation !== generationRef.current) return;
    setLoading(false);
    if (response.error) return setError(response.error);
    setDetails(response.data || null);
  }

  async function previewRestore(versionId: number) {
    const generation = ++generationRef.current;
    setLoading(true);
    setError('');
    setSuccess('');
    const response = await previewTimetableVersionRestore(versionId, schoolId, academicYearId);
    if (generation !== generationRef.current) return;
    setLoading(false);
    if (response.error) return setError(response.error);
    setRestorePreview(response.data || null);
  }

  async function restoreVersion() {
    if (!restorePreview?.can_apply) return;
    if (!window.confirm('سيتم حفظ نسخة من الجدول الحالي ثم استعادة هذا الإصدار بالكامل. هل تريد المتابعة؟')) return;
    const generation = ++generationRef.current;
    setLoading(true);
    setError('');
    const response = await restoreTimetableVersion(restorePreview.version.id, {
      school_id: schoolId,
      academic_year_id: academicYearId,
      expected_revision: restorePreview.revision,
      proposal_digest: restorePreview.proposal_digest,
      confirm_restore: true,
    });
    if (generation !== generationRef.current) return;
    setLoading(false);
    if (response.error) {
      setRestorePreview(null);
      return setError(response.error);
    }
    setDetails(null);
    setRestorePreview(null);
    setSuccess('تمت استعادة إصدار الجدول بنجاح');
    await onRestored();
  }

  return (
    <section className="space-y-4" dir="rtl">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h2 className="flex items-center gap-2 font-bold text-slate-900"><History size={20} />إصدارات الجدول</h2>
        <p className="mt-1 text-sm text-slate-600">نسخ غير قابلة للتعديل تُحفظ تلقائيًا قبل كل اعتماد أو استعادة.</p>
      </div>
      {loading && <div className="flex items-center justify-center gap-2 rounded-xl border bg-white p-8 text-gray-500"><LoaderCircle className="animate-spin" size={18} />جاري التحميل...</div>}
      {error && <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800"><AlertTriangle size={18} />{error}</div>}
      {success && <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800"><CheckCircle2 size={18} />{success}</div>}
      {!loading && versions.length === 0 && <div className="rounded-xl border border-dashed bg-white p-8 text-center text-gray-500">لا توجد إصدارات محفوظة بعد.</div>}
      {!loading && versions.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-gray-50"><tr className="text-right text-gray-600"><th className="p-3">التاريخ</th><th className="p-3">المستخدم</th><th className="p-3">المصدر</th><th className="p-3">عدد الحصص السابقة</th><th className="p-3">إجراء</th></tr></thead>
            <tbody>{versions.map((version) => (
              <tr key={version.id} className="border-t">
                <td className="p-3">{formatTimestamp(version.created_at)}</td>
                <td className="p-3">{version.created_by_name || 'مستخدم غير متاح'}</td>
                <td className="p-3">{SOURCE_LABELS[version.source]}</td>
                <td className="p-3"><bdi dir="ltr">{version.old_entry_count}</bdi></td>
                <td className="flex gap-2 p-3"><button type="button" onClick={() => void viewVersion(version.id)} className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-blue-700"><Eye size={15} />عرض</button><button type="button" onClick={() => void previewRestore(version.id)} className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-amber-700"><RotateCcw size={15} />معاينة الاستعادة</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {details && <div className="rounded-xl border bg-white p-4"><h3 className="font-bold">محتوى الإصدار</h3><p className="mt-2 text-sm text-gray-600">عدد الحصص: <bdi dir="ltr">{details.entries.length}</bdi> — المثبتة: <bdi dir="ltr">{details.entries.filter((entry) => entry.is_locked === 1).length}</bdi></p></div>}
      {restorePreview && (
        <div className={`rounded-xl border p-4 ${restorePreview.can_apply ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
          <h3 className="font-bold">معاينة الاستعادة</h3>
          <p className="mt-2 text-sm">قابل للاستعادة: <bdi dir="ltr">{restorePreview.restorable_entry_count}</bdi> — غير صالح تاريخيًا: <bdi dir="ltr">{restorePreview.invalid_historical_entry_count}</bdi></p>
          <p className="mt-1 text-sm">تغطية الأنصبة الحالية: <bdi dir="ltr">{restorePreview.weekly_demand.scheduled_periods}</bdi> / <bdi dir="ltr">{restorePreview.weekly_demand.required_periods}</bdi></p>
          {restorePreview.warnings.length > 0 && <ul className="mt-2 list-inside list-disc text-sm text-amber-800">{restorePreview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          {restorePreview.blockers.length > 0 && <ul className="mt-2 list-inside list-disc text-sm text-red-800">{restorePreview.blockers.map((blocker, index) => <li key={`${blocker.code}:${index}`}>{blocker.message}</li>)}</ul>}
          {restorePreview.can_apply && <button type="button" onClick={() => void restoreVersion()} className="mt-3 flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2 font-bold text-white"><RotateCcw size={17} />استعادة هذا الإصدار</button>}
        </div>
      )}
    </section>
  );
}
